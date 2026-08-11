import path from "node:path";

import { runJsonScript } from "@/lib/run-script";

// Spawns scripts/list-relation-entries.js — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNER = path.resolve(process.cwd(), "scripts/list-relation-entries.js");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Content types + every entry's title/slug/excerpt across all of them — no
 * full body, no current-relations lookup. Served from
 * lib/relations/corpus-cache.js by default (near-instant); pass
 * `?refresh=true` to force a live re-fetch (~55s for ~3,400 entries) and
 * overwrite the cache.
 */
export async function GET(request: Request): Promise<Response> {
  const refresh = new URL(request.url).searchParams.get("refresh") === "true";
  const args = refresh ? ["--refresh"] : [];
  const result = await runJsonScript(RUNNER, args, { timeout: 120_000 });
  if (!result.ok) return json({ error: result.error }, 502);
  return json(result.data);
}
