import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

import type { Row } from "@/lib/types";
import { readRows } from "@/lib/excel";
import { readTracker, writeTracker, recordFor } from "@/lib/tracker";
import { runBatch, type GenEvent } from "@/lib/batch";

// child_process (`claude -p`) + fs — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAW_DIR = resolve(process.cwd(), "output/faq/raw");
const DONE_DIR = resolve(process.cwd(), "output/faq/done");
const FAQ_SUFFIX = "-faq-section.json";

/** A row is already generated if its fixture exists in raw or done (never overwrite it). */
function isAlreadyGenerated(row: Row): boolean {
  const file = `${row.slug}${FAQ_SUFFIX}`;
  return existsSync(join(RAW_DIR, file)) || existsSync(join(DONE_DIR, file));
}

interface Body {
  slugs?: unknown;
  concurrency?: unknown;
}

/**
 * Streaming batch generation. POST `{ slugs, concurrency? }` → an SSE stream of
 * GenEvents. The server owns the concurrency-capped loop; `request.signal` aborts
 * it when the client disconnects. `generatedAt` is stamped per completed row.
 */
export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  const slugs = Array.isArray(body.slugs) ? body.slugs.filter((s): s is string => typeof s === "string") : [];
  if (slugs.length === 0) return new Response("no slugs provided", { status: 400 });
  const concurrency = Number.isFinite(body.concurrency as number)
    ? Math.max(1, Math.min(8, Math.floor(body.concurrency as number)))
    : Number(process.env.FAQ_GEN_CONCURRENCY) || 3;

  let rows: Row[];
  try {
    const bySlug = new Map(readRows().map((r) => [r.slug, r]));
    rows = slugs.map((s) => bySlug.get(s)).filter((r): r is Row => Boolean(r));
  } catch (e) {
    return new Response(`could not read workbook: ${(e as Error).message}`, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (e: GenEvent) => {
        // Stamp generatedAt as each row lands, so a mid-batch disconnect still records
        // the rows that completed. emit() is called sequentially, so no tracker race.
        if (e.type === "row" && e.status === "done") {
          const tracker = readTracker();
          tracker[e.slug] = { ...recordFor(tracker, e.slug), generatedAt: new Date().toISOString() };
          writeTracker(tracker);
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          // Controller already closed (client gone) — the AbortSignal will stop the loop.
        }
      };

      runBatch(rows, { concurrency, signal: request.signal, isAlreadyGenerated }, emit)
        .catch((err) => emit({ type: "aborted", reason: "client-disconnect", message: String(err) }))
        .finally(() => {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
