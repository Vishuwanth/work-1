import { describe, it, expect } from "vitest";
import { buildPrompt, pageTargets, wrapSection, parseSectionFromOutput, normalizeContentType } from "@/lib/generate";
import type { Row, FaqSection } from "@/lib/types";

const blankRow: Row = {
  rowNum: 463,
  pillarName: "Blood Cancers",
  title: "What is the difference between leukemia, lymphoma, and myeloma?",
  excelStatus: "Pending",
  contentType: "",
  slug: "what-is-the-difference-between-leukemia-lymphoma-and-myeloma",
};

const doneGuideRow: Row = {
  rowNum: 464,
  pillarName: "Leukemia",
  title: "AML treatment guide: induction, consolidation, and when is transplant needed?",
  excelStatus: "Done",
  contentType: "guide",
  slug: "aml-treatment-guide-induction-consolidation-and-when-is-transplant-needed",
};

const section: FaqSection = {
  type: "faq",
  id: "faq",
  h2: "FAQ",
  intro: "intro",
  groups: [{ title: "G", items: [{ q: "q", a: "<p>a</p>" }] }],
};

describe("normalizeContentType", () => {
  it("maps free-text content types to a canonical kind (substring, case-insensitive)", () => {
    expect(normalizeContentType("Clinical Trial")).toBe("trial");
    expect(normalizeContentType("Treatment Page")).toBe("treatment");
    expect(normalizeContentType("condition")).toBe("treatment");
    expect(normalizeContentType("Guides")).toBe("guide");
    expect(normalizeContentType("Insights")).toBe("insight");
    expect(normalizeContentType("Support")).toBe("insight");
    expect(normalizeContentType("Pillar")).toBe("pillar");
    expect(normalizeContentType("")).toBe("unknown");
    expect(normalizeContentType("something else")).toBe("unknown");
  });
});

describe("pageTargets", () => {
  it("defaults blank content type to the pillar target of 18", () => {
    expect(pageTargets("").count).toBe(18);
    expect(pageTargets("guide").count).toBe(8);
    expect(pageTargets("Clinical Trial").count).toBe(6);
  });
});

describe("buildPrompt", () => {
  const prompt = buildPrompt(blankRow);

  it("includes the title, the 18-FAQ target, and the master-prompt header", () => {
    expect(prompt).toContain(blankRow.title);
    expect(prompt).toContain("18");
    expect(prompt).toContain("CANCERFAX FAQ GENERATION PROMPT FOR CLAUDE");
    expect(prompt).toContain("Return ONLY the section JSON");
  });
});

describe("wrapSection", () => {
  it("wraps a blank-type pending row with VERIFY slug/route and a `section` key", () => {
    const fx = wrapSection(blankRow, section);
    expect(fx.slug).toBe("⚠ VERIFY: what-is-the-difference-between-leukemia-lymphoma-and-myeloma");
    expect(fx.route).toContain("⚠ VERIFY:");
    expect(fx.section).toBe(section);
    expect(fx.sectionToMerge).toBeUndefined();
    expect(fx.medicalDisclaimer).toContain("educational purposes only");
    expect(Object.keys(fx)).toEqual([
      "pillar",
      "contentType",
      "runner",
      "slug",
      "route",
      "section",
      "schemaRecommendation",
      "medicalDisclaimer",
    ]);
  });

  it("uses sectionToMerge + a routed guide base for a Done guide row", () => {
    const fx = wrapSection(doneGuideRow, section);
    expect(fx.sectionToMerge).toBe(section);
    expect(fx.section).toBeUndefined();
    expect(fx.route).toBe("⚠ VERIFY: /guides/aml-treatment-guide-induction-consolidation-and-when-is-transplant-needed");
    expect(fx.runner).toBe("seed-guide.js");
  });
});

describe("parseSectionFromOutput", () => {
  it("strips a preamble and extracts the JSON object", () => {
    const out = `Sure, here is the section:\n\n${JSON.stringify(section)}\n\nHope that helps!`;
    expect(parseSectionFromOutput(out)).toEqual(section);
  });

  it("throws when there is no JSON object", () => {
    expect(() => parseSectionFromOutput("no json here")).toThrow();
  });
});
