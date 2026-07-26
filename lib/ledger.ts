import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv } from "@/lib/csv";

export const LEDGER_CSV =
  "docs/source/cancerfax-faq-generator/master-faq-reconciliation.csv";

/** The source_folder this app's own 619-fixture corpus was filed under. */
export const APP_BATCH_FOLDER = "150 pillar pages";

/**
 * What the team's reconciliation found for one fixture file:
 * live     — applied and verified on the live site
 * no-page  — the target page never existed
 * drifted  — applied once, but the slug has since been renamed or deleted
 * other    — an audit/bookkeeping row, not a fixture verdict
 */
export type LedgerStatus = "live" | "no-page" | "drifted" | "other";

/**
 * Prefix matching, not equality: several DONE rows carry a trailing parenthetical
 * such as "DONE - verified live now (slug renamed cancer-immunotherapy -> immunotherapy)".
 */
function toStatus(raw: string): LedgerStatus {
  if (raw.startsWith("DONE")) return "live";
  if (raw.startsWith("UNDONE")) return "no-page";
  if (raw.startsWith("RAN BUT NOW MISSING")) return "drifted";
  return "other";
}

/** `sourceFolder` defaults to this app's own batch; pass null to read every folder. */
export function parseLedger(
  csvText: string,
  sourceFolder: string | null = APP_BATCH_FOLDER,
): Map<string, LedgerStatus> {
  const out = new Map<string, LedgerStatus>();
  for (const r of parseCsv(csvText)) {
    const file = r.file ?? "";
    if (file === "") continue;
    if (sourceFolder !== null && r.source_folder !== sourceFolder) continue;
    out.set(file, toStatus(r.status ?? ""));
  }
  return out;
}

export function readLedger(
  csvPath?: string,
  sourceFolder: string | null = APP_BATCH_FOLDER,
): Map<string, LedgerStatus> {
  const path = csvPath ?? resolve(process.cwd(), LEDGER_CSV);
  return parseLedger(readFileSync(path, "utf8"), sourceFolder);
}
