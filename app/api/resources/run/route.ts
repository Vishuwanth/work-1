import path from "node:path";

import { runJsonScript } from "@/lib/run-script";

// Spawns scripts/run-resource-check.js — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNER = path.resolve(process.cwd(), "scripts/run-resource-check.js");

interface RunBody {
  slugs?: string[];
  action?: string;
  concurrency?: number;
  confirmWrite?: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Prod only — this app doesn't offer a staging option. */
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
  const rawConcurrency = typeof body.concurrency === "number" ? body.concurrency : Number(body.concurrency);
  const concurrency = Number.isFinite(rawConcurrency) && rawConcurrency > 0 ? Math.floor(rawConcurrency) : 3;

  // Writing modifies live public content — treat it as a publish action. A
  // plain action: "write" is never enough; the client must also send an
  // explicit confirmation flag, set only after the UI's own "I understand
  // this writes to PRODUCTION" checkbox is ticked.
  if (action === "write" && body.confirmWrite !== true) {
    return json({ error: "Writing requires confirmWrite: true (see the confirmation checkbox)." }, 400);
  }

  const args = [`--slugs=${slugs.join(",")}`, `--action=${action}`, `--concurrency=${concurrency}`];

  const result = await runJsonScript(RUNNER, args, { timeout: 10 * 60_000, maxBuffer: 20 * 1024 * 1024 });
  if (!result.ok) return json({ error: result.error }, 502);
  return json(result.data);
}
