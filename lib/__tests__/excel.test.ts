import { describe, it, expect } from "vitest";
import { readRows } from "@/lib/excel";

describe("readRows", () => {
  const rows = readRows();

  it("reads all 719 titled content rows from the workbook", () => {
    // 719 rows have a Support Page Title; 40 more carry only pillar/status
    // (incomplete placeholders) and are intentionally skipped.
    expect(rows.length).toBe(719);
  });

  it("skips rows without a Support Page Title (no empty slugs)", () => {
    expect(rows.every((r) => r.title !== "" && r.slug !== "")).toBe(true);
  });

  it("maps row 463 with the correct title and slug", () => {
    const r = rows.find((x) => x.rowNum === 463)!;
    expect(r).toBeDefined();
    expect(r.title).toContain("difference between leukemia");
    expect(r.slug).toBe("what-is-the-difference-between-leukemia-lymphoma-and-myeloma");
  });
});
