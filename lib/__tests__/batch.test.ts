/**
 * Unit tests for the concurrency-capped batch runner. `runBatch` is exercised
 * against a FAKE `generate` (no `claude` spawn), so we can assert the concurrency
 * cap, skip-existing, continue-on-failure, and abort-on-auth precisely.
 */
import { describe, it, expect, vi } from "vitest";
import { runBatch, type GenEvent } from "@/lib/batch";
import type { Row } from "@/lib/types";
import type { GenerateResult } from "@/lib/generate";

const row = (slug: string): Row => ({
  collection: "insights",
  slug,
  title: slug,
  faqDone: false,
  role: "",
  pillarAssociation: "",
});

const rows = (n: number) => Array.from({ length: n }, (_, i) => row(`r${i}`));

/** A generate fake that tracks peak concurrency and resolves after a microtask tick. */
function trackingGenerate(impl: (r: Row) => GenerateResult | Promise<GenerateResult>) {
  let inFlight = 0;
  let peak = 0;
  const fn = vi.fn(async (r: Row): Promise<GenerateResult> => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await Promise.resolve(); // yield so overlapping calls actually overlap
    try {
      return await impl(r);
    } finally {
      inFlight--;
    }
  });
  return { fn, peak: () => peak };
}

const ok = (): GenerateResult => ({ ok: true, fixturePath: "x" });
const fail = (error: string): GenerateResult => ({ ok: false, error });

describe("runBatch", () => {
  it("never exceeds the concurrency cap and generates every ungenerated row", async () => {
    const g = trackingGenerate(ok);
    const events: GenEvent[] = [];
    const summary = await runBatch(
      rows(10),
      { concurrency: 3, isAlreadyGenerated: () => false, generate: g.fn },
      (e) => events.push(e),
    );
    expect(g.peak()).toBeLessThanOrEqual(3);
    expect(g.fn).toHaveBeenCalledTimes(10);
    expect(summary).toEqual({ done: 10, failed: 0, skipped: 0, aborted: undefined });
    expect(events[0]).toEqual({ type: "start", total: 10 });
    expect(events.at(-1)).toEqual({ type: "done", done: 10, failed: 0, skipped: 0 });
  });

  it("skips already-generated rows without calling generate", async () => {
    const g = trackingGenerate(ok);
    const events: GenEvent[] = [];
    const summary = await runBatch(
      rows(4),
      { concurrency: 2, isAlreadyGenerated: (r) => r.slug === "r1" || r.slug === "r3", generate: g.fn },
      (e) => events.push(e),
    );
    expect(g.fn).toHaveBeenCalledTimes(2); // r0, r2 only
    expect(summary).toMatchObject({ done: 2, failed: 0, skipped: 2 });
    expect(events.filter((e) => e.type === "row" && e.status === "skipped")).toHaveLength(2);
  });

  it("continues past per-row failures and collects them", async () => {
    const g = trackingGenerate((r) => (r.slug === "r2" ? fail("bad json") : ok()));
    const events: GenEvent[] = [];
    const summary = await runBatch(
      rows(5),
      { concurrency: 2, isAlreadyGenerated: () => false, generate: g.fn },
      (e) => events.push(e),
    );
    expect(summary).toMatchObject({ done: 4, failed: 1, skipped: 0 });
    const failed = events.find((e) => e.type === "row" && e.status === "failed");
    expect(failed).toMatchObject({ key: "insights/r2", status: "failed", error: "bad json" });
  });

  it("aborts the whole run immediately on an auth failure", async () => {
    // r0 fails auth on the very first call; remaining rows must not all run.
    const g = trackingGenerate((r) => (r.slug === "r0" ? fail("Please log in to continue") : ok()));
    const events: GenEvent[] = [];
    const summary = await runBatch(
      rows(20),
      { concurrency: 1, isAlreadyGenerated: () => false, generate: g.fn },
      (e) => events.push(e),
    );
    expect(summary.aborted).toBe("auth");
    expect(g.fn.mock.calls.length).toBeLessThan(20); // stopped early
    expect(events.some((e) => e.type === "aborted" && e.reason === "auth")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("backs off once and retries on a rate-limit error, then succeeds", async () => {
    let attempts = 0;
    const g = trackingGenerate((r) => {
      if (r.slug === "r0") {
        attempts++;
        return attempts === 1 ? fail("429 too many requests") : ok();
      }
      return ok();
    });
    const sleep = vi.fn(async () => {});
    const summary = await runBatch(
      rows(2),
      { concurrency: 1, isAlreadyGenerated: () => false, generate: g.fn, sleep, backoffMs: 1 },
      () => {},
    );
    expect(sleep).toHaveBeenCalledOnce();
    expect(attempts).toBe(2); // retried
    expect(summary).toMatchObject({ done: 2, failed: 0 });
  });

  it("stops pulling new rows when the client disconnects (abort signal)", async () => {
    const ctrl = new AbortController();
    const g = trackingGenerate((r) => {
      if (r.slug === "r1") ctrl.abort(); // disconnect after the 2nd row starts
      return ok();
    });
    const events: GenEvent[] = [];
    const summary = await runBatch(
      rows(20),
      { concurrency: 1, signal: ctrl.signal, isAlreadyGenerated: () => false, generate: g.fn },
      (e) => events.push(e),
    );
    expect(summary.aborted).toBe("client-disconnect");
    expect(g.fn.mock.calls.length).toBeLessThan(20);
    expect(events.some((e) => e.type === "aborted" && e.reason === "client-disconnect")).toBe(true);
  });
});
