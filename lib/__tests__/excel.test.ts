import { describe, it, expect } from "vitest";
import { readExcelIndex, joinExcel } from "@/lib/excel";
import { readPages } from "@/lib/pages";
import type { LivePage } from "@/lib/pages";
import type { ExcelIndex } from "@/lib/excel";

function page(slug: string, title: string): LivePage {
  return {
    collection: "insights",
    slug,
    title,
    faqDone: false,
    role: "",
    pillarAssociation: "",
  };
}

function index(entries: [string, string][], ambiguous: string[] = []): ExcelIndex {
  return {
    byTitle: new Map(
      entries.map(([title, pillarName]) => [
        title,
        { pillarNum: "1", pillarName, excelStatus: "Done" },
      ]),
    ),
    ambiguousTitles: ambiguous,
  };
}

describe("joinExcel", () => {
  it("attaches metadata on an exact title match, case- and space-insensitive", () => {
    const rows = joinExcel([page("a", "  Immunotherapy  ")], index([["immunotherapy", "Pillar A"]]));
    expect(rows[0].excel).toEqual({ pillarNum: "1", pillarName: "Pillar A", excelStatus: "Done" });
  });

  it("leaves excel undefined when there is no match", () => {
    const rows = joinExcel([page("a", "Nothing Like It")], index([["immunotherapy", "Pillar A"]]));
    expect(rows[0].excel).toBeUndefined();
  });

  it("skips a title that is ambiguous on the Excel side", () => {
    const rows = joinExcel([page("a", "Shared")], index([], ["shared"]));
    expect(rows[0].excel).toBeUndefined();
  });

  it("skips a title that is ambiguous on the live side", () => {
    const rows = joinExcel(
      [page("a", "Shared"), page("b", "Shared")],
      index([["shared", "Pillar A"]]),
    );
    expect(rows[0].excel).toBeUndefined();
    expect(rows[1].excel).toBeUndefined();
  });

  it("still joins unambiguous rows alongside ambiguous ones", () => {
    const rows = joinExcel(
      [page("a", "Shared"), page("b", "Shared"), page("c", "Unique")],
      index([
        ["shared", "Pillar A"],
        ["unique", "Pillar B"],
      ]),
    );
    expect(rows[2].excel?.pillarName).toBe("Pillar B");
  });

  it("carries every live field through unchanged", () => {
    const p: LivePage = {
      collection: "guides",
      slug: "s",
      title: "T",
      faqDone: true,
      role: "PILLAR PAGE",
      pillarAssociation: "P",
    };
    const rows = joinExcel([p], index([]));
    expect(rows[0]).toMatchObject(p);
  });
});

describe("readExcelIndex (real workbook)", () => {
  it("records duplicate Excel titles as ambiguous instead of keeping one", () => {
    const idx = readExcelIndex();
    expect(idx.ambiguousTitles.length).toBe(24);
    for (const t of idx.ambiguousTitles) expect(idx.byTitle.has(t)).toBe(false);
  });

  it("joins 230 of the 865 live pages under the two-sided guard", () => {
    const { pages } = readPages();
    const rows = joinExcel(pages, readExcelIndex());
    expect(rows.filter((r) => r.excel).length).toBe(230);
  });
});
