/**
 * End-to-end functional verification of the review workflow, exercised against
 * COPIES of two committed fixtures using the app's own library code (the same
 * functions the server actions compose). No browser, no Next runtime needed.
 *
 * Flow proven: load raw fixtures → derive row views (Raw/Pending) → edit an
 * answer → approve & move (applyEdits + fs move raw→done) → re-derive
 * (Done/Approved, corrected content in done/, originals untouched).
 *
 * These fixtures exercise the FLOW. Format compliance is owned by
 * validate.test.ts, which runs the validator over the 56 real shipped fixtures.
 */
import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getSection, applyEdits, normalizeFixture } from "@/lib/fixtures";
import { readTracker, writeTracker, recordFor } from "@/lib/tracker";
import { deriveRowViews, overviewStats } from "@/lib/state";
import { pageKey } from "@/lib/pages";
import type { Row, Fixture, ReviewRecord } from "@/lib/types";

// Stable committed test fixtures, decoupled from the live output/faq contents.
const REAL_RAW = join(process.cwd(), "lib/__tests__/fixtures");
const FAQ_SUFFIX = "-faq-section.json";

/** Mirrors app/actions.ts listFixtures: keyed "collection/slug" from the filename + route. */
function loadFixtures(dir: string): Map<string, Fixture> {
  const m = new Map<string, Fixture>();
  if (!existsSync(dir)) return m;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const fx = normalizeFixture(JSON.parse(readFileSync(join(dir, f), "utf8")));
    if (!fx) continue;
    const slug = f.slice(0, -FAQ_SUFFIX.length);
    m.set(`${fx.route.split("/")[1]}/${slug}`, fx);
  }
  return m;
}

describe("end-to-end review workflow (committed fixtures, temp workspace)", () => {
  it("edits + approves + moves a fixture from raw to done", () => {
    // --- set up a temp workspace with copies of the committed fixtures ---
    const ws = mkdtempSync(join(tmpdir(), "cfx-e2e-"));
    const raw = join(ws, "raw");
    const done = join(ws, "done");
    mkdirSync(raw);
    mkdirSync(done);
    const realFiles = readdirSync(REAL_RAW).filter((n) => n.endsWith(".json"));
    expect(realFiles.length).toBeGreaterThanOrEqual(2);
    for (const f of realFiles) writeFileSync(join(raw, f), readFileSync(join(REAL_RAW, f)));

    // --- Row stubs matching the fixtures, keyed the way the live CSV keys them ---
    const rowsByFile: Record<string, Row> = {};
    for (const f of realFiles) {
      const fx = normalizeFixture(JSON.parse(readFileSync(join(raw, f), "utf8")))!;
      rowsByFile[f] = {
        collection: "insights",
        slug: f.slice(0, -FAQ_SUFFIX.length),
        title: fx.pillar,
        faqDone: false,
        role: "",
        pillarAssociation: "Blood Cancer",
      };
    }
    const rows = Object.values(rowsByFile);

    // --- STEP 1: initial derive → both Raw / Pending ---
    const tracker: Record<string, ReviewRecord> = {};
    let views = deriveRowViews(rows, loadFixtures(raw), loadFixtures(done), tracker);
    const target = views.find((v) => v.slug.includes("leukemia"))!;
    const targetKey = pageKey(target);
    expect(target.contentState).toBe("raw");
    expect(target.reviewStatus).toBe("pending");
    expect(target.faqCount).toBe(18);

    // --- STEP 2: reviewer edits an answer and approves ---
    const rec = recordFor(tracker, targetKey);
    rec.edits.answers["0.0"] = "EDITED: a corrected first answer for QA.";
    rec.reviewStatus = "approved";
    tracker[targetKey] = rec;
    writeTracker(tracker, ws);

    // --- STEP 3: approve & move (applyEdits + fs move), as the action does ---
    const srcFile = Object.keys(rowsByFile).find((f) => rowsByFile[f].slug === target.slug)!;
    const rawFx = normalizeFixture(JSON.parse(readFileSync(join(raw, srcFile), "utf8")))!;
    writeFileSync(join(done, srcFile), JSON.stringify(applyEdits(rawFx, rec), null, 2) + "\n");
    unlinkSync(join(raw, srcFile));

    // --- STEP 4: re-derive → Done / Approved, corrected content landed ---
    const trackerAfter = readTracker(ws);
    views = deriveRowViews(rows, loadFixtures(raw), loadFixtures(done), trackerAfter);
    const after = views.find((v) => pageKey(v) === targetKey)!;
    const doneFx = normalizeFixture(JSON.parse(readFileSync(join(done, srcFile), "utf8")))!;

    expect(after.contentState).toBe("done");
    expect(after.reviewStatus).toBe("approved");
    expect(getSection(doneFx).groups[0].items[0].a).toBe(
      "<p>EDITED: a corrected first answer for QA.</p>",
    );

    // Identity is never rewritten by the move — it comes from the live-site CSV.
    expect(doneFx.slug).toBe(target.slug);
    expect(doneFx.route).toBe(`/insights/${target.slug}`);
    expect(JSON.stringify(doneFx)).not.toContain("⚠");

    // --- the other row is untouched: still raw, still pending ---
    const other = views.find((v) => pageKey(v) !== targetKey)!;
    expect(other.contentState).toBe("raw");
    expect(other.reviewStatus).toBe("pending");

    // --- originals in the committed fixtures dir are untouched ---
    const realFx = normalizeFixture(JSON.parse(readFileSync(join(REAL_RAW, srcFile), "utf8")))!;
    expect(getSection(realFx).groups[0].items[0].a).not.toContain("EDITED");

    // --- overview stats reflect one approved ---
    const stats = overviewStats(views);
    expect(stats.approved).toBe(1);
    expect(stats.generated).toBe(2);
    expect(stats.perCollection).toEqual({ insights: 2 });
  });
});
