"use server";

import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { revalidatePath } from "next/cache";

import type { Fixture, ReviewRecord, RowView, OverviewStats, Toggles, Row } from "@/lib/types";
import { readPages, pageKey } from "@/lib/pages";
import { readExcelIndex, joinExcel } from "@/lib/excel";
import { applyEdits, normalizeFixture } from "@/lib/fixtures";
import { readTracker, writeTracker, recordFor } from "@/lib/tracker";
import { deriveRowViews, overviewStats, throughputByDay } from "@/lib/state";
import { runGenerate, type GenerateResult } from "@/lib/generate";

const RAW_DIR = resolve(process.cwd(), "output/faq/raw");
const DONE_DIR = resolve(process.cwd(), "output/faq/done");
const TOGGLES_PATH = resolve(process.cwd(), "output/faq/toggles.json");
const DEFAULT_TOGGLES: Toggles = { autoGenerate: false, autoMove: true, autoApprove: false };

const FAQ_SUFFIX = "-faq-section.json";

/**
 * The slug for a fixture file. Files are named `<slug>-faq-section.json` and the
 * filename is stable across the raw→done move, so it is the reliable slug source.
 */
function slugFromFilename(file: string): string {
  if (file.endsWith(FAQ_SUFFIX)) return file.slice(0, -FAQ_SUFFIX.length);
  return file.replace(/\.json$/, "");
}

/** The collection a fixture belongs to, read from its own `/{collection}/{slug}` route. */
function collectionFromRoute(route: unknown): string {
  return String(route ?? "").split("/")[1] ?? "";
}

interface FixtureEntry {
  fixture: Fixture;
  /** "collection/slug" — the app-wide page identity. */
  key: string;
  file: string;
}

interface FixtureListing {
  entries: FixtureEntry[];
  /** Filename-derived slug → parse error, for fixtures that failed to parse. */
  invalidSlugs: Set<string>;
}

/**
 * Read + parse every fixture in a directory. A fixture is self-describing: its slug
 * comes from the filename and its collection from its own route, so an entry can be
 * keyed without consulting the page list.
 */
function listFixtures(dir: string): FixtureListing {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return { entries: [], invalidSlugs: new Set() };
  }
  const entries: FixtureEntry[] = [];
  const invalidSlugs = new Set<string>();
  for (const file of names) {
    const slug = slugFromFilename(file);
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
      const fixture = normalizeFixture(raw);
      if (!fixture) {
        invalidSlugs.add(slug);
        continue;
      }
      entries.push({ fixture, key: `${collectionFromRoute(fixture.route)}/${slug}`, file });
    } catch {
      invalidSlugs.add(slug);
    }
  }
  return { entries, invalidSlugs };
}

function readToggles(): Toggles {
  try {
    return { ...DEFAULT_TOGGLES, ...(JSON.parse(readFileSync(TOGGLES_PATH, "utf8")) as Toggles) };
  } catch {
    return { ...DEFAULT_TOGGLES };
  }
}

/** The live page list, enriched with whatever workbook metadata joins unambiguously. */
function readRowsFromSources(): Row[] {
  const { pages } = readPages();
  let index;
  try {
    index = readExcelIndex();
  } catch {
    // The workbook is optional metadata now — a missing one must not break the app.
    index = { byTitle: new Map(), ambiguousTitles: [] };
  }
  return joinExcel(pages, index);
}

/** Load rows + fixtures + tracker into the derived views/stats/toggles the UI renders. */
export async function loadAll(): Promise<{
  views: RowView[];
  stats: OverviewStats;
  toggles: Toggles;
  error?: string;
}> {
  let rows: Row[];
  try {
    rows = readRowsFromSources();
  } catch (e) {
    // Missing/unreadable page CSV: surface a message instead of a 500.
    return {
      views: [],
      stats: overviewStats([]),
      toggles: readToggles(),
      error: `Could not read the live-page CSV at docs/source/cancerfax-faq-generator/all-pages-faq-status.csv — ${(e as Error).message}`,
    };
  }

  const rawListing = listFixtures(RAW_DIR);
  const doneListing = listFixtures(DONE_DIR);
  const rawByKey = new Map(rawListing.entries.map((e) => [e.key, e.fixture]));
  const doneByKey = new Map(doneListing.entries.map((e) => [e.key, e.fixture]));

  // An unparseable fixture has no readable route, so map its filename slug back to
  // a key through the page list.
  const badSlugs = new Set([
    ...Array.from(rawListing.invalidSlugs),
    ...Array.from(doneListing.invalidSlugs),
  ]);
  const invalidKeys = new Set(
    rows.filter((r) => badSlugs.has(r.slug)).map((r) => pageKey(r)),
  );

  const tracker = readTracker();
  const views = deriveRowViews(rows, rawByKey, doneByKey, tracker, invalidKeys);
  const stats = { ...overviewStats(views), throughput: throughputByDay(tracker) };
  return { views, stats, toggles: readToggles() };
}

