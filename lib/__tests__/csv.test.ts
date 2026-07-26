import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("parses a simple header + rows", () => {
    const rows = parseCsv("a,b\n1,2\n3,4\n");
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    const rows = parseCsv('collection,title\ninsights,"Cancer Cost: China, India, USA"\n');
    expect(rows[0].title).toBe("Cancer Cost: China, India, USA");
  });

  it("unescapes doubled quotes", () => {
    const rows = parseCsv('a\n"He said ""hi"""\n');
    expect(rows[0].a).toBe('He said "hi"');
  });

  it("keeps newlines inside quoted fields", () => {
    const rows = parseCsv('a,b\n"line1\nline2",x\n');
    expect(rows[0].a).toBe("line1\nline2");
    expect(rows[0].b).toBe("x");
  });

  it("trims values and header names", () => {
    const rows = parseCsv(" a , b \n 1 , 2 \n");
    expect(rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("pads short rows with empty strings", () => {
    const rows = parseCsv("a,b,c\n1,2\n");
    expect(rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });

  it("ignores a trailing newline and blank lines", () => {
    expect(parseCsv("a\n1\n\n")).toEqual([{ a: "1" }]);
  });

  it("returns [] for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([{ a: "1", b: "2" }]);
  });
});
