import type { Row } from "@/lib/types";
import { runGenerate, classifyGenError, type GenerateResult } from "@/lib/generate";

/** One progress event, streamed to the client (SSE) or collected in tests. */
export type GenEvent =
  | { type: "start"; total: number }
  | { type: "row"; slug: string; status: "running" | "done" | "skipped" }
  | { type: "row"; slug: string; status: "failed"; error: string }
  | { type: "aborted"; reason: "auth" | "client-disconnect"; message: string }
  | { type: "done"; done: number; failed: number; skipped: number };

export interface BatchSummary {
  done: number;
  failed: number;
  skipped: number;
  aborted?: "auth" | "client-disconnect";
}

export interface BatchOpts {
  /** Max concurrent generations. Default 3. */
  concurrency?: number;
  /** Client-disconnect signal — stop pulling new rows when aborted. */
  signal?: AbortSignal;
  /** True if this row already has a fixture on disk (skip it, never overwrite). */
  isAlreadyGenerated: (row: Row) => boolean;
  /** Injectable for tests; defaults to the real `claude -p` spawn. */
  generate?: (row: Row) => Promise<GenerateResult>;
  /** Backoff before a single rate-limit retry (ms). Default 5000. */
  backoffMs?: number;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Run a concurrency-capped batch of generations over `rows`, emitting a progress
 * event per state transition. Behavior (per spec 2026-07-09):
 * - skip rows that already have a fixture (never overwrite a reviewed one);
 * - continue past per-row failures, collecting them;
 * - abort the whole run immediately on an auth failure (logged out → all fail);
 * - back off once and retry on a rate-limit error;
 * - stop pulling new rows when `signal` aborts (client disconnected).
 */
export async function runBatch(
  rows: Row[],
  opts: BatchOpts,
  emit: (e: GenEvent) => void,
): Promise<BatchSummary> {
  const { signal, isAlreadyGenerated } = opts;
  const generate = opts.generate ?? runGenerate;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const backoffMs = opts.backoffMs ?? 5000;
  const concurrency = Math.max(1, opts.concurrency ?? 3);

  emit({ type: "start", total: rows.length });

  let done = 0;
  let failed = 0;
  let skipped = 0;
  let auth = false;
  let cursor = 0;

  async function worker(): Promise<void> {
    // `cursor++` is atomic between awaits (single-threaded JS), so workers never
    // claim the same row.
    while (!auth && !signal?.aborted) {
      const i = cursor++;
      if (i >= rows.length) return;
      const row = rows[i];

      if (isAlreadyGenerated(row)) {
        skipped++;
        emit({ type: "row", slug: row.slug, status: "skipped" });
        continue;
      }

      emit({ type: "row", slug: row.slug, status: "running" });
      let result = await generate(row);

      // One rate-limit retry after a backoff.
      if (!result.ok && classifyGenError(result.error) === "rate-limit") {
        await sleep(backoffMs);
        if (auth || signal?.aborted) return;
        result = await generate(row);
      }

      if (result.ok) {
        done++;
        emit({ type: "row", slug: row.slug, status: "done" });
        continue;
      }

      if (classifyGenError(result.error) === "auth") {
        auth = true;
        emit({ type: "aborted", reason: "auth", message: result.error });
        return;
      }

      failed++;
      emit({ type: "row", slug: row.slug, status: "failed", error: result.error });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (!auth && signal?.aborted) {
    emit({ type: "aborted", reason: "client-disconnect", message: "client disconnected" });
  }
  emit({ type: "done", done, failed, skipped });

  return { done, failed, skipped, aborted: auth ? "auth" : signal?.aborted ? "client-disconnect" : undefined };
}
