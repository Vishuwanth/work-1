import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv } from "@/lib/csv";

export const PAGES_CSV = "docs/source/cancerfax-faq-generator/all-pages-faq-status.csv";

export type Collection = "guides" | "insights" | "treatments";
export type PageRole = "PILLAR PAGE" | "Support Page" | "";

const COLLECTIONS = new Set<string>(["guides", "insights", "treatments"]);

/** One live published page, as the site's own status CSV describes it. */
export interface LivePage {
  collection: Collection;
  slug: string;
  title: string;
  faqDone: boolean;
  role: PageRole;
  pillarAssociation: string;
}

export interface PagesResult {
  pages: LivePage[];
  /** Rows dropped for a missing/unknown collection or a missing slug. */
  skipped: number;
}

/** The identity of a page everywhere in the app: tracker keys, React keys, lookups. */
export function pageKey(p: { collection: string; slug: string }): string {
  return `${p.collection}/${p.slug}`;
}

/**
 * A blank role means "Support Page" per the generator skill, but we keep the blank
 * so the UI can show that the source never said. Any other unrecognized value is
 * normalized to Support Page — the count rule treats blank and Support alike.
 */
function toRole(raw: string): PageRole {
  if (raw === "") return "";
  if (raw === "PILLAR PAGE") return "PILLAR PAGE";
  return "Support Page";
}

export function parsePages(csvText: string): PagesResult {
  const pages: LivePage[] = [];
  let skipped = 0;
  for (const r of parseCsv(csvText)) {
    const collection = r.collection ?? "";
    const slug = r.slug ?? "";
    if (slug === "" || !COLLECTIONS.has(collection)) {
      skipped++;
      continue;
    }
    pages.push({
      collection: collection as Collection,
      slug,
      title: r.title ?? "",
      faqDone: (r.faq_done ?? "").toLowerCase() === "yes",
      role: toRole(r.role ?? ""),
      pillarAssociation: r.pillar_association ?? "",
    });
  }
  return { pages, skipped };
}

export function readPages(csvPath?: string): PagesResult {
  const path = csvPath ?? resolve(process.cwd(), PAGES_CSV);
  return parsePages(readFileSync(path, "utf8"));
}
