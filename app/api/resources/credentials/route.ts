import { listFieldStatus, setField, FIELDS } from "@/lib/credentials-store";

// Reads/writes data/strapi-credentials.enc.json — must run on Node, never Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Status + masked previews only — this route never returns plaintext. */
export async function GET(): Promise<Response> {
  try {
    return json({ fields: listFieldStatus() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

interface SetBody {
  field?: string;
  value?: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: SetBody;
  try {
    body = (await request.json()) as SetBody;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  if (!body.field || !FIELDS.includes(body.field)) {
    return json({ error: `field must be one of: ${FIELDS.join(", ")}` }, 400);
  }
  if (typeof body.value !== "string" || body.value.length === 0) {
    return json({ error: "value is required" }, 400);
  }

  try {
    setField(body.field, body.value);
    return json({ fields: listFieldStatus() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
