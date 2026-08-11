// Builds output/relations/relations-mapping.xlsx from the Relations tab's
// rows — the human review artifact between "Run" (propose) and "Write"
// (apply to Strapi). The workbook is a REPORT, same contract as
// lib/resource-workbook.ts: every cell is regenerated from the app's own
// state on each export, and nothing typed into it is ever read back by the
// app. Reviewing here means deciding what to select and click Write for in
// the web UI — this file is not a two-way import.
//
// Two sheets, because "one row per entry" and "one row per proposed
// relation" answer different questions: the first is a scan ("what's the
// state of everything"), the second is the actual approve/reject list
// ("should THIS specific link be written").
import * as XLSX from "xlsx";

import type { RelationTableRow } from "@/lib/relation-reports";

export const OVERVIEW_SHEET_NAME = "Overview";
export const PROPOSALS_SHEET_NAME = "Proposed Relations";

export const OVERVIEW_HEADER = [
  "S.No",
  "Content Type",
  "Title",
  "Slug",
  "Current Relations",
  "Proposed Relations",
  "Writable Proposals",
  "Status",
  "Write Status",
  "Checked At",
] as const;

export const PROPOSALS_HEADER = [
  "S.No",
  "Source Type",
  "Source Title",
  "Source Slug",
  "Relation Type",
  "Target Type",
  "Target Title",
  "Target Slug",
  "Rationale",
  "Writable?",
  "Approve (Y/N)",
  "Source Write Status",
] as const;

export type WorkbookCell = string | number;

function joinCurrent(row: RelationTableRow): string {
  if (row.currentRelations.length === 0) return "";
  return row.currentRelations.map((r) => `${r.field} → [${r.contentType ?? "?"}] ${r.title}`).join(" | ");
}

function joinProposed(row: RelationTableRow): string {
  if (row.proposedRelations.length === 0) return "";
  return row.proposedRelations
    .map((p) => `${p.relationType} → [${p.targetContentType}] ${p.targetTitle}${p.writable ? "" : " (report-only)"}`)
    .join(" | ");
}

/** One row per ENTRY — the bird's-eye scan: what's mapped, what isn't, what's ready to write. */
export function toOverviewRows(rows: RelationTableRow[]): WorkbookCell[][] {
  const sorted = [...rows].sort((a, b) => a.title.localeCompare(b.title));
  return sorted.map((r, i) => [
    i + 1,
    r.contentType,
    r.title,
    r.slug,
    joinCurrent(r),
    joinProposed(r),
    r.proposedRelations.filter((p) => p.writable).length,
    r.status,
    r.writeStatus,
    r.checkedAt,
  ]);
}

/**
 * One row per PROPOSED RELATION — the actual review list. `Approve (Y/N)`
 * is blank on export and exists purely for a reviewer's own tracking
 * (printed, emailed, marked up by hand); the app never reads it back. What
 * actually gets written to Strapi is decided by what's selected and
 * confirmed in the web UI's Write button, not by anything typed here.
 */
export function toProposalRows(rows: RelationTableRow[]): WorkbookCell[][] {
  const sorted = [...rows].sort((a, b) => a.title.localeCompare(b.title));
  const out: WorkbookCell[][] = [];
  let n = 0;
  for (const r of sorted) {
    for (const p of r.proposedRelations) {
      n++;
      out.push([
        n,
        r.contentType,
        r.title,
        r.slug,
        p.relationType,
        p.targetContentType,
        p.targetTitle,
        p.targetSlug,
        p.rationale,
        p.writable ? "Yes" : "No — report-only",
        "",
        r.writeStatus,
      ]);
    }
  }
  return out;
}

function sheetFrom(header: readonly string[], cells: WorkbookCell[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet([[...header], ...cells]);
  // Widths only — see lib/resource-workbook.ts's sheetFrom for why freeze
  // panes/autofilter are deliberately absent (unsupported on write by the
  // community build of SheetJS).
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  return sheet;
}

const OVERVIEW_WIDTHS = [6, 16, 46, 40, 60, 60, 10, 20, 22, 22];
const PROPOSALS_WIDTHS = [6, 16, 40, 34, 22, 16, 40, 34, 60, 18, 14, 20];

export function buildRelationsWorkbook(rows: RelationTableRow[]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheetFrom(OVERVIEW_HEADER, toOverviewRows(rows), OVERVIEW_WIDTHS), OVERVIEW_SHEET_NAME);
  XLSX.utils.book_append_sheet(
    workbook,
    sheetFrom(PROPOSALS_HEADER, toProposalRows(rows), PROPOSALS_WIDTHS),
    PROPOSALS_SHEET_NAME,
  );
  return workbook;
}
