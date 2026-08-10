import path from "node:path";

import { spawnDetachedScript } from "@/lib/run-script";
import { isRunning, getStatus, write as writeBatchState, LOG_PATH } from "@/lib/resources/batch-store";
import { normalizeGapMinutes, DEFAULT_GAP_MINUTES } from "@/lib/resources/classify";

// Spawns scripts/run-resource-check.js — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNER = path.resolve(process.cwd(), "scripts/run-resource-check.js");

interface RunBody {
  slugs?: string[];
  action?: string;
  confirmWrite?: boolean;
  /** Minutes between writes. 0 = fast. Omitted = the runner's default. */
  gapMinutes?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Starts a batch and returns immediately — it does NOT wait for it to finish.
 *
 * Writes are paced 5–10 minutes apart, so a 25-resource batch runs for around
 * three hours. The runner is spawned detached; poll GET /api/resources/batch
 * for progress, and GET /api/resources/checks for the results themselves.
 *
 * Prod only — this app doesn't offer a staging option.
 */
export async function POST(request: Request): Promise<Response> {
  let body: RunBody;
  try {
    body = (await request.json()) as RunBody;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const slugs = Array.isArray(body.slugs) ? body.slugs.filter((s): s is string => typeof s === "string") : [];
  if (slugs.length === 0) {
    return json({ error: "slugs is required — select at least one resource" }, 400);
  }

  const action = body.action === "write" ? "write" : "run";

  // Writing modifies live public content — treat it as a publish action. A
  // plain action: "write" is never enough; the client must also send an
  // explicit confirmation flag, set only after the UI's own "I understand
  // this writes to PRODUCTION" checkbox is ticked.
  if (action === "write" && body.confirmWrite !== true) {
    return json({ error: "Writing requires confirmWrite: true (see the confirmation checkbox)." }, 400);
  }

  // One batch at a time. Two would interleave writes to the same slugs and
  // race on the shared state file, for no benefit.
  if (isRunning()) {
    const current = getStatus();
    return json({ error: `A ${current?.action ?? ""} batch is already running — stop it first.` }, 409);
  }

  // Clamped here as well as in the runner. This route can write to production,
  // so the value off the wire is never trusted — a stray 0.001 would turn a
  // paced batch into a burst.
  const gapMinutes = normalizeGapMinutes(body.gapMinutes ?? DEFAULT_GAP_MINUTES);

  const batchId = `${action}-${Date.now()}`;
  const args = [
    `--slugs=${slugs.join(",")}`,
    `--action=${action}`,
    `--batch-id=${batchId}`,
    `--gap-minutes=${gapMinutes}`,
  ];

  const pid = spawnDetachedScript(RUNNER, args, LOG_PATH);
  if (!pid) return json({ error: "could not start the batch process" }, 500);

  // Seeded HERE rather than in the runner, so a poll that arrives before the
  // child has finished booting still sees a running batch rather than the
  // previous batch's stale state.
  const state = writeBatchState({
    batchId,
    action,
    pid,
    slugs,
    status: "running",
    phase: "starting",
    current: "",
    total: slugs.length,
    classified: 0,
    writeTotal: 0,
    written: 0,
    applied: 0,
    failed: 0,
    rateLimited: 0,
    gapMinutes,
    gapMode: gapMinutes === 0 ? "fast" : "paced",
    nextWriteAt: null,
    error: null,
    abortedReason: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  return json(state, 202);
}
