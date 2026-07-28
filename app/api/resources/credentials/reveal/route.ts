import { getField, FIELDS } from "@/lib/credentials-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface RevealBody {
  field?: string;
}

/**
 * The only route that ever returns plaintext — deliberately separate from
 * GET /api/resources/credentials (status/masked only) so a plaintext secret
 * is never returned except in direct response to an explicit "Reveal" click.
 */
export async function POST(request: Request): Promise<Response> {
  let body: RevealBody;
  try {
    body = (await request.json()) as RevealBody;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  if (!body.field || !FIELDS.includes(body.field)) {
    return json({ error: `field must be one of: ${FIELDS.join(", ")}` }, 400);
  }

  try {
    const value = getField(body.field);
    return json({ field: body.field, value });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
