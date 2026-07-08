import { resolve } from "node:path";
import * as XLSX from "xlsx";
import type { Row } from "@/lib/types";
import { slugify } from "@/lib/slug";

const DEFAULT_SHEET = "All 300 Pages";
const DEFAULT_XLSX = "docs/source/CancerFax_Content_Architecture_1.xlsx";

// Column positions (0-indexed) in the "All 300 Pages" sheet:
// # | Pillar # | Pillar Name | Support Page # | Support Page Title | Status | Writer | Assigned To | Target Publish Date | Content Type
const COL = { pillarName: 2, title: 4, status: 5, contentType: 9 } as const;

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/**
 * Read every content row (non-empty Support Page Title) from the workbook.
 * Header is at sheet row 2 (range:1); rowNum is the 1-indexed Excel row.
 */
export function readRows(xlsxPath?: string): Row[] {
  const path = xlsxPath ?? resolve(process.cwd(), DEFAULT_XLSX);
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[DEFAULT_SHEET];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: 1, blankrows: true });

  const rows: Row[] = [];
  // grid[0] is the header row (Excel row 2); grid[k] is Excel row k + 2.
  // A content row is one with a non-empty Support Page Title (719 rows). Rows that
  // carry a pillar/status but no title are incomplete placeholders in the sheet —
  // they have no topic/slug and can't be generated or reviewed, so we skip them.
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i] || [];
    const title = str(cells[COL.title]);
    if (title === "") continue;
    rows.push({
      rowNum: i + 2,
      pillarName: str(cells[COL.pillarName]),
      title,
      excelStatus: str(cells[COL.status]),
      contentType: str(cells[COL.contentType]),
      slug: slugify(title),
    });
  }
  return rows;
}
