import { describe, it, expect } from "vitest";
import {
  normalizeFixture,
  faqCount,
  isFaqShape,
  ensureP,
  applyEdits,
  titleCaseCollection,
  routeFor,
  fixtureFilename,
  rawSectionKeys,
} from "@/lib/fixtures";
import type { Fixture, ReviewRecord } from "@/lib/types";

const RAW = {
  pillar: "Proton therapy",
  contentType: "Treatments",
  runner: "apply-pillar-faqs.js",
  slug: "carbon-ion-therapy",
  route: "/treatments/carbon-ion-therapy",
  sectionToMerge: {
    type: "faq",
    id: "faq",
    h2: "Frequently Asked Questions",
    groups: [{ title: "", items: [{ q: "Q1", a: "<p>A1</p>" }] }],
  },
};

describe("normalizeFixture", () => {
  it("passes a canonical fixture through unchanged", () => {
    expect(normalizeFixture(RAW)).toEqual(RAW);
  });

  it("moves a legacy `section` key to `sectionToMerge`", () => {
    const { sectionToMerge, ...rest } = RAW;
    const fx = normalizeFixture({ ...rest, section: sectionToMerge });
    expect(fx?.sectionToMerge.groups[0].items[0].q).toBe("Q1");
    expect((fx as unknown as Record<string, unknown>).section).toBeUndefined();
  });

  it("renames question/answer to q/a", () => {
    const fx = normalizeFixture({
      ...RAW,
      sectionToMerge: {
        ...RAW.sectionToMerge,
        groups: [{ title: "", items: [{ question: "Q1", answer: "<p>A1</p>" }] }],
      },
    });
    expect(fx?.sectionToMerge.groups[0].items[0]).toEqual({ q: "Q1", a: "<p>A1</p>" });
  });

  it("drops legacy top-level fields", () => {
    const fx = normalizeFixture({
      ...RAW,
      schemaRecommendation: "x",
      medicalDisclaimer: "y",
    }) as unknown as Record<string, unknown>;
    expect(fx.schemaRecommendation).toBeUndefined();
    expect(fx.medicalDisclaimer).toBeUndefined();
  });

  it("keeps intro when present and omits the key when absent", () => {
    const withIntro = normalizeFixture({
      ...RAW,
      sectionToMerge: { ...RAW.sectionToMerge, intro: "Hello" },
    });
    expect(withIntro?.sectionToMerge.intro).toBe("Hello");
    expect("intro" in (normalizeFixture(RAW) as Fixture).sectionToMerge).toBe(false);
  });

  it("returns null for junk", () => {
    expect(normalizeFixture(null)).toBeNull();
    expect(normalizeFixture("nope")).toBeNull();
    expect(normalizeFixture({ pillar: "x" })).toBeNull();
  });
});

describe("faqCount", () => {
  it("sums items across groups", () => {
    const fx = normalizeFixture({
      ...RAW,
      sectionToMerge: {
        ...RAW.sectionToMerge,
        groups: [
          { title: "G1", items: [{ q: "a", a: "<p>1</p>" }, { q: "b", a: "<p>2</p>" }] },
          { title: "G2", items: [{ q: "c", a: "<p>3</p>" }] },
        ],
      },
    }) as Fixture;
    expect(faqCount(fx)).toBe(3);
  });
});

describe("isFaqShape", () => {
  it("accepts the canonical shape", () => {
    expect(isFaqShape(normalizeFixture(RAW) as Fixture)).toBe(true);
  });
});

describe("ensureP", () => {
  it("wraps a bare string", () => {
    expect(ensureP("hello")).toBe("<p>hello</p>");
  });
  it("leaves an already-wrapped string alone", () => {
    expect(ensureP("<p>hello</p>")).toBe("<p>hello</p>");
  });
  it("does not double-wrap after trimming", () => {
    expect(ensureP("  <p>hello</p>  ")).toBe("<p>hello</p>");
  });
});

describe("applyEdits", () => {
  const rec: ReviewRecord = {
    reviewStatus: "approved",
    note: "",
    edits: { answers: { "0.0": "edited" } },
  };

  it("applies an answer edit and wraps it", () => {
    const out = applyEdits(normalizeFixture(RAW) as Fixture, rec);
    expect(out.sectionToMerge.groups[0].items[0].a).toBe("<p>edited</p>");
  });

  it("never mutates the input", () => {
    const fx = normalizeFixture(RAW) as Fixture;
    applyEdits(fx, rec);
    expect(fx.sectionToMerge.groups[0].items[0].a).toBe("<p>A1</p>");
  });
});

describe("titleCaseCollection / routeFor / fixtureFilename", () => {
  it("title-cases each collection", () => {
    expect(titleCaseCollection("guides")).toBe("Guides");
    expect(titleCaseCollection("insights")).toBe("Insights");
    expect(titleCaseCollection("treatments")).toBe("Treatments");
  });
  it("throws on an unknown collection", () => {
    expect(() => titleCaseCollection("blogs")).toThrow(/unknown collection/);
  });
  it("builds the route", () => {
    expect(routeFor("treatments", "carbon-ion-therapy")).toBe("/treatments/carbon-ion-therapy");
  });
  it("builds the fixture filename", () => {
    expect(fixtureFilename("carbon-ion-therapy")).toBe("carbon-ion-therapy-faq-section.json");
  });
});

describe("rawSectionKeys", () => {
  it("reports what the file actually said, not the normalized value", () => {
    const raw = { ...RAW, sectionToMerge: { ...RAW.sectionToMerge, type: "faqs", id: "nope" } };
    expect(rawSectionKeys(raw)).toEqual({ type: "faqs", id: "nope" });
  });
  it("reads a legacy `section` key too", () => {
    const { sectionToMerge, ...rest } = RAW;
    expect(rawSectionKeys({ ...rest, section: sectionToMerge })).toEqual({
      type: "faq",
      id: "faq",
    });
  });
  it("returns undefineds for junk", () => {
    expect(rawSectionKeys(null)).toEqual({ type: undefined, id: undefined });
  });
});
