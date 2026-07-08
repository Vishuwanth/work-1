import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTracker, writeTracker, recordFor } from "@/lib/tracker";
import type { ReviewRecord } from "@/lib/types";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tracker-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("tracker", () => {
  it("round-trips written records", () => {
    const rec: ReviewRecord = {
      reviewStatus: "approved",
      note: "looks good",
      edits: { answers: { "0.0": "<p>x</p>" }, slug: "s", route: "/r" },
    };
    writeTracker({ "some-slug": rec }, dir);
    const back = readTracker(dir);
    expect(back["some-slug"]).toEqual(rec);
  });

  it("recordFor returns a pending default for an unknown slug", () => {
    expect(recordFor({}, "nope")).toEqual({
      reviewStatus: "pending",
      note: "",
      edits: { answers: {}, slug: "", route: "" },
    });
  });

  it("recordFor returns the existing record when present", () => {
    const rec: ReviewRecord = {
      reviewStatus: "needs-work",
      note: "",
      edits: { answers: {}, slug: "", route: "" },
    };
    expect(recordFor({ known: rec }, "known")).toBe(rec);
  });

  it("readTracker returns {} on corrupt JSON", () => {
    writeFileSync(join(dir, "tracker.json"), "{ not json");
    expect(readTracker(dir)).toEqual({});
  });

  it("readTracker returns {} when no file exists", () => {
    expect(readTracker(dir)).toEqual({});
  });
});
