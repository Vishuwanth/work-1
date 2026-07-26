// Pure fixture helpers. No fs, no mutation of inputs.
// The canonical format is the one in docs/source/cancerfax-faq-generator/batch-2026-07-20/.
import type { Fixture, FaqSection, FaqGroup, FaqItem, ReviewRecord } from "@/lib/types";

/** Title-case of a collection, which is exactly what the fixture's contentType must be. */
export function titleCaseCollection(c: string): "Guides" | "Insights" | "Treatments" {
  switch (c) {
    case "guides":
      return "Guides";
    case "insights":
      return "Insights";
    case "treatments":
      return "Treatments";
    default:
      throw new Error(`unknown collection: ${c}`);
  }
}

/** The one true route shape. */
export function routeFor(collection: string, slug: string): string {
  return `/${collection}/${slug}`;
}

/**
 * The fixture filename the team's runner expects. Lives here rather than in
 * lib/generate.ts so lib/batch-export.ts can use it without pulling
 * node:child_process into its import graph.
 */
export function fixtureFilename(slug: string): string {
  return `${slug}-faq-section.json`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * The section's `type` and `id` as the FILE stated them. normalizeFixture forces
 * both to "faq", so the validator has to look at the raw input to catch a fixture
 * that named them wrong.
 */
export function rawSectionKeys(raw: unknown): { type: unknown; id: unknown } {
  const r = asRecord(raw);
  const sec = r ? (asRecord(r.sectionToMerge) ?? asRecord(r.section)) : null;
  return { type: sec?.type, id: sec?.id };
}

/**
 * One batch fixture (integrative-oncology-...) uses `question`/`answer` while the
 * other 55 use `q`/`a`. Accept both on read; always emit `q`/`a`.
 */
function normItem(v: unknown): FaqItem | null {
  const r = asRecord(v);
  if (!r) return null;
  const q = r.q ?? r.question;
  const a = r.a ?? r.answer;
  if (typeof q !== "string" || typeof a !== "string") return null;
  return { q, a };
}

function normGroup(v: unknown): FaqGroup | null {
  const r = asRecord(v);
  if (!r || !Array.isArray(r.items)) return null;
  const items = r.items.map(normItem).filter((i): i is FaqItem => i !== null);
  return { title: typeof r.title === "string" ? r.title : "", items };
}

/**
 * Coerce any historical fixture shape into the canonical one:
 * `section` or `sectionToMerge` both become `sectionToMerge`; legacy top-level
 * `schemaRecommendation` / `medicalDisclaimer` are dropped; `intro` is kept only
 * when present. Returns null when there is no usable faq section.
 */
export function normalizeFixture(raw: unknown): Fixture | null {
  const r = asRecord(raw);
  if (!r) return null;
  const secRaw = asRecord(r.sectionToMerge) ?? asRecord(r.section);
  if (!secRaw || !Array.isArray(secRaw.groups)) return null;

  const section: FaqSection = {
    type: "faq",
    id: "faq",
    h2: typeof secRaw.h2 === "string" ? secRaw.h2 : "Frequently Asked Questions",
    groups: secRaw.groups.map(normGroup).filter((g): g is FaqGroup => g !== null),
  };
  if (typeof secRaw.intro === "string" && secRaw.intro !== "") section.intro = secRaw.intro;

  return {
    pillar: typeof r.pillar === "string" ? r.pillar : "",
    contentType: r.contentType as Fixture["contentType"],
    runner: "apply-pillar-faqs.js",
    slug: typeof r.slug === "string" ? r.slug : "",
    route: typeof r.route === "string" ? r.route : "",
    sectionToMerge: section,
  };
}

export function getSection(fx: Fixture): FaqSection {
  return fx.sectionToMerge;
}

/** Total FAQ items across all groups. */
export function faqCount(fx: Fixture): number {
  return (fx.sectionToMerge?.groups ?? []).reduce((n, g) => n + (g.items ?? []).length, 0);
}

/** True when the fixture carries a well-formed faq section. */
export function isFaqShape(fx: Fixture): boolean {
  const s = fx.sectionToMerge;
  return !!(s && s.type === "faq" && Array.isArray(s.groups));
}

/** Guarantee an answer stays wrapped in a single <p>...</p>. */
export function ensureP(html: unknown): string {
  const t = String(html ?? "").trim();
  return /^<p>[\s\S]*<\/p>$/.test(t) ? t : `<p>${t.replace(/^<p>|<\/p>$/g, "")}</p>`;
}

/**
 * Deep-clone the fixture and apply a review record's answer edits, keyed
 * "<groupIndex>.<itemIndex>" and wrapped via ensureP. Never mutates input.
 * Slug and route are no longer editable — they come from the live-site CSV.
 */
export function applyEdits(fx: Fixture, rec: ReviewRecord): Fixture {
  const out: Fixture = JSON.parse(JSON.stringify(fx));
  (out.sectionToMerge.groups ?? []).forEach((g, gi) =>
    (g.items ?? []).forEach((it, ii) => {
      const e = rec.edits.answers[gi + "." + ii];
      if (e != null) it.a = ensureP(e);
    }),
  );
  return out;
}
