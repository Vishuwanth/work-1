#!/usr/bin/env node
// One-shot corpus migration. Splits output/faq/done/ using the team's ledger:
//   live    (286) stay
//   drifted (9)   stay, tracker flagged
//   no-page (324) move to output/faq/archive-<date>/, then zip and remove the folder
//
// Idempotent: a second run finds nothing to archive and exits 0 with a no-op summary.
// Run with:  node scripts/reconcile-corpus.mjs [--date=YYYY-MM-DD] [--force] [--dry-run]

import {
  readdirSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const DONE_DIR = resolve(ROOT, "output/faq/done");
const OUT_DIR = resolve(ROOT, "output/faq");
const TRACKER = resolve(OUT_DIR, "tracker.json");
const LEDGER_CSV = resolve(
  ROOT,
  "docs/source/cancerfax-faq-generator/master-faq-reconciliation.csv",
);
const PAGES_CSV = resolve(
  ROOT,
  "docs/source/cancerfax-faq-generator/all-pages-faq-status.csv",
);
const APP_BATCH_FOLDER = "150 pillar pages";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const has = (name) => args.includes(`--${name}`);
/** Server-LOCAL date. A UTC stamp reads as yesterday for the first 5.5 hours of every IST day. */
function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DATE = flag("date") ?? localDate();
const DRY = has("dry-run");
const FORCE = has("force");

// --- inlined CSV + ledger logic (this script must run without a TS build step) ---

function toGrid(text) {
  const grid = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      grid.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    grid.push(row);
  }
  return grid;
}

function readLedger() {
  const grid = toGrid(readFileSync(LEDGER_CSV, "utf8")).filter((r) =>
    r.some((c) => c.trim() !== ""),
  );
  const header = grid[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iFolder = idx("source_folder");
  const iFile = idx("file");
  const iStatus = idx("status");
  const map = new Map();
  for (const cells of grid.slice(1)) {
    const folder = (cells[iFolder] ?? "").trim();
    const file = (cells[iFile] ?? "").trim();
    const status = (cells[iStatus] ?? "").trim();
    if (file === "" || folder !== APP_BATCH_FOLDER) continue;
    map.set(
      file,
      status.startsWith("DONE")
        ? "live"
        : status.startsWith("UNDONE")
          ? "no-page"
          : status.startsWith("RAN BUT NOW MISSING")
            ? "drifted"
            : "other",
    );
  }
  return map;
}

/** slug -> collection, from the live-site status CSV. */
function readCollectionBySlug() {
  const grid = toGrid(readFileSync(PAGES_CSV, "utf8")).filter((r) =>
    r.some((c) => c.trim() !== ""),
  );
  const header = grid[0].map((h) => h.trim());
  const iCol = header.indexOf("collection");
  const iSlug = header.indexOf("slug");
  const map = new Map();
  for (const cells of grid.slice(1)) {
    const collection = (cells[iCol] ?? "").trim();
    const slug = (cells[iSlug] ?? "").trim();
    if (slug && collection) map.set(slug, collection);
  }
  return map;
}

/**
 * Re-key tracker records from a bare slug to "collection/slug", the identity the
 * app now uses. Without this every pre-migration review record is orphaned and its
 * row reads "pending". Records whose slug has no live page keep their old key —
 * there is no collection to attach them to, and they are archived work anyway.
 */
function rekeyTracker(tracker, collectionBySlug, ledger) {
  let rekeyed = 0;
  let orphaned = 0;
  const out = {};
  for (const [key, rec] of Object.entries(tracker)) {
    if (key.includes("/")) {
      out[key] = rec;
      continue;
    }
    const collection = collectionBySlug.get(key);
    const stamped = { ...rec, ledgerStatus: ledger.get(`${key}-faq-section.json`) ?? rec.ledgerStatus };
    if (collection) {
      out[`${collection}/${key}`] = stamped;
      rekeyed++;
    } else {
      out[key] = stamped;
      orphaned++;
    }
  }
  return { out, rekeyed, orphaned };
}

function planReconcile(doneFiles, ledger) {
  const plan = { keep: [], flagged: [], archive: [], unknown: [] };
  for (const file of doneFiles) {
    const v = ledger.get(file);
    if (v === "live") plan.keep.push(file);
    else if (v === "drifted") plan.flagged.push(file);
    else if (v === "no-page") plan.archive.push(file);
    else plan.unknown.push(file);
  }
  for (const b of Object.values(plan)) b.sort();
  return plan;
}

// --- run ---

if (!existsSync(DONE_DIR)) {
  console.error(`no such directory: ${DONE_DIR}`);
  process.exit(1);
}

const before = readdirSync(DONE_DIR).filter((f) => f.endsWith("-faq-section.json"));
const ledger = readLedger();
const plan = planReconcile(before, ledger);

console.log(`done/ before        : ${before.length}`);
console.log(`  live      (keep)  : ${plan.keep.length}`);
console.log(`  drifted   (flag)  : ${plan.flagged.length}`);
console.log(`  no-page   (archive): ${plan.archive.length}`);
console.log(`  unknown   (leave) : ${plan.unknown.length}`);

// Tracker maintenance runs on EVERY invocation, including the already-reconciled
// path — re-keying is idempotent and must not be skipped just because the archive
// step already happened.
if (!DRY) {
  let tracker = {};
  try {
    tracker = JSON.parse(readFileSync(TRACKER, "utf8"));
  } catch {
    tracker = {};
  }
  const { out, rekeyed, orphaned } = rekeyTracker(tracker, readCollectionBySlug(), ledger);
  if (rekeyed > 0) {
    writeFileSync(TRACKER, JSON.stringify(out, null, 2) + "\n");
    console.log(`\nre-keyed ${rekeyed} tracker records to collection/slug`);
    console.log(`  left under a bare slug (no live page): ${orphaned}`);
  } else {
    console.log(`\ntracker already keyed by collection/slug (${Object.keys(out).length} records)`);
  }
}

if (plan.archive.length === 0) {
  console.log("nothing to archive — already reconciled.");
  process.exit(0);
}

const stageDir = join(OUT_DIR, `archive-${DATE}`);
const zipPath = join(OUT_DIR, `archive-${DATE}.zip`);

if (existsSync(zipPath) && !FORCE) {
  console.error(
    `\n${zipPath} already exists.\n` +
      `Re-run with --date=<other-date> to write a new archive, or --force to overwrite.`,
  );
  process.exit(1);
}

if (DRY) {
  console.log(`\n--dry-run: would archive ${plan.archive.length} files to ${zipPath}`);
  for (const f of plan.archive) console.log(`  ${f}`);
  process.exit(0);
}

mkdirSync(stageDir, { recursive: true });
for (const f of plan.archive) renameSync(join(DONE_DIR, f), join(stageDir, f));
console.log(`\nmoved ${plan.archive.length} files -> ${stageDir}`);

let zipped = false;
try {
  execFileSync("zip", ["-rq", zipPath, `archive-${DATE}`], { cwd: OUT_DIR });
  rmSync(stageDir, { recursive: true, force: true });
  zipped = true;
  console.log(`zipped -> ${zipPath}`);
} catch (e) {
  console.warn(
    `\ncould not run \`zip\` (${e.message}).\n` +
      `The files are safe in ${stageDir}. Zip that folder manually, or leave it as-is.`,
  );
}

const after = readdirSync(DONE_DIR).filter((f) => f.endsWith("-faq-section.json"));
console.log(`\ndone/ after         : ${after.length}`);
console.log(zipped ? "reconciliation complete." : "reconciliation complete (archive left unzipped).");
