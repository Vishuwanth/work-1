// Builds output/resources/resources-tagging.xlsx from the Resources tab's rows.
//
// The workbook is a REPORT: every cell is regenerated from the app's own state
// on each export, and nothing typed into it is ever read back. Columns A-E match
// the shape of the sheet the team was already keeping by hand; F-P are the
// review detail that sheet had no room for.
//
// Pure except for buildWorkbook's XLSX call — no filesystem access here, so the
// row mapping stays testable without touching disk.
import * as XLSX from "xlsx";

import { SHARED_HEADER, duplicateLabel, toSharedRows, type ResourceTableRow } from "@/lib/resource-reports";

export const SHEET_NAME = "Sheet1";

export const WORKBOOK_HEADER = [
  "S.No.",
  "Title of Resource",
  "Slug",
  "Status",
  "Category",
  "Old Category",
  "New Category",
  "Old Tags",
  "New Tags",
  "Write Status",
  "Reason",
  "Duplicate?",
  "Duplicate Section",
  "Duplicate Content",
  "Live URL",
  "Checked At",
] as const;

/** Character widths per column — a 16-column sheet is unreadable at the default. */
const COLUMN_WIDTHS = [6, 52, 46, 8, 22, 22, 22, 34, 34, 26, 60, 11, 26, 44, 56, 22];

export type WorkbookCell = string | number | boolean;

/**
 * One array per row, in header order.
 *
 * Column D (`Status`) is a real JS boolean so SheetJS emits an Excel boolean
 * cell (`t:"b"`) rather than the text "TRUE" — that is what the original sheet
 * held, and it keeps the column usable as a tick-box.
 *
 * It is true ONLY for `applied`. A row that was attempted and failed reads
 * FALSE, with the reason in `Write Status`, so the column answers "is
 * production correct?" rather than "did we try?".
 *
 * Rows that have never been classified get blanks from `Old Category` onward
 * instead of echoing live values into columns that are meant to describe a
 * proposed change.
 */
export function toWorkbookRows(rows: ResourceTableRow[]): WorkbookCell[][] {
  const sorted = [...rows].sort((a, b) => a.title.localeCompare(b.title));

  return sorted.map((r, i) => {
    const proposed = r.checked && r.status === "ok";
    return [
      i + 1,
      r.title,
      r.slug,
      r.writeStatus === "applied",
      r.category,
      r.checked ? r.oldCategory : "",
      proposed ? r.category : "",
      r.checked ? r.oldTags : "",
      proposed ? r.tags : "",
      r.writeStatus,
      r.reason,
      duplicateLabel(r),
      r.duplicateSection,
      r.duplicateContent,
      r.link,
      r.checkedAt,
    ];
  });
}

function sheetFrom(header: readonly string[], cells: (string | number | boolean)[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet([[...header], ...cells]);
  // Widths only. Freeze panes and autofilter are not supported by the community
  // build of SheetJS on write — setting them produces no XML at all, so they are
  // deliberately absent rather than silently doing nothing.
  sheet["!cols"] = widths.map((wch) => ({ wch }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAME);
  return workbook;
}

/**
 * The full 16-column record — what gets committed to the repo.
 *
 * Keeps the operational detail (write status, failure reasons, timestamps) that
 * only matters on this machine, and that the shared copies deliberately omit.
 */
export function buildWorkbook(rows: ResourceTableRow[]): XLSX.WorkBook {
  return sheetFrom(WORKBOOK_HEADER, toWorkbookRows(rows), COLUMN_WIDTHS);
}

/** Column widths for SHARED_HEADER, in its order. */
const SHARED_WIDTHS = [6, 52, 46, 22, 22, 22, 34, 34, 11];

/**
 * The 9-column shape that leaves this machine — the downloaded .xlsx.
 *
 * Same rows as buildWorkbook, fewer columns. Both render from the caller's one
 * merged row set, so the two files can differ in how much they show but never
 * in what they say.
 */
export function buildSharedWorkbook(rows: ResourceTableRow[]): XLSX.WorkBook {
  return sheetFrom(SHARED_HEADER, toSharedRows(rows), SHARED_WIDTHS);
}
