// Builds the handoff artefacts for the team's apply-pillar-faqs.js runner.
// The app never writes to Strapi; this folder is what a human runs the runner against.
import { fixtureFilename } from "@/lib/fixtures";

/** One line of mapping.json — exactly the shape apply-pillar-faqs.js expects. */
export interface MappingEntry {
  collection: string;
  slug: string;
  file: string;
}

export function buildMapping(rows: { collection: string; slug: string }[]): MappingEntry[] {
  return rows.map((r) => ({
    collection: r.collection,
    slug: r.slug,
    file: fixtureFilename(r.slug),
  }));
}

/**
 * `batch-YYYY-MM-DD` using the server's LOCAL date. A UTC stamp reads as
 * yesterday for the first 5.5 hours of every IST day.
 */
export function batchDirName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `batch-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
