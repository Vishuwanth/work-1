// Pure, client-safe helpers for the Resources tab.

export function tagList(value: string): string[] {
  return value.split(";").map((t) => t.trim()).filter(Boolean);
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize keyed rows to CSV text (client-side, no server round trip). */
export function toCsv<T>(header: (keyof T)[], rows: T[]): string {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(header.map((h) => csvEscape(row[h])).join(","));
  return lines.join("\n") + "\n";
}

/** Same, for positional rows — what toSharedRows produces. */
export function toCsvFromCells(header: readonly string[], rows: (string | number)[][]): string {
  const lines = [header.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return lines.join("\n") + "\n";
}

// ─── Live public link ──────────────────────────────────────────────────────────

const PROD_SITE_ORIGIN = "https://www.cancerfax.com";

/**
 * The live public URL for a resource: /resources/<category-slug>/<slug> — the
 * category IS part of the path (cancerfax-frontend's catch-all
 * resources/[...slug] route), so this must be rebuilt whenever category
 * changes, not just the slug. A resource with no category yet has no
 * meaningful live link.
 */
export function resourceLink(categorySlug: string, slug: string): string {
  if (!categorySlug) return "";
  return `${PROD_SITE_ORIGIN}/resources/${categorySlug}/${slug}`;
}

// ─── Interactive resource table (list + persisted Run/Write results) ──────────

/** One row from the cheap /api/resources/list fetch — no content, just enough to browse/select. */
export interface ResourceListItem {
  slug: string;
  title: string;
  category: string;
  tags: string;
}

/** One persisted Run/Write result (data/resource-checks.json), keyed by slug. */
export interface ResourceCheck {
  title: string;
  old_category: string;
  new_category: string;
  old_tags: string;
  new_tags: string;
  status: string; // "ok" | "needs-manual-review"
  reason: string;
  write_status: string; // "dry-run" | "applied" | "skipped:..." | "failed:..."
  /** Did the duplicate audit actually run? Absent on rows written before it was tracked. */
  duplicateChecked?: boolean;
  hasDuplicate: boolean;
  duplicateType: string;
  duplicateSection: string;
  duplicateContent: string;
  checkedAt: string;
}

/** One row of the interactive table: list data, enriched from a persisted check if one exists. */
export interface ResourceTableRow {
  slug: string;
  title: string;
  link: string;
  /** What to SHOW — the proposal once classified, otherwise what's live. */
  category: string;
  tags: string;
  /** What's actually live right now, for the diff and the link. */
  oldCategory: string;
  oldTags: string;
  /** True when the proposal differs from what's live — i.e. there's something to review. */
  changed: boolean;
  applied: boolean;
  checked: boolean;
  status: string; // "" | "ok" | "needs-manual-review"
  writeStatus: string; // "" | "dry-run" | "applied" | "skipped:..." | "failed:..."
  /** False when the audit never ran — distinct from "ran and found nothing". */
  duplicateChecked: boolean;
  hasDuplicate: boolean;
  duplicateType: string;
  duplicateSection: string;
  duplicateContent: string;
  reason: string;
  checkedAt: string;
}

/**
 * Merges the cheap list with whatever's been persisted to
 * data/resource-checks.json (by slug). Unchecked rows show their existing
 * live category/tags; classified rows show the proposal, plus the live values
 * alongside so the table can render the change rather than just the outcome.
 */
export function mergeResourceRows(list: ResourceListItem[], checks: Record<string, ResourceCheck>): ResourceTableRow[] {
  return list.map((item) => {
    const c = checks[item.slug];
    const proposed = Boolean(c && c.status === "ok");
    const applied = c?.write_status === "applied";

    const oldCategory = c ? c.old_category : item.category;
    const oldTags = tagList(c ? c.old_tags : item.tags).join("; ");
    const category = proposed ? c!.new_category : oldCategory;
    const tags = proposed ? tagList(c!.new_tags).join("; ") : oldTags;

    // The category is part of the live URL path, so the link must use the
    // category that is ACTUALLY live. Using the proposal would 404 for every
    // row that has been classified but not yet written.
    const liveCategory = applied ? c!.new_category : oldCategory;

    return {
      slug: item.slug,
      title: item.title,
      link: resourceLink(liveCategory, item.slug),
      category,
      tags,
      oldCategory,
      oldTags,
      changed: proposed && (category !== oldCategory || tags !== oldTags),
      applied,
      checked: Boolean(c),
      status: c?.status ?? "",
      writeStatus: c?.write_status ?? "",
      duplicateChecked: Boolean(c?.duplicateChecked),
      hasDuplicate: c?.hasDuplicate ?? false,
      duplicateType: c?.duplicateType ?? "",
      duplicateSection: c?.duplicateSection ?? "",
      duplicateContent: c?.duplicateContent ?? "",
      reason: c?.reason ?? "",
      checkedAt: c?.checkedAt ?? "",
    };
  });
}

// ─── Shared shape — the columns that leave this machine ──────────────────────
//
// The committed workbook keeps the full record (see resource-workbook.ts). What
// gets handed to other people — the downloaded .xlsx and the CSV — is this
// narrower set: enough to review a proposed re-tagging, without the operational
// detail (write status, failure reasons, timestamps) that only matters here.
//
// Old and new stay as separate columns. A single `category` column can't be
// reviewed in a spreadsheet — you can't tell a proposal from what's live.

export const SHARED_HEADER = [
  "S.No",
  "Title of Resource",
  "Slug",
  "Category",
  "Old Category",
  "New Category",
  "Old Tags",
  "New Tags",
  "Duplicate",
] as const;

/**
 * "Yes" / "No" / "" — the blank is the point. A duplicate audit only runs on a
 * Run batch, so a row that has only ever been written was never looked at.
 * Reporting that as "No" would claim a check that never happened.
 */
export function duplicateLabel(row: ResourceTableRow): string {
  if (!row.duplicateChecked) return "";
  return row.hasDuplicate ? "Yes" : "No";
}

export type SharedCell = string | number;

/**
 * One array per row, in SHARED_HEADER order, sorted by title and numbered from
 * 1. Both the workbook download and the CSV render from this, so they cannot
 * disagree.
 *
 * `S.No` is renumbered per file rather than carried over: it is a visual
 * counter, not an identity — slug is. The CSV holds only the filtered rows, so
 * a carried-over number would arrive full of gaps.
 */
export function toSharedRows(rows: ResourceTableRow[]): SharedCell[][] {
  return [...rows]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((r, i) => [
      i + 1,
      r.title,
      r.slug,
      r.category,
      r.checked ? r.oldCategory : "",
      // Filled as soon as the classifier proposes something, written or not —
      // this is a review document. The committed workbook is where you look to
      // see whether it actually reached production.
      r.checked && r.status === "ok" ? r.category : "",
      r.checked ? r.oldTags : "",
      r.checked && r.status === "ok" ? r.tags : "",
      duplicateLabel(r),
    ]);
}

// ─── Taxonomy (the live resource-category / resource-tag collections) ─────────

export interface TaxonomyCategory {
  documentId: string;
  name: string;
  slug: string;
}

export interface TaxonomyTag {
  documentId: string;
  name: string;
  slug: string;
  groups: string[];
}

export interface TaxonomyRow {
  kind: "category" | "tag";
  group: string;
  name: string;
  slug: string;
}

export const TAXONOMY_HEADER: (keyof TaxonomyRow)[] = ["kind", "group", "name", "slug"];

/** Flattens the two collections into one exportable table: categories first, then tags grouped. */
export function toTaxonomyRows(categories: TaxonomyCategory[], tags: TaxonomyTag[]): TaxonomyRow[] {
  const catRows: TaxonomyRow[] = categories.map((c) => ({ kind: "category", group: "", name: c.name, slug: c.slug }));
  const tagRows: TaxonomyRow[] = tags.map((t) => ({
    kind: "tag",
    group: t.groups[0] || "(ungrouped)",
    name: t.name,
    slug: t.slug,
  }));
  return [...catRows, ...tagRows];
}
