import * as XLSX from "xlsx";

import { loadAll } from "@/app/actions";
import { buildStatusWorkbook, duplicateSlugs, exportFilename } from "@/lib/export";

// Reads the workbook + output/faq/ from disk — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Build the status workbook. `slugs` limits it to those rows (kept in sheet order),
 * but the duplicate-slug flag is always computed across every row.
 */
async function respond(slugs: string[] | null): Promise<Response> {
  const { views, error } = await loadAll();
  if (error) return new Response(error, { status: 500 });

  const dupSlugs = duplicateSlugs(views);
  const wanted = slugs ? new Set(slugs) : null;
  const selected = wanted ? views.filter((v) => wanted.has(v.slug)) : views;
  if (selected.length === 0) return new Response("no rows to export", { status: 400 });

  const wb = buildStatusWorkbook(selected, dupSlugs);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${exportFilename(slugs !== null)}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Every content row. */
export async function GET(): Promise<Response> {
  return respond(null);
}

/** POST `{ slugs }` — just the rows currently selected/visible in the table. */
export async function POST(request: Request): Promise<Response> {
  let body: { slugs?: unknown };
  try {
    body = (await request.json()) as { slugs?: unknown };
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  const slugs = Array.isArray(body.slugs)
    ? body.slugs.filter((s): s is string => typeof s === "string")
    : [];
  if (slugs.length === 0) return new Response("no slugs provided", { status: 400 });
  return respond(slugs);
}
