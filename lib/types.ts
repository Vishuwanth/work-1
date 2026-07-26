// Shared types for the CancerFax review app.
// Row identity is `collection` + `slug`, taken from the live-site status CSV.
import type { Collection, PageRole } from "@/lib/page-key";

export type { Collection, PageRole };

export type ContentState = "not-generated" | "raw" | "done";
export type ReviewStatus = "pending" | "approved" | "needs-work";
/** Transient client-side generation status overlaid on a row during a batch/single run. */
export type GenStatus = "queued" | "running" | "done" | "failed" | "skipped";

/** Optional planning metadata joined in from the read-only workbook. */
export interface ExcelMeta {
  pillarNum: string;
  pillarName: string;
  excelStatus: string;
}

/** One live page, optionally enriched with workbook metadata. */
export interface Row {
  collection: Collection;
  slug: string;
  title: string;
  faqDone: boolean;
  role: PageRole;
  pillarAssociation: string;
  excel?: ExcelMeta;
}

/** A single FAQ item. */
export interface FaqItem {
  q: string;
  a: string;
}

/** A thematic group of FAQ items. Support pages use a single group with title "". */
export interface FaqGroup {
  title: string;
  items: FaqItem[];
}

/** The FAQ section carried by a fixture. `intro` is optional and omitted by default. */
export interface FaqSection {
  type: "faq";
  id: "faq";
  h2: string;
  intro?: string;
  groups: FaqGroup[];
}

/** A fixture in the team's `apply-pillar-faqs.js` format. */
export interface Fixture {
  pillar: string;
  contentType: "Guides" | "Insights" | "Treatments";
  runner: "apply-pillar-faqs.js";
  slug: string;
  route: string;
  sectionToMerge: FaqSection;
}

/** Per-page edit overlay + review decision, persisted in tracker.json keyed "collection/slug". */
export interface ReviewRecord {
  reviewStatus: ReviewStatus;
  note: string;
  edits: {
    /** Keyed "<groupIndex>.<itemIndex>". */
    answers: Record<string, string>;
  };
  reviewedAt?: string;
  movedAt?: string;
  generatedAt?: string;
  /** Set by scripts/reconcile-corpus.mjs for the pre-migration corpus. */
  ledgerStatus?: "live" | "no-page" | "drifted" | "other";
}

/** UI toggles persisted in toggles.json. */
export interface Toggles {
  autoGenerate: boolean;
  autoMove: boolean;
  /** Approve (and move, if autoMove) a row the instant it's generated — no review step. */
  autoApprove: boolean;
}

/** A Row enriched with derived generation + review state. */
export type RowView = Row & {
  contentState: ContentState;
  reviewStatus: ReviewStatus;
  faqCount: number | null;
  /** The fixture file exists but could not be parsed as JSON. */
  invalid?: boolean;
};

/** A single day's generation count, for the 7-day throughput chart. */
export interface ThroughputPoint {
  date: string;
  count: number;
}

/** Aggregate counts for the command-center overview. */
export interface OverviewStats {
  total: number;
  generated: number;
  approved: number;
  needsWork: number;
  pending: number;
  perCollection: Record<string, number>;
  /** Generated-per-day for the last 7 days (oldest → newest). */
  throughput: ThroughputPoint[];
}
