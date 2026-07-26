// Pure planner for the one-shot corpus migration. The team's ledger is ground
// truth: 286 of this app's 619 fixtures were applied live, 324 targeted pages
// that never existed, 9 have since drifted.
import type { LedgerStatus } from "@/lib/ledger";

export interface ReconcilePlan {
  /** Applied live — stays in output/faq/done/. */
  keep: string[];
  /** Applied once but the slug has drifted — stays, tracker flags it. */
  flagged: string[];
  /** Target page never existed — archived and removed. */
  archive: string[];
  /** Not a fixture verdict, or absent from the ledger — left untouched. */
  unknown: string[];
}

/**
 * Bucket the fixture files currently in done/ by their ledger verdict.
 * A file the ledger does not classify is NEVER archived — an unexpected file
 * on disk must not be deleted by a migration script.
 */
export function planReconcile(
  doneFiles: string[],
  ledger: Map<string, LedgerStatus>,
): ReconcilePlan {
  const plan: ReconcilePlan = { keep: [], flagged: [], archive: [], unknown: [] };
  for (const file of doneFiles) {
    switch (ledger.get(file)) {
      case "live":
        plan.keep.push(file);
        break;
      case "drifted":
        plan.flagged.push(file);
        break;
      case "no-page":
        plan.archive.push(file);
        break;
      default:
        plan.unknown.push(file);
    }
  }
  for (const bucket of Object.values(plan)) bucket.sort();
  return plan;
}
