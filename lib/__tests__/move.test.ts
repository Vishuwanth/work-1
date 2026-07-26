import { describe, it, expect } from "vitest";
import { applyEdits, getSection, normalizeFixture } from "@/lib/fixtures";
import { buildFixture } from "@/lib/generate";
import type { Fixture, ReviewRecord, Row } from "@/lib/types";

// A freshly generated raw fixture. Slug and route come from the live-site CSV,
// so unlike the old pipeline there is nothing to "resolve" on the way to done/.
const rawFixture: Fixture = {
  pillar: "Leukemia",
  contentType: "Insights",
  runner: "apply-pillar-faqs.js",
  slug: "what-is-leukemia",
  route: "/insights/what-is-leukemia",
  sectionToMerge: {
    type: "faq",
    id: "faq",
    h2: "Leukemia FAQs",
    groups: [
      { title: "", items: [{ q: "What is leukemia?", a: "<p>original answer</p>" }] },
    ],
  },
};

describe("applyEdits (approve → move transform)", () => {
  const record: ReviewRecord = {
    reviewStatus: "approved",
    note: "looks good",
    edits: { answers: { "0.0": "corrected answer" } },
  };

  it("applies the answer edit and keeps it wrapped in <p>", () => {
    const moved = applyEdits(rawFixture, record);
    expect(getSection(moved).groups[0].items[0].a).toBe("<p>corrected answer</p>");
  });

  it("leaves the wrapper fields exactly as generated", () => {
    const moved = applyEdits(rawFixture, record);
    // The reviewer can correct answers, never identity. A move that rewrote slug
    // or route would send the fixture to the wrong live page.
    expect(moved.slug).toBe("what-is-leukemia");
    expect(moved.route).toBe("/insights/what-is-leukemia");
    expect(moved.contentType).toBe("Insights");
    expect(moved.runner).toBe("apply-pillar-faqs.js");
  });

  it("never emits a VERIFY placeholder", () => {
    expect(JSON.stringify(applyEdits(rawFixture, record))).not.toContain("⚠");
  });

  it("does not mutate the input", () => {
    applyEdits(rawFixture, record);
    expect(getSection(rawFixture).groups[0].items[0].a).toBe("<p>original answer</p>");
  });

  it("leaves untouched answers alone", () => {
    const twoItems: Fixture = {
      ...rawFixture,
      sectionToMerge: {
        ...rawFixture.sectionToMerge,
        groups: [
          {
            title: "",
            items: [
              { q: "A?", a: "<p>first</p>" },
              { q: "B?", a: "<p>second</p>" },
            ],
          },
        ],
      },
    };
    const moved = applyEdits(twoItems, record);
    expect(getSection(moved).groups[0].items[1].a).toBe("<p>second</p>");
  });
});

/**
 * The pre-migration corpus still carries "⚠ VERIFY" slugs and "/<section>/" routes
 * from the old pipeline. Exporting those verbatim would hand the live runner a
 * fixture pointing at no page, so the batch export REBUILDS the wrapper from the
 * live-site row and keeps only the FAQ section from the file.
 */
describe("batch export repairs a legacy wrapper", () => {
  const legacy = {
    pillar: "Leukemia",
    contentType: "⚠ VERIFY",
    runner: "⚠ VERIFY: unknown (Content Type not set in sheet)",
    slug: "⚠ VERIFY: what-is-leukemia",
    route: "⚠ VERIFY: /<section>/what-is-leukemia",
    section: {
      type: "faq",
      id: "faq",
      h2: "Leukemia FAQs",
      groups: [{ title: "Basics", items: [{ q: "What is leukemia?", a: "<p>an answer</p>" }] }],
    },
    schemaRecommendation: "FAQPage",
    medicalDisclaimer: "disclaimer",
  };

  const row: Row = {
    collection: "insights",
    slug: "what-is-leukemia",
    title: "What Is Leukemia?",
    faqDone: false,
    role: "",
    pillarAssociation: "Blood Cancer",
  };

  const rec: ReviewRecord = {
    reviewStatus: "approved",
    note: "",
    edits: { answers: {} },
  };

  it("strips every VERIFY placeholder", () => {
    const onDisk = normalizeFixture(legacy)!;
    const exported = buildFixture(row, applyEdits(onDisk, rec).sectionToMerge);
    expect(JSON.stringify(exported)).not.toContain("⚠");
  });

  it("rebuilds identity from the live row, not the file", () => {
    const onDisk = normalizeFixture(legacy)!;
    const exported = buildFixture(row, applyEdits(onDisk, rec).sectionToMerge);
    expect(exported.slug).toBe("what-is-leukemia");
    expect(exported.route).toBe("/insights/what-is-leukemia");
    expect(exported.contentType).toBe("Insights");
    expect(exported.runner).toBe("apply-pillar-faqs.js");
  });

  it("keeps the FAQ content from the file", () => {
    const onDisk = normalizeFixture(legacy)!;
    const exported = buildFixture(row, applyEdits(onDisk, rec).sectionToMerge);
    expect(getSection(exported).groups[0].items[0].q).toBe("What is leukemia?");
    expect(getSection(exported).groups[0].items[0].a).toBe("<p>an answer</p>");
  });

  it("drops the legacy top-level fields", () => {
    const onDisk = normalizeFixture(legacy)!;
    const exported = buildFixture(row, applyEdits(onDisk, rec).sectionToMerge) as unknown as Record<
      string,
      unknown
    >;
    expect(exported.schemaRecommendation).toBeUndefined();
    expect(exported.medicalDisclaimer).toBeUndefined();
    expect(exported.section).toBeUndefined();
  });
});
