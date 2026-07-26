import { describe, it, expect } from "vitest";
import { HEADERS, toRowArrays, buildStatusWorkbook, exportFilename, SHEET_NAME } from "@/lib/export";
import { fixtureFilename } from "@/lib/fixtures";
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
      "Fixture File",
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
      ["insights", "a-slug", "A Title", "", "", "No", "Not generated", "", "pending", ""],
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
      [
        "guides",
        "a-slug",
        "A Title",
        "PILLAR PAGE",
        "P",
        "Yes",
        "Generated",
        "a-slug-faq-section.json",
        "approved",
        "Done",
      ],
    ]);
  });

  it("counts a raw fixture as generated", () => {
    expect(toRowArrays([view({ contentState: "raw" })])[0][6]).toBe("Generated");
  });
});

describe("the Fixture File column", () => {
  const fileCell = (v: RowView) => toRowArrays([v])[0][7];

  it("names the file for a raw fixture", () => {
    expect(fileCell(view({ contentState: "raw" }))).toBe("a-slug-faq-section.json");
  });

  it("names the file for a done fixture", () => {
    expect(fileCell(view({ contentState: "done" }))).toBe("a-slug-faq-section.json");
  });

  // No fixture on disk means no filename to report — an invented one would send a
  // reviewer looking for a file that does not exist.
  it("is blank when nothing has been generated", () => {
    expect(fileCell(view({ contentState: "not-generated" }))).toBe("");
  });

  it("matches the name the batch export actually writes", () => {
    const v = view({ slug: "carbon-ion-therapy", contentState: "done" });
    expect(fileCell(v)).toBe(fixtureFilename("carbon-ion-therapy"));
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
