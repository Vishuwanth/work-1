import path from "node:path";

import { runJsonScript } from "@/lib/run-script";

// Spawns scripts/list-resources.js — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNNER = path.resolve(process.cwd(), "scripts/list-resources.js");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function GET(): Promise<Response> {
  const result = await runJsonScript(RUNNER, []);
  if (!result.ok) return json({ error: result.error }, 502);
  return json(result.data);
}
