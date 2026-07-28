// Pure, client-safe helpers for the Resources tab.

export function tagList(value: string): string[] {
  return value.split(";").map((t) => t.trim()).filter(Boolean);
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize rows back to CSV text (used for the Export CSV button — client-side, no server round trip). */
export function toCsv<T>(header: (keyof T)[], rows: T[]): string {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(header.map((h) => csvEscape(row[h])).join(","));
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
  category: string;
  tags: string;
  checked: boolean;
  status: string; // "" | "ok" | "needs-manual-review"
  writeStatus: string; // "" | "dry-run" | "applied" | "skipped:..." | "failed:..."
  hasDuplicate: boolean;
  duplicateType: string;
  duplicateSection: string;
  duplicateContent: string;
  reason: string;
}

/**
 * Merges the cheap list with whatever's been persisted to
 * data/resource-checks.json (by slug). Unchecked rows show their existing
 * live category/tags; checked rows show the classifier's proposed (or
 * applied) values instead.
 */
export function mergeResourceRows(list: ResourceListItem[], checks: Record<string, ResourceCheck>): ResourceTableRow[] {
  return list.map((item) => {
    const c = checks[item.slug];
    // Category is part of the live URL path, so the link must be rebuilt from
    // whichever category is CURRENTLY shown (post-write if checked), not the
    // stale one the list fetch saw before any classification ran.
    const category = c ? (c.status === "ok" ? c.new_category : c.old_category) : item.category;
    const tags = c ? tagList(c.status === "ok" ? c.new_tags : c.old_tags).join("; ") : tagList(item.tags).join("; ");
    return {
      slug: item.slug,
      title: item.title,
      link: resourceLink(category, item.slug),
      category,
      tags,
      checked: Boolean(c),
      status: c?.status ?? "",
      writeStatus: c?.write_status ?? "",
      hasDuplicate: c?.hasDuplicate ?? false,
      duplicateType: c?.duplicateType ?? "",
      duplicateSection: c?.duplicateSection ?? "",
      duplicateContent: c?.duplicateContent ?? "",
      reason: c?.reason ?? "",
    };
  });
}

export interface ResourceExportRow {
  title: string;
  link: string;
  category: string;
  tags: string;
  has_duplicate: string; // "Yes" | "No"
  duplicate_type: string;
  duplicate_section: string;
  duplicate_content: string;
}

export const RESOURCE_EXPORT_HEADER: (keyof ResourceExportRow)[] = [
  "title",
  "link",
  "category",
  "tags",
  "has_duplicate",
  "duplicate_type",
  "duplicate_section",
  "duplicate_content",
];

export function toResourceExportRows(rows: ResourceTableRow[]): ResourceExportRow[] {
  return rows.map((r) => ({
    title: r.title,
    link: r.link,
    category: r.category,
    tags: r.tags,
    has_duplicate: r.hasDuplicate ? "Yes" : "No",
    duplicate_type: r.duplicateType,
    duplicate_section: r.duplicateSection,
    duplicate_content: r.duplicateContent,
  }));
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
