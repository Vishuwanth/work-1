import { getStatus, stop } from "@/lib/resources/batch-store";

// Reads/signals the detached batch process — must run on Node, never Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Progress of the current (or most recent) batch. The UI polls this while a
 * batch runs; `null` means none has ever been started.
 *
 * This reports progress only. The results themselves are in
 * data/resource-checks.json, served by GET /api/resources/checks.
 */
export async function GET(): Promise<Response> {
  return json({ batch: getStatus() });
}

/** Stop the running batch. Rows already written stay written — nothing is rolled back. */
export async function DELETE(): Promise<Response> {
  const signalled = stop();
  if (!signalled) return json({ error: "no batch is running" }, 409);
  return json({ batch: getStatus() });
}
