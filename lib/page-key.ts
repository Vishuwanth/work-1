// Client-safe half of lib/pages.ts: the page identity types and key builder, with
// NO Node imports, so client components can use them. Same split as
// lib/gen-errors.ts vs lib/generate.ts. The fs-backed readers live in lib/pages.ts.

export type Collection = "guides" | "insights" | "treatments";
export type PageRole = "PILLAR PAGE" | "Support Page" | "";

/** One live published page, as the site's own status CSV describes it. */
export interface LivePage {
  collection: Collection;
  slug: string;
  title: string;
  faqDone: boolean;
  role: PageRole;
  pillarAssociation: string;
}

/** The identity of a page everywhere in the app: tracker keys, React keys, lookups. */
export function pageKey(p: { collection: string; slug: string }): string {
  return `${p.collection}/${p.slug}`;
}
