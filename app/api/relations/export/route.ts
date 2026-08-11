import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { buildRelationsWorkbook } from "@/lib/relation-workbook";
import type { RelationTableRow } from "@/lib/relation-reports";

// Writes a file inside the repo — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKBOOK_PATH = path.resolve(process.cwd(), "output", "relations", "relations-mapping.xlsx");
/** Repo-relative, for the UI — the absolute path is noise to the reader. */
const DISPLAY_PATH = "output/relations/relations-mapping.xlsx";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface ExportBody {
  rows?: RelationTableRow[];
}

/**
 * The review artifact between Run and Write — see lib/relation-workbook.ts's
 * header. Rewrites the committed workbook from the rows the browser sends
 * and returns the same bytes for download, so the repo copy and the
 * downloaded copy are byte-identical by construction (mirrors
 * app/api/resources/export/route.ts exactly).
 *
 * The client sends ALL loaded rows, not the filtered view — filters change
 * what's on screen, never what's in the review document.
 */
export async function POST(request: Request): Promise<Response> {
  let body: ExportBody;
  try {
    body = (await request.json()) as ExportBody;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const rows = body.rows;
  if (!Array.isArray(rows)) {
    return json({ error: "rows must be an array" }, 400);
  }
  if (rows.length === 0) {
    return json({ error: "refusing to write an empty workbook — no rows were sent" }, 400);
  }

  try {
    const buffer = XLSX.write(buildRelationsWorkbook(rows), { type: "buffer", bookType: "xlsx" }) as Buffer;

    fs.mkdirSync(path.dirname(WORKBOOK_PATH), { recursive: true });
    // Write then rename: atomic within a filesystem, so a crash mid-write can
    // never leave a truncated workbook where the good one used to be.
    const tempPath = `${WORKBOOK_PATH}.tmp`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, WORKBOOK_PATH);

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="relations-mapping-${stamp}.xlsx"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
        "X-Workbook-Path": DISPLAY_PATH,
        "X-Workbook-Rows": String(rows.length),
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
