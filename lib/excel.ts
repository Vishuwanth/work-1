// The workbook is no longer the source of truth — the live-site CSV is. This module
// now supplies OPTIONAL planning metadata, joined onto live pages by exact title.
//
// Fuzzy matching is forbidden. The site's titles are templated ("Accessing X Through
// CancerFax", "X Cost Comparison: China vs India") and share enough boilerplate that
// a similarity match confidently merges two genuinely different pages.
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import type { Row, ExcelMeta } from "@/lib/types";
import type { LivePage } from "@/lib/pages";

const DEFAULT_SHEET = "All 300 Pages";
const DEFAULT_XLSX = "docs/source/CancerFax_Content_Architecture_1.xlsx";

// Column positions (0-indexed) in the "All 300 Pages" sheet:
// # | Pillar # | Pillar Name | Support Page # | Support Page Title | Status | Writer | Assigned To | Target Publish Date | Content Type
const COL = { pillarNum: 1, pillarName: 2, title: 4, status: 5 } as const;

export type { ExcelMeta };

export interface ExcelIndex {
  /** Lowercased, trimmed title -> metadata. Ambiguous titles are absent. */
  byTitle: Map<string, ExcelMeta>;
  /** Titles claimed by more than one workbook row; joined to nothing. */
  ambiguousTitles: string[];
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function normTitle(t: string): string {
  return t.trim().toLowerCase();
}

/**
 * Index the workbook by title. A title used by more than one row is removed from the
 * index and reported in `ambiguousTitles` — picking either row would attach one
 * page's pillar to a different page.
 */
export function readExcelIndex(xlsxPath?: string): ExcelIndex {
  const path = xlsxPath ?? resolve(process.cwd(), DEFAULT_XLSX);
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[DEFAULT_SHEET];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: 1, blankrows: true });

  const byTitle = new Map<string, ExcelMeta>();
  const seen = new Map<string, number>();
  // grid[0] is the header row (Excel row 2); a content row has a non-empty title.
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i] || [];
    const title = str(cells[COL.title]);
    if (title === "") continue;
    const key = normTitle(title);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    byTitle.set(key, {
      pillarNum: str(cells[COL.pillarNum]),
      pillarName: str(cells[COL.pillarName]),
      excelStatus: str(cells[COL.status]),
    });
  }

  const ambiguousTitles: string[] = [];
  for (const [key, n] of seen) {
    if (n > 1) {
      ambiguousTitles.push(key);
      byTitle.delete(key);
    }
  }
  return { byTitle, ambiguousTitles };
}

/**
 * Attach workbook metadata to live pages. A title joins only when it appears exactly
 * once on EACH side — duplicates on the live side are just as dangerous as duplicates
 * in the workbook, so both are counted here.
 */
export function joinExcel(pages: LivePage[], index: ExcelIndex): Row[] {
  const liveCount = new Map<string, number>();
  for (const p of pages) {
    const key = normTitle(p.title);
    liveCount.set(key, (liveCount.get(key) ?? 0) + 1);
  }

  return pages.map((p) => {
    const key = normTitle(p.title);
    const meta = liveCount.get(key) === 1 ? index.byTitle.get(key) : undefined;
    return meta ? { ...p, excel: meta } : { ...p };
  });
}
