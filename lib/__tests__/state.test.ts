import { describe, it, expect } from "vitest";
import { deriveRowViews, overviewStats, throughputByDay } from "@/lib/state";
import type { Row, Fixture, ReviewRecord } from "@/lib/types";

function row(collection: Row["collection"], slug: string, extra: Partial<Row> = {}): Row {
  return {
    collection,
    slug,
    title: slug,
    faqDone: false,
    role: "",
    pillarAssociation: "",
    ...extra,
  };
}

function fixture(collection: string, slug: string, items = 1): Fixture {
  return {
    pillar: slug,
    contentType: "Insights",
    runner: "apply-pillar-faqs.js",
    slug,
    route: `/${collection}/${slug}`,
    sectionToMerge: {
      type: "faq",
      id: "faq",
      h2: "Frequently Asked Questions",
      groups: [
        {
          title: "",
          items: Array.from({ length: items }, (_, i) => ({ q: `q${i}`, a: `<p>a${i}</p>` })),
        },
      ],
    },
  };
}

const rec = (patch: Partial<ReviewRecord> = {}): ReviewRecord => ({
  reviewStatus: "pending",
  note: "",
  edits: { answers: {} },
  ...patch,
});

describe("deriveRowViews", () => {
  const rows = [row("insights", "a"), row("guides", "b"), row("treatments", "c")];

  it("marks a row done when a done fixture exists for its key", () => {
    const views = deriveRowViews(rows, new Map(), new Map([["insights/a", fixture("insights", "a")]]), {});
    expect(views[0].contentState).toBe("done");
  });

  it("marks a row raw when only a raw fixture exists", () => {
    const views = deriveRowViews(rows, new Map([["guides/b", fixture("guides", "b")]]), new Map(), {});
    expect(views[1].contentState).toBe("raw");
  });

  it("marks a row not-generated with no fixture", () => {
    const views = deriveRowViews(rows, new Map(), new Map(), {});
    expect(views[2].contentState).toBe("not-generated");
  });

  it("prefers done over raw for the same key", () => {
    const views = deriveRowViews(
      rows,
      new Map([["insights/a", fixture("insights", "a", 3)]]),
      new Map([["insights/a", fixture("insights", "a", 7)]]),
      {},
    );
    expect(views[0].contentState).toBe("done");
    expect(views[0].faqCount).toBe(7);
  });

  it("does not confuse the same slug in two collections", () => {
    const dup = [row("insights", "same"), row("guides", "same")];
    const views = deriveRowViews(dup, new Map(), new Map([["guides/same", fixture("guides", "same")]]), {});
    expect(views[0].contentState).toBe("not-generated");
    expect(views[1].contentState).toBe("done");
  });

  it("reads reviewStatus from the tracker by collection/slug key", () => {
    const views = deriveRowViews(rows, new Map(), new Map(), {
      "insights/a": rec({ reviewStatus: "approved" }),
    });
    expect(views[0].reviewStatus).toBe("approved");
    expect(views[1].reviewStatus).toBe("pending");
  });

  it("reports faqCount as null with no fixture", () => {
    expect(deriveRowViews(rows, new Map(), new Map(), {})[0].faqCount).toBeNull();
  });

  it("flags an unparseable fixture", () => {
    const views = deriveRowViews(rows, new Map(), new Map(), {}, new Set(["insights/a"]));
    expect(views[0].invalid).toBe(true);
    expect(views[1].invalid).toBe(false);
  });

  it("carries every row field through", () => {
    const r = row("guides", "x", { title: "T", faqDone: true, role: "PILLAR PAGE", pillarAssociation: "P" });
    const v = deriveRowViews([r], new Map(), new Map(), {})[0];
    expect(v).toMatchObject({ title: "T", faqDone: true, role: "PILLAR PAGE", pillarAssociation: "P" });
  });
});

describe("overviewStats", () => {
  it("counts generated rows per collection", () => {
    const views = deriveRowViews(
      [row("insights", "a"), row("insights", "b"), row("guides", "c"), row("treatments", "d")],
      new Map([["insights/b", fixture("insights", "b")]]),
      new Map([
        ["insights/a", fixture("insights", "a")],
        ["guides/c", fixture("guides", "c")],
      ]),
      {},
    );
    const stats = overviewStats(views);
    expect(stats.total).toBe(4);
    expect(stats.generated).toBe(3);
    expect(stats.perCollection).toEqual({ insights: 2, guides: 1 });
  });

  it("tallies review statuses", () => {
    const views = deriveRowViews([row("insights", "a"), row("insights", "b"), row("insights", "c")], new Map(), new Map(), {
      "insights/a": rec({ reviewStatus: "approved" }),
      "insights/b": rec({ reviewStatus: "needs-work" }),
    });
    const stats = overviewStats(views);
    expect(stats.approved).toBe(1);
    expect(stats.needsWork).toBe(1);
    expect(stats.pending).toBe(1);
  });

  it("has no withVerify field", () => {
    const stats = overviewStats([]) as unknown as Record<string, unknown>;
    expect("withVerify" in stats).toBe(false);
    expect("perPillar" in stats).toBe(false);
  });
});

describe("throughputByDay", () => {
  it("buckets generatedAt into UTC days, oldest first", () => {
    const now = new Date("2026-07-27T10:00:00Z");
    const pts = throughputByDay(
      {
        "insights/a": rec({ generatedAt: "2026-07-27T01:00:00Z" }),
        "insights/b": rec({ generatedAt: "2026-07-27T02:00:00Z" }),
        "insights/c": rec({ generatedAt: "2026-07-26T02:00:00Z" }),
        "insights/d": rec({ generatedAt: "2020-01-01T00:00:00Z" }),
      },
      7,
      now,
    );
    expect(pts).toHaveLength(7);
    expect(pts[6]).toEqual({ date: "2026-07-27", count: 2 });
    expect(pts[5]).toEqual({ date: "2026-07-26", count: 1 });
    expect(pts.reduce((n, p) => n + p.count, 0)).toBe(3);
  });
});
