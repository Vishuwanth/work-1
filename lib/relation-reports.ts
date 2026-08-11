// Pure, client-safe row merging for the Relations tab — the relations
// analogue of lib/resource-reports.ts's mergeResourceRows. Kept separate
// from the server-only lib/relations/* (which requires Node's `fs`/`child_process`)
// so a client component can import it directly.

export interface ContentTypeInfo {
  apiId: string;
  plural: string;
  label: string;
  entryCount: number;
  titleField: string | null;
  lastNameField: string | null;
  slugField: string | null;
  excerptField: string | null;
  relationFields: { field: string; cardinality: "one" | "many"; targetApiId: string; reserved: boolean; nonContent: boolean }[];
}

export interface RelationEntryListItem {
  contentType: string;
  documentId: string;
  slug: string;
  title: string;
  excerpt: string;
}

export interface ProposedRelation {
  relationType: string;
  targetContentType: string;
  targetSlug: string;
  targetTitle: string;
  targetDocumentId: string;
  rationale: string;
  writable: boolean;
}

export interface CurrentRelationItem {
  field: string;
  documentId: string;
  contentType: string | null;
  title: string;
}

export interface RelationCheck {
  key: string;
  contentType: string;
  slug: string;
  title: string;
  documentId?: string;
  currentRelations?: CurrentRelationItem[];
  proposedRelations?: ProposedRelation[];
  status?: "ok" | "needs-manual-review" | "failed" | "";
  reason?: string;
  write_status?: string;
  checkedAt?: string;
}

export interface RelationTableRow {
  key: string;
  contentType: string;
  slug: string;
  title: string;
  excerpt: string;
  currentRelations: CurrentRelationItem[];
  proposedRelations: ProposedRelation[];
  status: string;
  reason: string;
  writeStatus: string;
  checked: boolean;
  checkedAt: string;
}

/** `${contentType}/${slug}` — the one identity format shared with lib/relations/classify.js's entryKey and lib/page-key.ts's pageKey. */
export function entryKey(contentType: string, slug: string): string {
  return `${contentType}/${slug}`;
}

/** Joins the cheap entry list with persisted check results — a list item with no matching check is a never-run row, not an error. */
export function mergeRelationRows(
  list: RelationEntryListItem[],
  checks: Record<string, RelationCheck>,
): RelationTableRow[] {
  return list.map((item) => {
    const key = entryKey(item.contentType, item.slug);
    const check = checks[key];
    return {
      key,
      contentType: item.contentType,
      slug: item.slug,
      title: item.title,
      excerpt: item.excerpt,
      currentRelations: check?.currentRelations ?? [],
      proposedRelations: check?.proposedRelations ?? [],
      status: check?.status ?? "",
      reason: check?.reason ?? "",
      writeStatus: check?.write_status ?? "",
      checked: Boolean(check),
      checkedAt: check?.checkedAt ?? "",
    };
  });
}
