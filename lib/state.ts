import type {
  Row,
  RowView,
  Fixture,
  ReviewRecord,
  OverviewStats,
  ThroughputPoint,
} from "@/lib/types";
import { faqCount } from "@/lib/fixtures";
import { pageKey } from "@/lib/pages";

type Tracker = Record<string, ReviewRecord>;

/**
 * Join rows with their generated fixtures and tracker records into RowViews.
 * Every map and the tracker are keyed "collection/slug" — the same slug can exist
 * in two collections, so a slug-only key would collide.
 */
export function deriveRowViews(
  rows: Row[],
  rawByKey: Map<string, Fixture>,
  doneByKey: Map<string, Fixture>,
  tracker: Tracker,
  invalidKeys: Set<string> = new Set(),
): RowView[] {
  return rows.map((row) => {
    const key = pageKey(row);
    const done = doneByKey.get(key);
    const raw = rawByKey.get(key);
    const fixture = done ?? raw ?? null;

    return {
      ...row,
      contentState: done ? "done" : raw ? "raw" : "not-generated",
      reviewStatus: tracker[key]?.reviewStatus ?? "pending",
      faqCount: fixture ? faqCount(fixture) : null,
      invalid: invalidKeys.has(key),
    };
  });
}

/**
 * Bucket the tracker's `generatedAt` timestamps into per-day counts for the last
 * `days` days (oldest → newest), keyed by UTC calendar date (YYYY-MM-DD).
 */
export function throughputByDay(
  tracker: Tracker,
  days = 7,
  now: Date = new Date(),
): ThroughputPoint[] {
  const buckets: ThroughputPoint[] = [];
  const indexByDate = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    indexByDate.set(date, buckets.length);
    buckets.push({ date, count: 0 });
  }
  for (const rec of Object.values(tracker)) {
    if (!rec.generatedAt) continue;
    const idx = indexByDate.get(rec.generatedAt.slice(0, 10));
    if (idx != null) buckets[idx].count++;
  }
  return buckets;
}

/**
 * Aggregate counts for the command-center overview. Grouping is by `collection`,
 * not pillar: 448 of the 449 pending pages have a blank pillar_association, so a
 * per-pillar breakdown of the backlog would read all zeroes.
 */
export function overviewStats(views: RowView[]): OverviewStats {
  const stats: OverviewStats = {
    total: views.length,
    generated: 0,
    approved: 0,
    needsWork: 0,
    pending: 0,
    perCollection: {},
    throughput: [],
  };
  for (const v of views) {
    if (v.contentState !== "not-generated") {
      stats.generated++;
      stats.perCollection[v.collection] = (stats.perCollection[v.collection] ?? 0) + 1;
    }
    if (v.reviewStatus === "approved") stats.approved++;
    else if (v.reviewStatus === "needs-work") stats.needsWork++;
    else stats.pending++;
  }
  return stats;
}
