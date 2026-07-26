// Builds the reviewer-facing status workbook: one row per content row of the
// "All 300 Pages" sheet, carrying its pillar, the sheet's own Status, the
// generation state derived from output/faq/, and the slug. Pure — no fs.
import * as XLSX from "xlsx";
import type { RowView } from "@/lib/types";

export const SHEET_NAME = "Content Status";

export const HEADERS = [
  "Pillar",
  "Pillar Name",
  "Support Page Title",
  "Excel Status",
  "Gen Status",
  "Slug",
  "Dup Slug",
] as const;

const WIDTHS = [8, 34, 60, 12, 14, 55, 10];

/**
 * Slugs claimed by more than one content row. Those rows resolve to the same URL
 * and share a single FAQ fixture, so the export flags every row involved.
 * Always compute this over ALL rows, never over an exported subset.
 */
export function duplicateSlugs(views: RowView[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of views) (seen.has(v.slug) ? dup : seen).add(v.slug);
  return dup;
}

/** Pillar # as a number when it is one, so Excel sorts it numerically; blank stays blank. */
function pillarCell(raw: string): number | string {
  if (raw === "") return "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

export function toRowArrays(views: RowView[], dupSlugs: Set<string>): (string | number)[][] {
  return views.map((v) => [
    pillarCell(v.pillarNum),
    v.pillarName,
    v.title,
    v.excelStatus,
    v.contentState === "not-generated" ? "Not generated" : "Generated",
    v.slug,
    dupSlugs.has(v.slug) ? "YES" : "",
  ]);
}

/** A single-sheet workbook: header row + one row per view, autofiltered, sized. */
export function buildStatusWorkbook(views: RowView[], dupSlugs: Set<string>): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet([[...HEADERS], ...toRowArrays(views, dupSlugs)]);
  ws["!cols"] = WIDTHS.map((wch) => ({ wch }));
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: views.length, c: HEADERS.length - 1 },
    }),
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  return wb;
}

/**
 * Date-stamped download name; `subset` marks an export of the on-screen rows.
 * The stamp is the server's LOCAL date — a UTC one reads as yesterday for the
 * first 5.5 hours of every IST day.
 */
export function exportFilename(subset: boolean, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `cancerfax-content-status${subset ? "-view" : ""}-${date}.xlsx`;
}
