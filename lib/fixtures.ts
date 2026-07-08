// Pure fixture helpers, ported from scripts/generate_faq.py and the dashboard's
// applyEdits/normalize logic. No fs, no mutation of inputs.
import type { Fixture, FaqSection, ReviewRecord } from "@/lib/types";

export const VERIFY_RE = /^\s*⚠\s*VERIFY:\s*/;

/** Strip a leading "⚠ VERIFY:" prefix; report whether it was present. */
export function cleanSlug(raw: unknown): { value: string; needsVerify: boolean } {
  const s = String(raw ?? "");
  return { value: s.replace(VERIFY_RE, "").trim(), needsVerify: VERIFY_RE.test(s) };
}

/** The FAQ section regardless of which key held it. */
export function getSection(fx: Fixture): FaqSection | null {
  return fx.section || fx.sectionToMerge || null;
}

/** Which key held the section (preserved on output). */
export function sectionKey(fx: Fixture): "section" | "sectionToMerge" {
  return fx.sectionToMerge ? "sectionToMerge" : "section";
}

/** Total FAQ items across all groups. */
export function faqCount(fx: Fixture): number {
  const s = getSection(fx);
  if (!s) return 0;
  return (s.groups || []).reduce((n, g) => n + (g.items || []).length, 0);
}

/** Count of "⚠ VERIFY" fields (slug + route): 0, 1, or 2. */
export function verifyFlags(fx: Fixture): number {
  return [fx.slug, fx.route].filter((v) => VERIFY_RE.test(String(v ?? ""))).length;
}

/** True when the fixture carries a well-formed faq section. */
export function isFaqShape(fx: Fixture): boolean {
  const s = getSection(fx);
  return !!(s && s.type === "faq" && Array.isArray(s.groups));
}

/** Guarantee an answer stays wrapped in a single <p>...</p>. */
export function ensureP(html: unknown): string {
  const t = String(html ?? "").trim();
  return /^<p>[\s\S]*<\/p>$/.test(t) ? t : `<p>${t.replace(/^<p>|<\/p>$/g, "")}</p>`;
}

/**
 * Deep-clone the fixture and apply a review record's edits:
 * answer edits (keyed "<groupIndex>.<itemIndex>") wrapped via ensureP,
 * plus resolved slug/route replacing any "⚠ VERIFY" value. Never mutates input.
 */
export function applyEdits(fx: Fixture, rec: ReviewRecord): Fixture {
  const out: Fixture = JSON.parse(JSON.stringify(fx));
  const sec = out.sectionToMerge || out.section;
  if (sec) {
    (sec.groups || []).forEach((g, gi) =>
      (g.items || []).forEach((it, ii) => {
        const e = rec.edits.answers[gi + "." + ii];
        if (e != null) it.a = ensureP(e);
      }),
    );
  }
  if (rec.edits.slug) out.slug = rec.edits.slug;
  if (rec.edits.route) out.route = rec.edits.route;
  return out;
}
