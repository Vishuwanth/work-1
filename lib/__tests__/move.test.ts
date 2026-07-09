import { describe, it, expect } from "vitest";
import { applyEdits, getSection, verifyFlags } from "@/lib/fixtures";
import type { Fixture, ReviewRecord } from "@/lib/types";

// A freshly generated raw fixture: unresolved (⚠ VERIFY) slug/route and an
// original answer we will correct via the review record.
const rawFixture: Fixture = {
  pillar: "Leukemia",
  contentType: "support",
  runner: "faq_write",
  slug: "⚠ VERIFY: what-is-leukemia",
  route: "⚠ VERIFY: /leukemia/what-is-leukemia",
  section: {
    type: "faq",
    id: "faq",
    h2: "Leukemia FAQs",
    intro: "intro",
    groups: [
      { title: "Basics", items: [{ q: "What is leukemia?", a: "<p>original answer</p>" }] },
    ],
  },
  schemaRecommendation: "FAQPage",
  medicalDisclaimer: "disclaimer",
};

describe("applyEdits (approve → move transform)", () => {
  const record: ReviewRecord = {
    reviewStatus: "approved",
    note: "looks good",
    edits: {
      answers: { "0.0": "corrected answer" },
      slug: "what-is-leukemia",
      route: "/leukemia/what-is-leukemia",
    },
  };

  it("applies the answer edit, resolves slug/route (no ⚠ VERIFY left), and does not mutate the input", () => {
    const moved = applyEdits(rawFixture, record);

    // edit applied and kept wrapped in a single <p>
    expect(getSection(moved)!.groups[0].items[0].a).toBe("<p>corrected answer</p>");
    // slug/route resolved
    expect(moved.slug).toBe("what-is-leukemia");
    expect(moved.route).toBe("/leukemia/what-is-leukemia");
    // no VERIFY flags remain
    expect(verifyFlags(moved)).toBe(0);

    // input untouched
    expect(rawFixture.slug).toBe("⚠ VERIFY: what-is-leukemia");
    expect(getSection(rawFixture)!.groups[0].items[0].a).toBe("<p>original answer</p>");
    expect(verifyFlags(rawFixture)).toBe(2);
  });
});
