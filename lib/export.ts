// Builds the reviewer-facing status workbook: one row per live page, carrying its
// collection, role, FAQ status, generation state, and any workbook metadata that
// joined. Pure — no fs.
import * as XLSX from "xlsx";
import type { RowView } from "@/lib/types";

export const SHEET_NAME = "Content Status";

export const HEADERS = [
  "Collection",
  "Slug",
  "Title",
  "Role",
  "Pillar Association",
  "FAQ Done",
  "Gen Status",
  "Review Status",
  "Excel Status",
] as const;

const WIDTHS = [12, 55, 60, 14, 30, 10, 14, 14, 14];

export function toRowArrays(views: RowView[]): (string | number)[][] {
  return views.map((v) => [
    v.collection,
    v.slug,
    v.title,
    v.role,
    v.pillarAssociation,
    v.faqDone ? "Yes" : "No",
    v.contentState === "not-generated" ? "Not generated" : "Generated",
    v.reviewStatus,
    v.excel?.excelStatus ?? "",
  ]);
}

/** A single-sheet workbook: header row + one row per view, autofiltered, sized. */
export function buildStatusWorkbook(views: RowView[]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet([[...HEADERS], ...toRowArrays(views)]);
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
