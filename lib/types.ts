// Shared types for the CancerFax review app.

export type ContentState = "not-generated" | "raw" | "done";
export type ReviewStatus = "pending" | "approved" | "needs-work";

/** One content row read from the "All 300 Pages" workbook sheet. */
export interface Row {
  rowNum: number;
  pillarName: string;
  title: string;
  excelStatus: string;
  contentType: string;
  slug: string;
}

/** A single FAQ item. */
export interface FaqItem {
  q: string;
  a: string;
}

/** A thematic group of FAQ items. */
export interface FaqGroup {
  title: string;
  items: FaqItem[];
}

/** The FAQ section carried by a fixture (under `section` or `sectionToMerge`). */
export interface FaqSection {
  type: string;
  id: string;
  h2: string;
  intro: string;
  groups: FaqGroup[];
}

/** A fixture wrapper as written by the generator (faq_write.py semantics). */
export interface Fixture {
  pillar: string;
  contentType: string;
  runner: string;
  slug: string;
  route: string;
  section?: FaqSection;
  sectionToMerge?: FaqSection;
  schemaRecommendation: string;
  medicalDisclaimer: string;
}

/** Per-slug edit overlay + review decision, persisted in tracker.json. */
export interface ReviewRecord {
  reviewStatus: ReviewStatus;
  note: string;
  edits: {
    answers: Record<string, string>;
    slug: string;
    route: string;
  };
  reviewedAt?: string;
  movedAt?: string;
  generatedAt?: string;
}

/** UI toggles persisted in toggles.json. */
export interface Toggles {
  autoGenerate: boolean;
  autoMove: boolean;
}

/** A Row enriched with derived generation + review state. */
export type RowView = Row & {
  contentState: ContentState;
  reviewStatus: ReviewStatus;
  verifyCount: number;
  faqCount: number | null;
};

/** Aggregate counts for the command-center overview. */
export interface OverviewStats {
  total: number;
  generated: number;
  approved: number;
  needsWork: number;
  pending: number;
  withVerify: number;
  perPillar: Record<string, number>;
}
