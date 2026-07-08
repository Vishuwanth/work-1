import type {
  Row,
  RowView,
  Fixture,
  ReviewRecord,
  OverviewStats,
} from "@/lib/types";
import { faqCount, verifyFlags, VERIFY_RE } from "@/lib/fixtures";

type Tracker = Record<string, ReviewRecord>;

/**
 * Join rows with their generated fixtures and tracker records into RowViews.
 * A slug present in doneBySlug is "done"; otherwise in rawBySlug is "raw";
 * otherwise "not-generated". verifyCount is the fixture's flags minus any
 * slug/route resolved by the tracker's edits.
 */
export function deriveRowViews(
  rows: Row[],
  rawBySlug: Map<string, Fixture>,
  doneBySlug: Map<string, Fixture>,
  tracker: Tracker,
): RowView[] {
  return rows.map((row) => {
    const done = doneBySlug.get(row.slug);
    const raw = rawBySlug.get(row.slug);
    const fixture = done ?? raw ?? null;
    const contentState = done ? "done" : raw ? "raw" : "not-generated";
    const rec = tracker[row.slug];

    let verifyCount = 0;
    if (fixture) {
      verifyCount = verifyFlags(fixture);
      if (rec) {
        if (rec.edits.slug && VERIFY_RE.test(fixture.slug)) verifyCount--;
        if (rec.edits.route && VERIFY_RE.test(fixture.route)) verifyCount--;
      }
    }

    return {
      ...row,
      contentState,
      reviewStatus: rec?.reviewStatus ?? "pending",
      verifyCount,
      faqCount: fixture ? faqCount(fixture) : null,
    };
  });
}

/** Aggregate counts for the command-center overview. */
export function overviewStats(views: RowView[]): OverviewStats {
  const stats: OverviewStats = {
    total: views.length,
    generated: 0,
    approved: 0,
    needsWork: 0,
    pending: 0,
    withVerify: 0,
    perPillar: {},
  };
  for (const v of views) {
    if (v.contentState !== "not-generated") {
      stats.generated++;
      stats.perPillar[v.pillarName] = (stats.perPillar[v.pillarName] ?? 0) + 1;
    }
    if (v.reviewStatus === "approved") stats.approved++;
    else if (v.reviewStatus === "needs-work") stats.needsWork++;
    else stats.pending++;
    if (v.verifyCount > 0) stats.withVerify++;
  }
  return stats;
}
