"use server";

import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { revalidatePath } from "next/cache";

import type { Fixture, ReviewRecord, RowView, OverviewStats, Toggles } from "@/lib/types";
import { readRows } from "@/lib/excel";
import { cleanSlug, applyEdits } from "@/lib/fixtures";
import { readTracker, writeTracker, recordFor } from "@/lib/tracker";
import { deriveRowViews, overviewStats } from "@/lib/state";
import { runGenerate, type GenerateResult } from "@/lib/generate";

const RAW_DIR = resolve(process.cwd(), "output/faq/raw");
const DONE_DIR = resolve(process.cwd(), "output/faq/done");
const TOGGLES_PATH = resolve(process.cwd(), "output/faq/toggles.json");
const DEFAULT_TOGGLES: Toggles = { autoGenerate: false, autoMove: true };

interface FixtureEntry {
  fixture: Fixture;
  slug: string;
  file: string;
}

/** Read + parse every fixture in a directory, keyed by its parsed (cleaned) slug. */
function listFixtures(dir: string): FixtureEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: FixtureEntry[] = [];
  for (const file of names) {
    try {
      const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture;
      out.push({ fixture, slug: cleanSlug(fixture.slug).value, file });
    } catch {
      // skip unparseable fixtures
    }
  }
  return out;
}

function readToggles(): Toggles {
  try {
    return { ...DEFAULT_TOGGLES, ...(JSON.parse(readFileSync(TOGGLES_PATH, "utf8")) as Toggles) };
  } catch {
    return { ...DEFAULT_TOGGLES };
  }
}

/** Load rows + fixtures + tracker into the derived views/stats/toggles the UI renders. */
export async function loadAll(): Promise<{ views: RowView[]; stats: OverviewStats; toggles: Toggles }> {
  const rows = readRows();
  const rawBySlug = new Map(listFixtures(RAW_DIR).map((e) => [e.slug, e.fixture]));
  const doneBySlug = new Map(listFixtures(DONE_DIR).map((e) => [e.slug, e.fixture]));
  const tracker = readTracker();
  const views = deriveRowViews(rows, rawBySlug, doneBySlug, tracker);
  return { views, stats: overviewStats(views), toggles: readToggles() };
}

/** The parsed fixture for a slug: raw takes precedence over done. */
export async function getFixture(slug: string): Promise<Fixture | null> {
  const raw = listFixtures(RAW_DIR).find((e) => e.slug === slug);
  if (raw) return raw.fixture;
  const done = listFixtures(DONE_DIR).find((e) => e.slug === slug);
  return done?.fixture ?? null;
}

/** Merge a patch into the slug's tracker record (edits shallow-merged) and persist. */
export async function saveReview(slug: string, patch: Partial<ReviewRecord>): Promise<void> {
  const tracker = readTracker();
  const rec = recordFor(tracker, slug);
  tracker[slug] = {
    ...rec,
    ...patch,
    edits: patch.edits ? { ...rec.edits, ...patch.edits } : rec.edits,
  };
  writeTracker(tracker);
  revalidatePath("/");
}

/** Atomically move a fixture between dirs, writing the edited version under the same filename. */
async function move(slug: string, fromDir: string, toDir: string): Promise<void> {
  const entry = listFixtures(fromDir).find((e) => e.slug === slug);
  if (!entry) throw new Error(`fixture not found in ${fromDir}: ${slug}`);
  const tracker = readTracker();
  const rec = recordFor(tracker, slug);
  mkdirSync(toDir, { recursive: true });
  writeFileSync(join(toDir, entry.file), JSON.stringify(applyEdits(entry.fixture, rec), null, 2) + "\n");
  unlinkSync(join(fromDir, entry.file));
  tracker[slug] = { ...rec, movedAt: new Date().toISOString() };
  writeTracker(tracker);
  revalidatePath("/");
}

export async function moveToDone(slug: string): Promise<void> {
  await move(slug, RAW_DIR, DONE_DIR);
}

export async function moveBack(slug: string): Promise<void> {
  await move(slug, DONE_DIR, RAW_DIR);
}

/** Approve a slug; when autoMove is on, also move raw -> done. */
export async function approveRow(slug: string, autoMove: boolean): Promise<void> {
  const tracker = readTracker();
  const rec = recordFor(tracker, slug);
  tracker[slug] = { ...rec, reviewStatus: "approved", reviewedAt: new Date().toISOString() };
  writeTracker(tracker);
  if (autoMove) await moveToDone(slug);
  else revalidatePath("/");
}

/** Generate a fixture for a row via `claude -p`; stamp generatedAt on success. */
export async function generateRow(slug: string): Promise<GenerateResult> {
  const row = readRows().find((r) => r.slug === slug);
  if (!row) return { ok: false, error: `row not found: ${slug}` };
  const result = await runGenerate(row);
  if (result.ok) {
    const tracker = readTracker();
    const rec = recordFor(tracker, slug);
    tracker[slug] = { ...rec, generatedAt: new Date().toISOString() };
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
