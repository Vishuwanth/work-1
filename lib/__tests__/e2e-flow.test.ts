/**
 * End-to-end functional verification of the review workflow, exercised against
 * COPIES of the two real fixtures using the app's own library code (the same
 * functions the server actions compose). No browser, no Next runtime needed.
 *
 * Flow proven: load raw fixtures → derive row views (Raw/Pending) → edit an
 * answer + resolve the ⚠ VERIFY slug/route → "approve & move" (applyEdits +
 * fs move raw→done) → re-derive (Done/Approved, corrected content in done/,
 * originals untouched).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanSlug, getSection, applyEdits } from "@/lib/fixtures";
import { readTracker, writeTracker, recordFor } from "@/lib/tracker";
import { deriveRowViews, overviewStats } from "@/lib/state";
import type { Row, Fixture, ReviewRecord } from "@/lib/types";

// Stable committed test fixtures (2 seed FAQ sections), decoupled from the live
// output/faq/raw contents which migrate to done/ as the user reviews.
const REAL_RAW = join(process.cwd(), "lib/__tests__/fixtures");

function loadFixtures(dir: string): Map<string, Fixture> {
  const m = new Map<string, Fixture>();
  if (!existsSync(dir)) return m;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const fx = JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture;
    m.set(cleanSlug(fx.slug).value, fx);
  }
  return m;
}

describe("end-to-end review workflow (real fixtures, temp workspace)", () => {
  it("edits + approves + moves a fixture from raw to done", () => {
    // --- set up a temp workspace with copies of the 2 real fixtures ---
    const ws = mkdtempSync(join(tmpdir(), "cfx-e2e-"));
    const raw = join(ws, "raw"), done = join(ws, "done");
    mkdirSync(raw); mkdirSync(done);
    const realFiles = readdirSync(REAL_RAW).filter((n) => n.endsWith(".json"));
    expect(realFiles.length).toBeGreaterThanOrEqual(2);
    for (const f of realFiles) writeFileSync(join(raw, f), readFileSync(join(REAL_RAW, f)));

    // --- two Row stubs matching the fixtures (title drives slug) ---
    const rowsByFile: Record<string, Row> = {};
    for (const f of realFiles) {
      const fx = JSON.parse(readFileSync(join(raw, f), "utf8")) as Fixture;
      const slug = cleanSlug(fx.slug).value;
      rowsByFile[f] = { rowNum: 0, pillarName: "Blood Cancer", title: fx.pillar, excelStatus: "Pending", contentType: "", slug };
    }
    const rows = Object.values(rowsByFile);

    // --- STEP 1: initial derive → both Raw / Pending, 2 VERIFY flags each ---
    const tracker: Record<string, ReviewRecord> = {};
    let views = deriveRowViews(rows, loadFixtures(raw), loadFixtures(done), tracker);
    const target = views.find((v) => v.title.includes("leukemia"))!;
    console.log("\nBEFORE:", { title: target.title.slice(0, 40) + "…", contentState: target.contentState, reviewStatus: target.reviewStatus, verifyCount: target.verifyCount, faqCount: target.faqCount });
    expect(target.contentState).toBe("raw");
    expect(target.reviewStatus).toBe("pending");
    expect(target.verifyCount).toBe(2); // slug + route
    expect(target.faqCount).toBe(18);

    // --- STEP 2: reviewer edits an answer + resolves the slug/route ---
    const rec = recordFor(tracker, target.slug);
    rec.edits.answers["0.0"] = "EDITED: a corrected first answer for QA.";
    rec.edits.slug = target.slug;                        // resolve ⚠ VERIFY
    rec.edits.route = `/insights/${target.slug}`;
    rec.reviewStatus = "approved";
    tracker[target.slug] = rec;                          // persist the record (as the action does)
    writeTracker(tracker, ws);

    // --- STEP 3: approve & move (applyEdits + atomic fs move), as the action does ---
    const srcFile = Object.keys(rowsByFile).find((f) => rowsByFile[f].slug === target.slug)!;
    const rawFx = JSON.parse(readFileSync(join(raw, srcFile), "utf8")) as Fixture;
    const corrected = applyEdits(rawFx, rec);
    writeFileSync(join(done, srcFile), JSON.stringify(corrected, null, 2) + "\n");
    renameSync(join(raw, srcFile), join(raw, srcFile + ".moved")); // simulate unlink-from-raw
    // (real action unlinks; we rename so we can assert it's gone from the active set)

    // --- STEP 4: re-derive → Done / Approved, corrected content landed ---
    const rawAfter = loadFixtures(raw); rawAfter.delete(target.slug); // .moved file excluded by ext filter anyway
    const trackerAfter = readTracker(ws);
    views = deriveRowViews(rows, loadFixtures(join(done, "..", "raw")), loadFixtures(done), trackerAfter);
    // rebuild raw map excluding the moved file:
    const activeRaw = loadFixtures(raw); // only .json remain (the .moved is filtered out)
    views = deriveRowViews(rows, activeRaw, loadFixtures(done), trackerAfter);
    const after = views.find((v) => v.slug === target.slug)!;
    const doneFx = JSON.parse(readFileSync(join(done, srcFile), "utf8")) as Fixture;
    const movedSection = getSection(doneFx)!;
    console.log("AFTER: ", { contentState: after.contentState, reviewStatus: after.reviewStatus, verifyCount: after.verifyCount, doneSlug: doneFx.slug, firstAnswer: movedSection.groups[0].items[0].a.slice(0, 34) + "…" });

    expect(after.contentState).toBe("done");
    expect(after.reviewStatus).toBe("approved");
    expect(after.verifyCount).toBe(0);                          // slug + route resolved
    expect(doneFx.slug).toBe(target.slug);                      // no "⚠ VERIFY:" prefix
    expect(movedSection.groups[0].items[0].a).toBe("<p>EDITED: a corrected first answer for QA.</p>"); // edit applied + <p>-wrapped

    // --- originals in the REAL raw dir are untouched ---
    const realFx = JSON.parse(readFileSync(join(REAL_RAW, srcFile), "utf8")) as Fixture;
    expect(realFx.slug.startsWith("⚠ VERIFY:")).toBe(true);
    expect(getSection(realFx)!.groups[0].items[0].a).not.toContain("EDITED");

    // --- overview stats reflect one approved ---
    const stats = overviewStats(views);
    console.log("STATS: ", { total: rows.length, generated: stats.generated, approved: stats.approved, pending: stats.pending });
    expect(stats.approved).toBeGreaterThanOrEqual(1);
  });
});
