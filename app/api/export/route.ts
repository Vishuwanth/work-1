import * as XLSX from "xlsx";

import { loadAll } from "@/app/actions";
import { buildStatusWorkbook, exportFilename } from "@/lib/export";
import { pageKey } from "@/lib/pages";

// Reads the CSV + output/faq/ from disk — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Build the status workbook. `keys` limits it to those rows, kept in source order. */
async function respond(keys: string[] | null): Promise<Response> {
  const { views, error } = await loadAll();
  if (error) return new Response(error, { status: 500 });

  const wanted = keys ? new Set(keys) : null;
  const selected = wanted ? views.filter((v) => wanted.has(pageKey(v))) : views;
  if (selected.length === 0) return new Response("no rows to export", { status: 400 });

  const wb = buildStatusWorkbook(selected);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${exportFilename(keys !== null)}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Every live page. */
export async function GET(): Promise<Response> {
  return respond(null);
}

/** POST `{ keys }` — "collection/slug" for just the rows currently visible in the table. */
export async function POST(request: Request): Promise<Response> {
  let body: { keys?: unknown };
  try {
    body = (await request.json()) as { keys?: unknown };
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((s): s is string => typeof s === "string")
    : [];
  if (keys.length === 0) return new Response("no keys provided", { status: 400 });
  return respond(keys);
}
