import path from "node:path";

import { spawnDetachedScript } from "@/lib/run-script";
import { isRunning, getStatus, write as writeBatchState, LOG_PATH } from "@/lib/relations/batch-store";
import { normalizeGapMinutes, DEFAULT_GAP_MINUTES } from "@/lib/resources/classify";

// Spawns scripts/run-relation-check.js — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNER = path.resolve(process.cwd(), "scripts/run-relation-check.js");

interface RunBody {
  /** `${contentType}:${slug}` keys — multi-select from the Relations tab's table. Takes priority over types/limit. */
  keys?: string[];
  types?: string[];
  limit?: number;
  action?: string;
  confirmWrite?: boolean;
  gapMinutes?: number;
  /** Force a live re-fetch of the content-type/corpus cache instead of reusing it — see lib/relations/corpus-cache.js. */
  refresh?: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Starts a batch and returns immediately — mirrors POST /api/resources/run
 * exactly (see docs/specs/2026-07-28-resources-classification-design.md §3.1
 * and §7.2 for the full rationale: detached because a paced write batch
 * can't live inside one HTTP request, confirmWrite because writing modifies
 * production and a bare `action: "write"` must never be enough on its own).
 *
 * Prod only. Poll GET /api/relations/batch for progress and
 * GET /api/relations/checks for results.
 */
export async function POST(request: Request): Promise<Response> {
  let body: RunBody;
  try {
    body = (await request.json()) as RunBody;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const keys = Array.isArray(body.keys) ? body.keys.filter((s): s is string => typeof s === "string") : [];
  const types = Array.isArray(body.types) ? body.types.filter((s): s is string => typeof s === "string") : [];
  const limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.max(0, Math.floor(body.limit)) : 0;

  if (keys.length === 0 && limit === 0) {
    return json({ error: "keys (or limit) is required — select at least one entry, or set a limit" }, 400);
  }

  const action = body.action === "write" ? "write" : "run";

  if (action === "write" && body.confirmWrite !== true) {
    return json({ error: "Writing requires confirmWrite: true (see the confirmation checkbox)." }, 400);
  }

  if (isRunning()) {
    const current = getStatus();
    return json({ error: `A ${current?.action ?? ""} batch is already running — stop it first.` }, 409);
  }

  const gapMinutes = normalizeGapMinutes(body.gapMinutes ?? DEFAULT_GAP_MINUTES);

  const batchId = `${action}-${Date.now()}`;
  const args = [`--action=${action}`, `--batch-id=${batchId}`, `--gap-minutes=${gapMinutes}`];
  if (keys.length > 0) args.push(`--keys=${keys.join(",")}`);
  else args.push(`--limit=${limit}`);
  if (types.length > 0) args.push(`--types=${types.join(",")}`);
  if (body.refresh === true) args.push("--refresh");

  const pid = spawnDetachedScript(RUNNER, args, LOG_PATH);
  if (!pid) return json({ error: "could not start the batch process" }, 500);

  const targetCount = keys.length || limit;
  const state = writeBatchState({
    batchId,
    action,
    pid,
    keys,
    types,
    status: "running",
    phase: "starting",
    current: "",
    total: targetCount,
    mapped: 0,
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
