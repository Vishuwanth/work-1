import { describe, it, expect } from "vitest";
import { readRows } from "@/lib/excel";

describe("readRows", () => {
  const rows = readRows();

  it("reads all 759 content rows from the workbook", () => {
    expect(rows.length).toBe(759);
  });

  it("maps row 463 with the correct title and slug", () => {
    const r = rows.find((x) => x.rowNum === 463)!;
    expect(r).toBeDefined();
    expect(r.title).toContain("difference between leukemia");
    expect(r.slug).toBe("what-is-the-difference-between-leukemia-lymphoma-and-myeloma");
  });
});
