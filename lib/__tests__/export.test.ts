import { describe, it, expect } from "vitest";
import { HEADERS, toRowArrays, buildStatusWorkbook, exportFilename, SHEET_NAME } from "@/lib/export";
import type { RowView } from "@/lib/types";

function view(extra: Partial<RowView> = {}): RowView {
  return {
    collection: "insights",
    slug: "a-slug",
    title: "A Title",
    faqDone: false,
    role: "",
    pillarAssociation: "",
    contentState: "not-generated",
    reviewStatus: "pending",
    faqCount: null,
    ...extra,
  };
}

describe("HEADERS", () => {
  it("describes the live-site columns", () => {
    expect(HEADERS).toEqual([
      "Collection",
      "Slug",
      "Title",
      "Role",
      "Pillar Association",
      "FAQ Done",
      "Gen Status",
      "Review Status",
      "Excel Status",
    ]);
  });

  it("no longer carries a Dup Slug column", () => {
    expect(HEADERS).not.toContain("Dup Slug");
  });
});

describe("toRowArrays", () => {
  it("maps a bare row", () => {
    expect(toRowArrays([view()])).toEqual([
      ["insights", "a-slug", "A Title", "", "", "No", "Not generated", "pending", ""],
    ]);
  });

  it("reports a generated, approved, done row", () => {
    expect(
      toRowArrays([
        view({
          collection: "guides",
          faqDone: true,
          role: "PILLAR PAGE",
          pillarAssociation: "P",
          contentState: "done",
          reviewStatus: "approved",
          excel: { pillarNum: "3", pillarName: "Pillar Three", excelStatus: "Done" },
        }),
      ]),
    ).toEqual([
      ["guides", "a-slug", "A Title", "PILLAR PAGE", "P", "Yes", "Generated", "approved", "Done"],
    ]);
  });

  it("counts a raw fixture as generated", () => {
    expect(toRowArrays([view({ contentState: "raw" })])[0][6]).toBe("Generated");
  });
});

describe("buildStatusWorkbook", () => {
  it("creates one named sheet with a header row per view", () => {
    const wb = buildStatusWorkbook([view(), view({ slug: "b" })]);
    expect(wb.SheetNames).toEqual([SHEET_NAME]);
    expect(wb.Sheets[SHEET_NAME]["!autofilter"]).toBeDefined();
  });
});

describe("exportFilename", () => {
  it("stamps the local date and marks a subset", () => {
    const d = new Date(2026, 6, 27, 2, 0, 0);
    expect(exportFilename(false, d)).toBe("cancerfax-content-status-2026-07-27.xlsx");
    expect(exportFilename(true, d)).toBe("cancerfax-content-status-view-2026-07-27.xlsx");
  });
});
