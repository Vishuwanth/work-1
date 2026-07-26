import { describe, it, expect } from "vitest";
import { parsePages, readPages, pageKey } from "@/lib/pages";

const HEADER = "collection,slug,title,faq_done,role,pillar_association";

describe("parsePages", () => {
  it("reads a full row", () => {
    const { pages } = parsePages(
      `${HEADER}\nguides,advanced-cancer-treatment,Advanced Cancer Treatment,Yes,PILLAR PAGE,Advanced Cancer Treatment\n`,
    );
    expect(pages).toEqual([
      {
        collection: "guides",
        slug: "advanced-cancer-treatment",
        title: "Advanced Cancer Treatment",
        faqDone: true,
        role: "PILLAR PAGE",
        pillarAssociation: "Advanced Cancer Treatment",
      },
    ]);
  });

  it("treats any faq_done other than Yes as not done", () => {
    const { pages } = parsePages(
      `${HEADER}\ninsights,a,A,No,,\ninsights,b,B,,,\ninsights,c,C,yes,,\n`,
    );
    expect(pages.map((p) => p.faqDone)).toEqual([false, false, true]);
  });

  it("keeps a blank role blank rather than guessing", () => {
    const { pages } = parsePages(`${HEADER}\ninsights,a,A,No,,\n`);
    expect(pages[0].role).toBe("");
  });

  it("normalizes an unrecognized role to Support Page", () => {
    const { pages } = parsePages(`${HEADER}\ninsights,a,A,No,Something Else,\n`);
    expect(pages[0].role).toBe("Support Page");
  });

  it("skips rows missing collection or slug and counts them", () => {
    const { pages, skipped } = parsePages(
      `${HEADER}\ninsights,,A,No,,\n,b,B,No,,\ninsights,c,C,No,,\n`,
    );
    expect(pages).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("skips rows with an unknown collection", () => {
    const { pages, skipped } = parsePages(`${HEADER}\nblogs,a,A,No,,\n`);
    expect(pages).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("preserves commas inside a quoted title", () => {
    const { pages } = parsePages(
      `${HEADER}\ninsights,x,"Cost: China, India, USA",No,,\n`,
    );
    expect(pages[0].title).toBe("Cost: China, India, USA");
  });
});

describe("pageKey", () => {
  it("joins collection and slug", () => {
    expect(pageKey({ collection: "guides", slug: "abc" })).toBe("guides/abc");
  });
});

describe("readPages (real source file)", () => {
  it("reads all 865 live pages with no skips", () => {
    const { pages, skipped } = readPages();
    expect(pages).toHaveLength(865);
    expect(skipped).toBe(0);
  });

  it("has 449 pages still needing FAQs", () => {
    const { pages } = readPages();
    expect(pages.filter((p) => !p.faqDone)).toHaveLength(449);
  });

  it("has unique collection/slug keys", () => {
    const { pages } = readPages();
    expect(new Set(pages.map(pageKey)).size).toBe(pages.length);
  });
});
