import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";

import { readRows } from "@/lib/excel";
import { deriveRowViews } from "@/lib/state";
import {
  HEADERS,
  SHEET_NAME,
  buildStatusWorkbook,
  duplicateSlugs,
  exportFilename,
  toRowArrays,
} from "@/lib/export";
import type { Fixture, RowView } from "@/lib/types";

function view(overrides: Partial<RowView>): RowView {
  return {
    rowNum: 1,
    pillarNum: "1",
    pillarName: "Advanced Cancer Treatment",
    title: "A Title",
    excelStatus: "Done",
    contentType: "Insights",
    slug: "a-title",
    contentState: "done",
    reviewStatus: "approved",
    verifyCount: 0,
    faqCount: 10,
    ...overrides,
  };
}

describe("duplicateSlugs", () => {
  it("flags every row of a shared slug, and nothing else", () => {
    const dup = duplicateSlugs([
      view({ slug: "shared", pillarNum: "1" }),
      view({ slug: "unique" }),
      view({ slug: "shared", pillarNum: "6" }),
    ]);
    expect([...dup]).toEqual(["shared"]);
  });

  it("is empty when every slug is distinct", () => {
    expect(duplicateSlugs([view({ slug: "a" }), view({ slug: "b" })]).size).toBe(0);
  });
});

describe("toRowArrays", () => {
  it("emits the seven columns with a numeric pillar", () => {
    const rows = toRowArrays([view({})], new Set());
    expect(rows[0]).toEqual([1, "Advanced Cancer Treatment", "A Title", "Done", "Generated", "a-title", ""]);
  });

  it("keeps blank pillar/status on unpillared rows and marks them Not generated", () => {
    const rows = toRowArrays(
      [
        view({
          pillarNum: "",
          pillarName: "",
          excelStatus: "",
          title: "TP53 mutation cancer treatment options",
          slug: "tp53-mutation-cancer-treatment-options",
          contentState: "not-generated",
          faqCount: null,
        }),
      ],
      new Set(),
    );
    expect(rows[0]).toEqual([
      "",
      "",
      "TP53 mutation cancer treatment options",
      "",
      "Not generated",
      "tp53-mutation-cancer-treatment-options",
      "",
    ]);
  });

  it("reports a raw (generated, unreviewed) row as Generated", () => {
    expect(toRowArrays([view({ contentState: "raw", reviewStatus: "pending" })], new Set())[0][4]).toBe("Generated");
  });

  it("writes YES only on rows whose slug is in the duplicate set", () => {
    const rows = toRowArrays([view({ slug: "shared" }), view({ slug: "unique" })], new Set(["shared"]));
    expect(rows.map((r) => r[6])).toEqual(["YES", ""]);
  });
});

describe("buildStatusWorkbook", () => {
  const wb = buildStatusWorkbook([view({}), view({ slug: "b", rowNum: 2 })], new Set());
  const ws = wb.Sheets[SHEET_NAME];

  it("uses one sheet with the header row first", () => {
    expect(wb.SheetNames).toEqual([SHEET_NAME]);
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    expect(aoa[0]).toEqual([...HEADERS]);
    expect(aoa.length).toBe(3);
  });

  it("autofilters the full used range and sets a width per column", () => {
    expect(ws["!autofilter"]).toEqual({ ref: "A1:G3" });
    expect(ws["!cols"]).toHaveLength(HEADERS.length);
  });

  it("round-trips through a real .xlsx buffer", () => {
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const back = XLSX.read(buf, { type: "buffer" });
    const aoa = XLSX.utils.sheet_to_json<string[]>(back.Sheets[SHEET_NAME], { header: 1 });
    expect(aoa[1][5]).toBe("a-title");
    expect(aoa[2][5]).toBe("b");
  });
});

describe("exportFilename", () => {
  it("date-stamps, and marks a subset export with -view", () => {
    const on = new Date(2026, 6, 25, 9, 0, 0);
    expect(exportFilename(false, on)).toBe("cancerfax-content-status-2026-07-25.xlsx");
    expect(exportFilename(true, on)).toBe("cancerfax-content-status-view-2026-07-25.xlsx");
  });

  it("stamps the local date, not the UTC one, just after local midnight", () => {
    // 00:15 local on the 25th is still the 24th in UTC for any timezone east of it.
    expect(exportFilename(false, new Date(2026, 6, 25, 0, 15, 0))).toBe(
      "cancerfax-content-status-2026-07-25.xlsx",
    );
  });
});

// The real workbook + the fixtures actually on disk — guards the numbers the
// export is meant to report.
describe("the live workbook", () => {
  const views = deriveRowViews(readRows(), new Map<string, Fixture>(), new Map<string, Fixture>(), {});

  it("exports every one of the 719 content rows", () => {
    expect(toRowArrays(views, duplicateSlugs(views))).toHaveLength(719);
  });

  it("flags 48 rows across 24 shared slugs", () => {
    const dup = duplicateSlugs(views);
    expect(dup.size).toBe(24);
    expect(views.filter((v) => dup.has(v.slug))).toHaveLength(48);
  });

  it("leaves pillar and Excel status blank on the 79 unpillared rows", () => {
    const unpillared = views.filter((v) => v.pillarNum === "");
    expect(unpillared).toHaveLength(79);
    expect(unpillared.every((v) => v.pillarName === "" && v.excelStatus === "")).toBe(true);
  });
});
