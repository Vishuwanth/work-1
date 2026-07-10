import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanSlug,
  getSection,
  faqCount,
  verifyFlags,
  isFaqShape,
  ensureP,
  applyEdits,
} from "@/lib/fixtures";
import type { Fixture, ReviewRecord } from "@/lib/types";

const inlineFixture: Fixture = {
  pillar: "Test Topic",
  contentType: "⚠ VERIFY",
  runner: "⚠ VERIFY: unknown",
  slug: "⚠ VERIFY: test-topic",
  route: "⚠ VERIFY: /<section>/test-topic",
  section: {
    type: "faq",
    id: "faq",
    h2: "FAQ",
    intro: "intro",
    groups: [
      { title: "G1", items: [{ q: "Q1", a: "<p>A1</p>" }, { q: "Q2", a: "<p>A2</p>" }] },
      { title: "G2", items: [{ q: "Q3", a: "<p>A3</p>" }] },
    ],
  },
  schemaRecommendation: "schema",
  medicalDisclaimer: "disclaimer",
};

describe("fixture helpers", () => {
  it("cleanSlug strips the VERIFY prefix and flags it", () => {
    expect(cleanSlug("⚠ VERIFY: test-topic")).toEqual({ value: "test-topic", needsVerify: true });
    expect(cleanSlug("plain")).toEqual({ value: "plain", needsVerify: false });
  });

  it("getSection resolves either key", () => {
    expect(getSection(inlineFixture)).toBe(inlineFixture.section);
    const merged: Fixture = { ...inlineFixture, section: undefined, sectionToMerge: inlineFixture.section };
    expect(getSection(merged)).toBe(merged.sectionToMerge);
  });

  it("faqCount counts all items", () => {
    expect(faqCount(inlineFixture)).toBe(3);
  });

  it("verifyFlags counts VERIFY in slug + route (0/1/2)", () => {
    expect(verifyFlags(inlineFixture)).toBe(2);
    expect(verifyFlags({ ...inlineFixture, route: "/ok/test-topic" })).toBe(1);
    expect(verifyFlags({ ...inlineFixture, slug: "test-topic", route: "/ok" })).toBe(0);
  });

  it("isFaqShape is true for a faq section with groups array", () => {
    expect(isFaqShape(inlineFixture)).toBe(true);
    expect(isFaqShape({ ...inlineFixture, section: undefined, sectionToMerge: undefined })).toBe(false);
  });

  it("ensureP wraps plain text once", () => {
    expect(ensureP("hello")).toBe("<p>hello</p>");
    expect(ensureP("<p>hello</p>")).toBe("<p>hello</p>");
  });

  it("applyEdits wraps an answer edit, resolves slug/route, and does not mutate input", () => {
    const rec: ReviewRecord = {
      reviewStatus: "pending",
      note: "",
      edits: { answers: { "0.0": "edited answer" }, slug: "test-topic", route: "/ok/test-topic" },
    };
    const out = applyEdits(inlineFixture, rec);
    expect(getSection(out)!.groups[0].items[0].a).toBe("<p>edited answer</p>");
    expect(out.slug).toBe("test-topic");
    expect(out.route).toBe("/ok/test-topic");
    // input untouched
    expect(getSection(inlineFixture)!.groups[0].items[0].a).toBe("<p>A1</p>");
    expect(inlineFixture.slug).toBe("⚠ VERIFY: test-topic");
  });
});

describe("fixture helpers against a real fixture", () => {
  const raw = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "lib/__tests__/fixtures/what-is-the-difference-between-leukemia-lymphoma-and-myeloma-faq-section.json",
      ),
      "utf8",
    ),
  ) as Fixture;

  it("reports 18 FAQs, 2 verify flags, and a valid faq shape", () => {
    expect(faqCount(raw)).toBe(18);
    expect(verifyFlags(raw)).toBe(2);
    expect(isFaqShape(raw)).toBe(true);
  });
});
