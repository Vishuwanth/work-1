import { describe, it, expect } from "vitest";
import { deriveRowViews, overviewStats, throughputByDay } from "@/lib/state";
import type { Row, Fixture, ReviewRecord } from "@/lib/types";

function mkFixture(overrides: Partial<Fixture>): Fixture {
  return {
    pillar: "p",
    contentType: "⚠ VERIFY",
    runner: "r",
    slug: "⚠ VERIFY: s",
    route: "⚠ VERIFY: /x/s",
    section: {
      type: "faq",
      id: "faq",
      h2: "h",
      intro: "i",
      groups: [{ title: "g", items: [{ q: "q", a: "<p>a</p>" }, { q: "q2", a: "<p>a2</p>" }] }],
    },
    schemaRecommendation: "sc",
    medicalDisclaimer: "md",
    ...overrides,
  };
}

const rows: Row[] = [
  { rowNum: 1, pillarName: "Leukemia", title: "Raw One", excelStatus: "Pending", contentType: "", slug: "raw-one" },
  { rowNum: 2, pillarName: "Leukemia", title: "Done One", excelStatus: "Done", contentType: "guide", slug: "done-one" },
  { rowNum: 3, pillarName: "Lymphoma", title: "None", excelStatus: "Pending", contentType: "", slug: "none-one" },
];

describe("deriveRowViews", () => {
  const rawBySlug = new Map<string, Fixture>([["raw-one", mkFixture({ slug: "⚠ VERIFY: raw-one", route: "⚠ VERIFY: /x/raw-one" })]]);
  const doneBySlug = new Map<string, Fixture>([["done-one", mkFixture({ slug: "done-one", route: "/x/done-one" })]]);

  it("derives content state, review status, verify + faq counts", () => {
    const tracker: Record<string, ReviewRecord> = {
      "raw-one": { reviewStatus: "pending", note: "", edits: { answers: {}, slug: "", route: "" } },
      "done-one": { reviewStatus: "approved", note: "", edits: { answers: {}, slug: "", route: "" } },
    };
    const views = deriveRowViews(rows, rawBySlug, doneBySlug, tracker);

    expect(views[0].contentState).toBe("raw");
    expect(views[0].reviewStatus).toBe("pending");
    expect(views[0].verifyCount).toBe(2);
    expect(views[0].faqCount).toBe(2);

    expect(views[1].contentState).toBe("done");
    expect(views[1].reviewStatus).toBe("approved");
    expect(views[1].verifyCount).toBe(0); // done fixture already has clean slug/route

    expect(views[2].contentState).toBe("not-generated");
    expect(views[2].reviewStatus).toBe("pending");
    expect(views[2].faqCount).toBeNull();
    expect(views[2].verifyCount).toBe(0);
  });

  it("verifyCount drops as tracker edits resolve slug/route", () => {
    const tracker: Record<string, ReviewRecord> = {
      "raw-one": { reviewStatus: "pending", note: "", edits: { answers: {}, slug: "raw-one", route: "/x/raw-one" } },
    };
    const views = deriveRowViews(rows, rawBySlug, doneBySlug, tracker);
    expect(views[0].verifyCount).toBe(0);
  });
});

describe("overviewStats", () => {
  it("totals generation, review, and verify counts + per-pillar", () => {
    const tracker: Record<string, ReviewRecord> = {
      "raw-one": { reviewStatus: "pending", note: "", edits: { answers: {}, slug: "", route: "" } },
      "done-one": { reviewStatus: "approved", note: "", edits: { answers: {}, slug: "", route: "" } },
    };
    const rawBySlug = new Map<string, Fixture>([["raw-one", mkFixture({ slug: "⚠ VERIFY: raw-one", route: "⚠ VERIFY: /x/raw-one" })]]);
    const doneBySlug = new Map<string, Fixture>([["done-one", mkFixture({ slug: "done-one", route: "/x/done-one" })]]);
    const views = deriveRowViews(rows, rawBySlug, doneBySlug, tracker);
    const stats = overviewStats(views);

    expect(stats.total).toBe(3);
    expect(stats.generated).toBe(2);
    expect(stats.approved).toBe(1);
    expect(stats.needsWork).toBe(0);
    expect(stats.pending).toBe(2);
    expect(stats.withVerify).toBe(1);
    expect(stats.perPillar).toEqual({ Leukemia: 2 });
  });
});

describe("throughputByDay", () => {
  const now = new Date("2026-07-08T12:00:00Z");
  const mk = (generatedAt?: string): ReviewRecord => ({
    reviewStatus: "pending",
    note: "",
    edits: { answers: {}, slug: "", route: "" },
    generatedAt,
  });

  it("returns a 7-day window (oldest → newest) bucketing generatedAt by UTC day", () => {
    const tracker: Record<string, ReviewRecord> = {
      a: mk("2026-07-08T09:00:00Z"),
      b: mk("2026-07-08T23:30:00Z"),
      c: mk("2026-07-06T01:00:00Z"),
      old: mk("2026-06-01T00:00:00Z"), // outside the window
      never: mk(undefined), // never generated
    };
    const out = throughputByDay(tracker, 7, now);

    expect(out).toHaveLength(7);
    expect(out[0].date).toBe("2026-07-02");
    expect(out[6].date).toBe("2026-07-08");
    expect(out[6].count).toBe(2); // a + b
    expect(out[4].date).toBe("2026-07-06");
    expect(out[4].count).toBe(1); // c
    expect(out.reduce((n, p) => n + p.count, 0)).toBe(3); // old + never excluded
  });
});
