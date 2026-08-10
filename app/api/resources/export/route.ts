import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { buildSharedWorkbook, buildWorkbook } from "@/lib/resource-workbook";
import type { ResourceTableRow } from "@/lib/resource-reports";

// Writes a file inside the repo — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKBOOK_PATH = path.resolve(process.cwd(), "output", "resources", "resources-tagging.xlsx");
/** Repo-relative, for the UI — the absolute path is noise to the reader. */
const DISPLAY_PATH = "output/resources/resources-tagging.xlsx";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface ExportBody {
  rows?: ResourceTableRow[];
}

/**
 * Rewrites the tagging workbook from the rows the browser sends, and returns a
 * TRIMMED copy for download.
 *
 * Two shapes, one row set:
 *   - committed to the repo — all 16 columns, including the operational detail
 *     (write status, failure reasons, timestamps) that only matters here.
 *   - returned to the browser — the 9 columns fit to hand to someone else.
 *
 * Both are built from the same `rows` in this one call, so they can differ in
 * how much they show but never in what they say. Building the download
 * client-side instead would let the two genuinely drift.
 *
 * The client is the source deliberately: the sheet then matches exactly what
 * the reviewer was looking at when they clicked, with no second Strapi fetch
 * that could disagree with the screen. The client sends ALL live resources,
 * not the filtered view — filters change what you see, never what gets written.
 *
 * Errors still respond as JSON, so the client branches on content-type.
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
  // An empty write would silently replace a good workbook with a header row —
  // far more likely a bug upstream than a real instruction.
  if (rows.length === 0) {
    return json({ error: "refusing to write an empty workbook — no rows were sent" }, 400);
  }

  try {
    const fullBuffer = XLSX.write(buildWorkbook(rows), { type: "buffer", bookType: "xlsx" }) as Buffer;
    const sharedBuffer = XLSX.write(buildSharedWorkbook(rows), { type: "buffer", bookType: "xlsx" }) as Buffer;

    fs.mkdirSync(path.dirname(WORKBOOK_PATH), { recursive: true });
    // Write then rename: a crash or a full disk mid-write can never leave a
    // truncated workbook where the good one used to be. rename is atomic within
    // a filesystem, and the temp file sits in the same directory to guarantee that.
    const tempPath = `${WORKBOOK_PATH}.tmp`;
    fs.writeFileSync(tempPath, fullBuffer);
    fs.renameSync(tempPath, WORKBOOK_PATH);

    // Dated, so repeated downloads don't pile up as "… (1).xlsx" and each saved
    // copy says when it was taken. The repo file keeps the undated canonical name.
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(sharedBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="resources-tagging-${stamp}.xlsx"`,
        "Content-Length": String(sharedBuffer.length),
        "Cache-Control": "no-store",
        // Read by the client for the toast — the body is the file, not JSON.
        "X-Workbook-Path": DISPLAY_PATH,
        "X-Workbook-Rows": String(rows.length),
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
