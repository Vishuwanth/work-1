import { getAll } from "@/lib/relations/checks-store";

// Reads data/relation-checks.json directly (no spawn needed) — must run on Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Persisted Run/Write results, keyed by `${contentType}/${slug}` — survives a page reload. */
export async function GET(): Promise<Response> {
  return new Response(JSON.stringify({ checks: getAll() }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
