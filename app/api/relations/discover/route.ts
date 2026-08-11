import path from "node:path";

import { runJsonScript } from "@/lib/run-script";

// Spawns scripts/discover-content-types.js — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNER = path.resolve(process.cwd(), "scripts/discover-content-types.js");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Live-probes prod Strapi for content types and relation fields — see lib/relations/discovery.js. Manual, not auto-run on tab open (it fires ~30 requests). */
export async function GET(): Promise<Response> {
  const result = await runJsonScript(RUNNER, [], { timeout: 90_000 });
  if (!result.ok) return json({ error: result.error }, 502);
  return json(result.data);
}
