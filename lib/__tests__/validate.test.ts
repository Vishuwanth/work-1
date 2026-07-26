import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { validateFixture, expectedItemCount } from "@/lib/validate";
import { readPages, pageKey } from "@/lib/pages";

const BATCH_DIR = resolve(
  process.cwd(),
  "docs/source/cancerfax-faq-generator/batch-2026-07-20",
);

/** A valid support-page fixture: 10 items, one untitled group, CancerFax mentioned once. */
function makeFixture(overrides: Record<string, unknown> = {}) {
  const items = Array.from({ length: 10 }, (_, i) => ({
    q: `Question ${i}?`,
    a: i === 0 ? "<p>CancerFax can help coordinate this.</p>" : `<p>Answer ${i}.</p>`,
  }));
  return {
    pillar: "Some Pillar",
    contentType: "Insights",
    runner: "apply-pillar-faqs.js",
    slug: "a-slug",
    route: "/insights/a-slug",
    sectionToMerge: {
      type: "faq",
      id: "faq",
      h2: "Frequently Asked Questions",
      groups: [{ title: "", items }],
    },
    ...overrides,
  };
}

const EXPECTED = { collection: "insights", slug: "a-slug", role: "" as const };

function checks(raw: unknown, expected = EXPECTED): string[] {
  return validateFixture(raw, expected).map((i) => i.check);
}

describe("expectedItemCount", () => {
  it("is 20 for a pillar page", () => {
    expect(expectedItemCount("PILLAR PAGE")).toBe(20);
  });
  it("is 10 for a support page and for a blank role", () => {
    expect(expectedItemCount("Support Page")).toBe(10);
    expect(expectedItemCount("")).toBe(10);
  });
});

describe("validateFixture", () => {
  it("accepts a well-formed support fixture", () => {
    expect(validateFixture(makeFixture(), EXPECTED)).toEqual([]);
  });

  it("rejects the wrong item count", () => {
    const f = makeFixture();
    (f.sectionToMerge.groups[0].items as unknown[]).pop();
    expect(checks(f)).toContain("item-count");
  });

  it("rejects a support page split across groups", () => {
    const f = makeFixture();
    const items = f.sectionToMerge.groups[0].items;
    f.sectionToMerge.groups = [
      { title: "", items: items.slice(0, 5) },
      { title: "", items: items.slice(5) },
    ];
    expect(checks(f)).toContain("group-shape");
  });

  it("rejects a titled group on a support page", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].title = "Some Heading";
    expect(checks(f)).toContain("group-shape");
  });

  it("accepts a pillar page with 20 items in 5 titled groups", () => {
    const groups = Array.from({ length: 5 }, (_, g) => ({
      title: `Group ${g}`,
      items: Array.from({ length: 4 }, (_, i) => ({
        q: `Q${g}${i}?`,
        a: g === 0 && i === 0 ? "<p>CancerFax can help here.</p>" : `<p>A${g}${i}.</p>`,
      })),
    }));
    const f = makeFixture({ sectionToMerge: { type: "faq", id: "faq", h2: "Frequently Asked Questions", groups } });
    expect(validateFixture(f, { ...EXPECTED, role: "PILLAR PAGE" })).toEqual([]);
  });

  it("rejects an empty question or answer", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[3].q = "";
    expect(checks(f)).toContain("empty-item");
  });

  it("rejects an answer that is not wrapped in <p>", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[3].a = "bare text";
    expect(checks(f)).toContain("answer-html");
  });

  it("rejects a tag other than <p>", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[3].a = "<p>a <strong>b</strong></p>";
    expect(checks(f)).toContain("answer-html");
  });

  // The shipped batch uses a quotable lead paragraph plus supporting context.
  it("accepts a multi-paragraph answer", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[3].a = "<p>Lead answer.</p><p>Supporting context.</p>";
    expect(validateFixture(f, EXPECTED)).toEqual([]);
  });

  it("still rejects a foreign tag inside a multi-paragraph answer", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[3].a = "<p>Lead.</p><ul><li>x</li></ul>";
    expect(checks(f)).toContain("answer-html");
  });

  it("rejects a stray VERIFY marker", () => {
    expect(checks(makeFixture({ slug: "⚠ VERIFY: a-slug" }))).toContain("no-verify");
  });

  it("rejects a wrong route", () => {
    expect(checks(makeFixture({ route: "/guides/a-slug" }))).toContain("route");
  });

  it("rejects a slug that disagrees with the page", () => {
    expect(checks(makeFixture({ slug: "other", route: "/insights/other" }))).toContain("slug");
  });

  it("rejects a wrong contentType", () => {
    expect(checks(makeFixture({ contentType: "Guides" }))).toContain("content-type");
  });

  it("rejects a wrong runner", () => {
    expect(checks(makeFixture({ runner: "seed-faq.js" }))).toContain("runner");
  });

  it("rejects a wrong section type or id", () => {
    const f = makeFixture();
    f.sectionToMerge.type = "faqs";
    expect(checks(f)).toContain("section-keys");
  });

  it("rejects zero CancerFax mentions", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[0].a = "<p>Answer 0.</p>";
    expect(checks(f)).toContain("cancerfax-mentions");
  });

  it("rejects three or more CancerFax mentions", () => {
    const f = makeFixture();
    for (let i = 0; i < 3; i++) {
      f.sectionToMerge.groups[0].items[i].a = "<p>CancerFax helps.</p>";
    }
    expect(checks(f)).toContain("cancerfax-mentions");
  });

  it("accepts exactly two CancerFax mentions", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[1].a = "<p>CancerFax can also assist.</p>";
    expect(validateFixture(f, EXPECTED)).toEqual([]);
  });

  it("rejects junk input", () => {
    expect(checks(null)).toContain("shape");
  });
});

describe("golden files: the shipped batch-2026-07-20 fixtures", () => {
  const { pages } = readPages();
  const byKey = new Map(pages.map((p) => [pageKey(p), p]));
  const files = readdirSync(BATCH_DIR).filter((f) => f.endsWith("-faq-section.json"));

  it("covers all 56 files", () => {
    expect(files).toHaveLength(56);
  });

  const results = files.map((file) => {
    const raw = JSON.parse(readFileSync(resolve(BATCH_DIR, file), "utf8"));
    const collection = String(raw.route ?? "").split("/")[1] ?? "";
    const page = byKey.get(`${collection}/${raw.slug}`);
    const issues = page
      ? validateFixture(raw, { collection, slug: page.slug, role: page.role })
      : [{ check: "unknown-page", message: `${collection}/${raw.slug} not in the live CSV` }];
    return { file, issues };
  });

  it("passes 55 of 56", () => {
    expect(results.filter((r) => r.issues.length === 0)).toHaveLength(55);
  });

  // A real defect in the shipped batch. Asserting the failure proves the validator
  // catches the exact class of bug that reached production.
  it("fails questions-patients-should-ask-about-car-t on item count", () => {
    const bad = results.find(
      (r) => r.file === "questions-patients-should-ask-about-car-t-faq-section.json",
    );
    expect(bad?.issues.map((i) => i.check)).toEqual(["item-count"]);
    expect(bad?.issues[0].message).toContain("9");
    expect(bad?.issues[0].message).toContain("10");
  });

  it("names every other failure, so a regression cannot hide", () => {
    const others = results.filter(
      (r) =>
        r.issues.length > 0 &&
        r.file !== "questions-patients-should-ask-about-car-t-faq-section.json",
    );
    expect(others.map((r) => `${r.file}: ${r.issues.map((i) => i.check).join(",")}`)).toEqual([]);
  });
});
