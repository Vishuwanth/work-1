import { describe, it, expect } from "vitest";
import { planReconcile } from "@/lib/reconcile";
import { readLedger } from "@/lib/ledger";
import type { LedgerStatus } from "@/lib/ledger";

function ledger(entries: [string, LedgerStatus][]): Map<string, LedgerStatus> {
  return new Map(entries);
}

describe("planReconcile", () => {
  it("routes each verdict to its bucket", () => {
    const plan = planReconcile(
      ["a.json", "b.json", "c.json"],
      ledger([
        ["a.json", "live"],
        ["b.json", "no-page"],
        ["c.json", "drifted"],
      ]),
    );
    expect(plan.keep).toEqual(["a.json"]);
    expect(plan.archive).toEqual(["b.json"]);
    expect(plan.flagged).toEqual(["c.json"]);
    expect(plan.unknown).toEqual([]);
  });

  it("treats a file the ledger never mentions as unknown, never archived", () => {
    const plan = planReconcile(["mystery.json"], ledger([]));
    expect(plan.unknown).toEqual(["mystery.json"]);
    expect(plan.archive).toEqual([]);
  });

  it("treats an audit-row verdict as unknown", () => {
    const plan = planReconcile(["a.json"], ledger([["a.json", "other"]]));
    expect(plan.unknown).toEqual(["a.json"]);
    expect(plan.archive).toEqual([]);
  });

  it("ignores ledger entries with no file on disk", () => {
    const plan = planReconcile([], ledger([["gone.json", "no-page"]]));
    expect(plan).toEqual({ keep: [], flagged: [], archive: [], unknown: [] });
  });

  it("is a no-op on a second run, once archived files are gone", () => {
    const l = ledger([
      ["a.json", "live"],
      ["b.json", "no-page"],
    ]);
    const first = planReconcile(["a.json", "b.json"], l);
    const second = planReconcile(
      ["a.json", "b.json"].filter((f) => !first.archive.includes(f)),
      l,
    );
    expect(second.archive).toEqual([]);
    expect(second.keep).toEqual(["a.json"]);
  });

  it("sorts each bucket so output is stable", () => {
    const plan = planReconcile(
      ["c.json", "a.json", "b.json"],
      ledger([
        ["a.json", "live"],
        ["b.json", "live"],
        ["c.json", "live"],
      ]),
    );
    expect(plan.keep).toEqual(["a.json", "b.json", "c.json"]);
  });
});

describe("planReconcile against the real ledger and corpus", () => {
  it("splits the 619-fixture corpus 286 / 324 / 9", () => {
    const files = readLedger().keys();
    const plan = planReconcile([...files], readLedger());
    expect(plan.keep).toHaveLength(286);
    expect(plan.archive).toHaveLength(324);
    expect(plan.flagged).toHaveLength(9);
    expect(plan.unknown).toHaveLength(0);
  });
});
