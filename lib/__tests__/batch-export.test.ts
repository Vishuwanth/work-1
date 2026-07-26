import { describe, it, expect } from "vitest";
import { buildMapping, batchDirName } from "@/lib/batch-export";

describe("buildMapping", () => {
  it("emits the runner's [{collection, slug, file}] shape", () => {
    expect(
      buildMapping([
        { collection: "treatments", slug: "carbon-ion-therapy" },
        { collection: "guides", slug: "brain-tumour-treatment-advanced-options" },
      ]),
    ).toEqual([
      {
        collection: "treatments",
        slug: "carbon-ion-therapy",
        file: "carbon-ion-therapy-faq-section.json",
      },
      {
        collection: "guides",
        slug: "brain-tumour-treatment-advanced-options",
        file: "brain-tumour-treatment-advanced-options-faq-section.json",
      },
    ]);
  });

  it("returns [] for no rows", () => {
    expect(buildMapping([])).toEqual([]);
  });
});

describe("batchDirName", () => {
  it("stamps the server's LOCAL date", () => {
    // 2026-07-28T02:00 local time — a UTC stamp would read 2026-07-27 in IST.
    expect(batchDirName(new Date(2026, 6, 28, 2, 0, 0))).toBe("batch-2026-07-28");
  });

  it("zero-pads month and day", () => {
    expect(batchDirName(new Date(2026, 0, 5, 12, 0, 0))).toBe("batch-2026-01-05");
  });
});
