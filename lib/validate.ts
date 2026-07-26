// The gate every generated fixture passes before it reaches output/faq/raw/.
// Rules come from docs/specs/2026-07-27-live-csv-source-mapping-design.md §5.4,
// which encodes the CancerFax FAQ AEO instructions plus the team's 2026-07-20
// fixed-count direction.
import type { PageRole } from "@/lib/pages";
import {
  normalizeFixture,
  faqCount,
  titleCaseCollection,
  routeFor,
  rawSectionKeys,
} from "@/lib/fixtures";

export interface ValidationIssue {
  /** Stable machine-readable check id, e.g. "item-count". */
  check: string;
  message: string;
}

export interface ExpectedPage {
  collection: string;
  slug: string;
  role: PageRole;
}

/** Fixed counts, not ranges. A blank role is a Support Page. */
export function expectedItemCount(role: PageRole): number {
  return role === "PILLAR PAGE" ? 20 : 10;
}

/**
 * One or more <p>...</p> blocks and nothing else. The shipped batch uses
 * multi-paragraph answers (a quotable lead paragraph plus supporting context),
 * so a single-paragraph rule would reject real, correct fixtures. What stays
 * banned is any tag other than <p>: no lists, headings, bold, or links.
 */
const P_ONLY = /^(?:<p>(?:(?!<\/?[a-zA-Z])[\s\S])*<\/p>)+$/;

export function validateFixture(raw: unknown, expected: ExpectedPage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (check: string, message: string) => issues.push({ check, message });

  const fx = normalizeFixture(raw);
  if (!fx) {
    add("shape", "not a fixture object with a faq section");
    return issues;
  }

  const isPillar = expected.role === "PILLAR PAGE";
  const wantCount = expectedItemCount(expected.role);
  const groups = fx.sectionToMerge.groups ?? [];

  // 1. exact item count
  const count = faqCount(fx);
  if (count !== wantCount) {
    add("item-count", `${count} items, expected ${wantCount} (role=${expected.role || "blank"})`);
  }

  // 2. group shape
  if (isPillar) {
    if (groups.length < 4 || groups.length > 5) {
      add("group-shape", `${groups.length} groups, expected 4-5 for a pillar page`);
    } else if (groups.some((g) => g.title.trim() === "")) {
      add("group-shape", "every pillar group needs a title");
    }
  } else if (groups.length !== 1) {
    add("group-shape", `${groups.length} groups, expected exactly 1 for a support page`);
  } else if (groups[0].title !== "") {
    add("group-shape", `support-page group title must be "", got "${groups[0].title}"`);
  }

  // 3 + 4. per-item content and HTML
  let emptyItem = false;
  let badHtml = false;
  for (const g of groups) {
    for (const it of g.items ?? []) {
      if (it.q.trim() === "" || it.a.trim() === "") emptyItem = true;
      if (!P_ONLY.test(it.a.trim())) badHtml = true;
    }
  }
  if (emptyItem) add("empty-item", "an item has an empty question or answer");
  if (badHtml) add("answer-html", "every answer must be <p>...</p> blocks with no other tag");

  // 5. no VERIFY marker anywhere
  if (JSON.stringify(fx).includes("⚠")) {
    add("no-verify", "fixture still contains a ⚠ VERIFY placeholder");
  }

  // 6 + 7 + 8 + 9. wrapper fields
  if (fx.slug !== expected.slug) {
    add("slug", `slug "${fx.slug}" does not match the live page "${expected.slug}"`);
  }
  const wantRoute = routeFor(expected.collection, expected.slug);
  if (fx.route !== wantRoute) {
    add("route", `route "${fx.route}", expected "${wantRoute}"`);
  }
  let wantType: string;
  try {
    wantType = titleCaseCollection(expected.collection);
  } catch {
    wantType = "";
    add("content-type", `unknown collection "${expected.collection}"`);
  }
  if (wantType && fx.contentType !== wantType) {
    add("content-type", `contentType "${fx.contentType}", expected "${wantType}"`);
  }
  // Read the RAW runner for the same reason as the section keys below:
  // normalizeFixture hardcodes it, so checking fx.runner could never fail.
  const rawRunner =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>).runner : undefined;
  if (rawRunner !== "apply-pillar-faqs.js") {
    add("runner", `runner "${String(rawRunner)}", expected "apply-pillar-faqs.js"`);
  }
  // Read the RAW keys: normalizeFixture coerces both to "faq", so checking the
  // normalized fixture here would make this assertion unfalsifiable.
  const keys = rawSectionKeys(raw);
  if (keys.type !== "faq" || keys.id !== "faq") {
    add(
      "section-keys",
      `sectionToMerge.type and .id must both be "faq", got "${String(keys.type)}" / "${String(keys.id)}"`,
    );
  }

  // 10. CancerFax mention discipline: 0 reads impersonal, 3+ reads promotional.
  const mentions = groups
    .flatMap((g) => g.items ?? [])
    .filter((it) => it.a.includes("CancerFax")).length;
  if (mentions < 1 || mentions > 2) {
    add("cancerfax-mentions", `CancerFax mentioned in ${mentions} answers, expected 1-2`);
  }

  return issues;
}
