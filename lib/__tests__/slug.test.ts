import { describe, it, expect } from "vitest";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it("matches the Python slugify output", () => {
    expect(slugify("What is the difference between leukemia, lymphoma, and myeloma?"))
      .toBe("what-is-the-difference-between-leukemia-lymphoma-and-myeloma");
    expect(slugify("AML treatment guide: induction, consolidation, and when is transplant needed?"))
      .toBe("aml-treatment-guide-induction-consolidation-and-when-is-transplant-needed");
    expect(slugify("  Héllo — World  ")).toBe("hello-world");
  });
});
