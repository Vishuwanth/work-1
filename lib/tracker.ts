import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { ReviewRecord } from "@/lib/types";

const DEFAULT_DIR = "output/faq";
const FILE = "tracker.json";

type TrackerData = Record<string, ReviewRecord>;

function trackerPath(dir?: string): string {
  const base = dir ?? resolve(process.cwd(), DEFAULT_DIR);
  return join(base, FILE);
}

/** Read tracker.json; returns {} when missing or corrupt. */
export function readTracker(dir?: string): TrackerData {
  try {
    return JSON.parse(readFileSync(trackerPath(dir), "utf8")) as TrackerData;
  } catch {
    return {};
  }
}

/** Write tracker.json (pretty), creating the directory if needed. */
export function writeTracker(data: TrackerData, dir?: string): void {
  const base = dir ?? resolve(process.cwd(), DEFAULT_DIR);
  mkdirSync(base, { recursive: true });
  writeFileSync(trackerPath(dir), JSON.stringify(data, null, 2) + "\n");
}

/** The existing record for a "collection/slug" key, or a fresh pending default. */
export function recordFor(data: TrackerData, key: string): ReviewRecord {
  return (
    data[key] || {
      reviewStatus: "pending",
      note: "",
      edits: { answers: {} },
    }
  );
}
