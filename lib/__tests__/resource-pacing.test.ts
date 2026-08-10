import { describe, expect, it } from "vitest";

import {
  DEFAULT_GAP_MINUTES,
  GAP_JITTER,
  MAX_GAP_MINUTES,
  MIN_GAP_MINUTES,
  humanGapMs,
  normalizeGapMinutes,
} from "@/lib/resources/classify";

describe("normalizeGapMinutes", () => {
  it("treats 0 as an explicit choice, not a missing value", () => {
    // Fast mode. Falling back to the default here would silently pace a batch
    // the user asked to run flat out.
    expect(normalizeGapMinutes(0)).toBe(0);
    expect(normalizeGapMinutes("0")).toBe(0);
  });

  it("falls back to the default for anything unusable", () => {
    // Number() coerces every one of these to 0, which would mean "no gap at
    // all" — the single most dangerous value this function can return.
    for (const bad of [undefined, null, "", "   ", [], false, "abc", NaN, -1, -0.5]) {
      expect(normalizeGapMinutes(bad)).toBe(DEFAULT_GAP_MINUTES);
    }
  });

  it("clamps into the allowed band rather than trusting the caller", () => {
    expect(normalizeGapMinutes(0.001)).toBe(MIN_GAP_MINUTES);
    expect(normalizeGapMinutes(9999)).toBe(MAX_GAP_MINUTES);
  });

  it("passes through a value already in range", () => {
    expect(normalizeGapMinutes(8)).toBe(8);
    expect(normalizeGapMinutes(0.5)).toBe(0.5);
    expect(normalizeGapMinutes(60)).toBe(60);
  });
});

describe("humanGapMs", () => {
  it("returns no gap at all in fast mode", () => {
    expect(humanGapMs(0)).toBe(0);
  });

  it("stays within ±20% of the requested minutes", () => {
    const base = 8 * 60_000;
    const draws = Array.from({ length: 500 }, () => humanGapMs(8));
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(base * (1 - GAP_JITTER));
    expect(Math.max(...draws)).toBeLessThanOrEqual(base * (1 + GAP_JITTER));
  });

  it("redraws every time instead of settling into a fixed cadence", () => {
    // A constant gap is as recognisable as no gap — the jitter is the point.
    const draws = new Set(Array.from({ length: 50 }, () => humanGapMs(8)));
    expect(draws.size).toBeGreaterThan(20);
  });

  it("clamps an out-of-range request before using it", () => {
    const draws = Array.from({ length: 100 }, () => humanGapMs(9999));
    const cap = MAX_GAP_MINUTES * 60_000 * (1 + GAP_JITTER);
    expect(Math.max(...draws)).toBeLessThanOrEqual(cap);
  });

  it("uses the default when asked for nothing in particular", () => {
    const base = DEFAULT_GAP_MINUTES * 60_000;
    const draws = Array.from({ length: 100 }, () => humanGapMs());
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(base * (1 - GAP_JITTER));
    expect(Math.max(...draws)).toBeLessThanOrEqual(base * (1 + GAP_JITTER));
  });
});