/** The parsed fixture for a "collection/slug" key: raw takes precedence over done. */
export async function getFixture(key: string): Promise<Fixture | null> {
  const raw = listFixtures(RAW_DIR).entries.find((e) => e.key === key);
  if (raw) return raw.fixture;
  const done = listFixtures(DONE_DIR).entries.find((e) => e.key === key);
  return done?.fixture ?? null;
}

/** The persisted review record for a key (or a fresh pending default). */
export async function getReview(key: string): Promise<ReviewRecord> {
  return recordFor(readTracker(), key);
}

/** Merge a patch into the key's tracker record (edits shallow-merged) and persist. */
export async function saveReview(key: string, patch: Partial<ReviewRecord>): Promise<void> {
  const tracker = readTracker();
  const rec = recordFor(tracker, key);
  tracker[key] = {
    ...rec,
    ...patch,
    edits: patch.edits ? { ...rec.edits, ...patch.edits } : rec.edits,
  };
  writeTracker(tracker);
  revalidatePath("/");
}

/** Move a fixture between dirs, writing the edited version under the same filename. */
async function move(key: string, fromDir: string, toDir: string): Promise<void> {
  const entry = listFixtures(fromDir).entries.find((e) => e.key === key);
  if (!entry) throw new Error(`fixture not found in ${fromDir}: ${key}`);
  const tracker = readTracker();
  const rec = recordFor(tracker, key);
  mkdirSync(toDir, { recursive: true });
  writeFileSync(
    join(toDir, entry.file),
    JSON.stringify(applyEdits(entry.fixture, rec), null, 2) + "\n",
  );
  unlinkSync(join(fromDir, entry.file));
  tracker[key] = { ...rec, movedAt: new Date().toISOString() };
  writeTracker(tracker);
  revalidatePath("/");
}

export async function moveToDone(key: string): Promise<void> {
  await move(key, RAW_DIR, DONE_DIR);
}

export async function moveBack(key: string): Promise<void> {
  await move(key, DONE_DIR, RAW_DIR);
}

/** Approve a key; when autoMove is on, also move raw -> done. */
export async function approveRow(key: string, autoMove: boolean): Promise<void> {
  const tracker = readTracker();
  const rec = recordFor(tracker, key);
  tracker[key] = { ...rec, reviewStatus: "approved", reviewedAt: new Date().toISOString() };
  writeTracker(tracker);
  if (autoMove) await moveToDone(key);
  else revalidatePath("/");
}

/**
 * Bulk-approve a set of keys (one tracker write), then move each raw->done when
 * autoMove is on. Rows not currently in raw (already moved) skip the move quietly.
 * Returns the number approved.
 */
export async function approveRows(keys: string[], autoMove: boolean): Promise<number> {
  const now = new Date().toISOString();
  const tracker = readTracker();
  for (const key of keys) {
    tracker[key] = { ...recordFor(tracker, key), reviewStatus: "approved", reviewedAt: now };
  }
  writeTracker(tracker);
  if (autoMove) {
    for (const key of keys) {
      try {
        await moveToDone(key);
      } catch {
        // Not in raw (already in done) — approval already recorded above.
      }
    }
  }
  revalidatePath("/");
  return keys.length;
}

/**
 * Approve every generated-but-not-yet-approved row at once — whether it's still in
 * raw or already moved to done (covers autoMove being off). Returns the number approved.
 */
export async function approveAllGenerated(autoMove: boolean): Promise<number> {
  const tracker = readTracker();
  const generated = [
    ...listFixtures(RAW_DIR).entries.map((e) => e.key),
    ...listFixtures(DONE_DIR).entries.map((e) => e.key),
  ];
  const toApprove = generated.filter((k) => (tracker[k]?.reviewStatus ?? "pending") !== "approved");
  return approveRows(toApprove, autoMove);
}

/** Generate a fixture for a row via `claude -p`; stamp generatedAt on success. */
export async function generateRow(key: string): Promise<GenerateResult> {
  const row = readRowsFromSources().find((r) => pageKey(r) === key);
  if (!row) return { ok: false, error: `unknown page: ${key}` };
  const result = await runGenerate(row);
  if (result.ok) {
    const tracker = readTracker();
    const rec = recordFor(tracker, key);
    tracker[key] = { ...rec, generatedAt: new Date().toISOString() };
    writeTracker(tracker);
    revalidatePath("/");
  }
  return result;
}

/** Persist the UI toggles to toggles.json. */
export async function setToggles(t: Toggles): Promise<void> {
  mkdirSync(dirname(TOGGLES_PATH), { recursive: true });
  writeFileSync(TOGGLES_PATH, JSON.stringify(t, null, 2) + "\n");
  revalidatePath("/");
}
