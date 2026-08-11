import { getStatus, stop } from "@/lib/relations/batch-store";

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
 * Progress of the current (or most recent) Relations batch — independent of
 * the Resources tab's batch (see lib/relations/batch-store.js). The UI polls
 * this while a batch runs; `null` means none has ever been started.
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
