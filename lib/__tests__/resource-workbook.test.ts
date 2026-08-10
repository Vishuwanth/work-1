import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  SHARED_HEADER,
  mergeResourceRows,
  toSharedRows,
  type ResourceCheck,
  type ResourceListItem,
} from "@/lib/resource-reports";
import {
  SHEET_NAME,
  WORKBOOK_HEADER,
  buildSharedWorkbook,
  buildWorkbook,
  toWorkbookRows,
} from "@/lib/resource-workbook";

function check(over: Partial<ResourceCheck> = {}): ResourceCheck {
  return {
    title: "",
    old_category: "awareness",
    new_category: "cancer-research",
    old_tags: "",
    new_tags: "liver-cancer;treatment-guide;robotic-surgery",
    status: "ok",
    reason: "Technology update with an India treatment-destination angle.",
    write_status: "dry-run",
    hasDuplicate: false,
    duplicateType: "",
    duplicateSection: "",
    duplicateContent: "",
    checkedAt: "2026-07-28T17:14:33.366Z",
    ...over,
  };
}

const LIST: ResourceListItem[] = [
  { slug: "zeta", title: "Zeta article", category: "awareness", tags: "old-tag" },
  { slug: "alpha", title: "Alpha article", category: "awareness", tags: "" },
  { slug: "mid", title: "Mid article", category: "treatments", tags: "" },
];

const CHECKS: Record<string, ResourceCheck> = {
  alpha: check({ write_status: "applied" }),
  // old_category mirrors what LIST says is live for this slug — a check records
  // what Strapi held at classification time, and mergeResourceRows trusts that
  // over the list fetch, which may be older than the batch.
  mid: check({ write_status: "failed:stale-taxonomy-slug", old_category: "treatments" }),
  // "zeta" deliberately absent — never classified.
};

const rows = mergeResourceRows(LIST, CHECKS);
const cells = toWorkbookRows(rows);

// Column indexes, mirroring WORKBOOK_HEADER.
const C = {
  sno: 0,
  title: 1,
  slug: 2,
  status: 3,
  category: 4,
  oldCategory: 5,
  newCategory: 6,
  oldTags: 7,
  newTags: 8,
  writeStatus: 9,
  reason: 10,
  duplicate: 11,
  liveUrl: 14,
  checkedAt: 15,
} as const;

describe("toWorkbookRows", () => {
  it("sorts by title and numbers S.No. from 1", () => {
    expect(cells.map((r) => r[C.title])).toEqual(["Alpha article", "Mid article", "Zeta article"]);
    expect(cells.map((r) => r[C.sno])).toEqual([1, 2, 3]);
  });

  it("makes Status a real boolean, true only when applied", () => {
    const [alpha, mid, zeta] = cells;
    expect(alpha[C.status]).toBe(true); // applied
    expect(mid[C.status]).toBe(false); // failed — attempted, but production is NOT correct
    expect(zeta[C.status]).toBe(false); // never classified
    expect(cells.every((r) => typeof r[C.status] === "boolean")).toBe(true);
  });

  it("keeps the failure reason in Write Status even though Status reads false", () => {
    const mid = cells[1];
    expect(mid[C.status]).toBe(false);
    expect(mid[C.writeStatus]).toBe("failed:stale-taxonomy-slug");
  });

  it("shows the proposed category in Category, with the live one alongside", () => {
    const alpha = cells[0];
    expect(alpha[C.category]).toBe("cancer-research");
    expect(alpha[C.oldCategory]).toBe("awareness");
    expect(alpha[C.newCategory]).toBe("cancer-research");
    expect(alpha[C.newTags]).toBe("liver-cancer; treatment-guide; robotic-surgery");
  });

  it("leaves the review columns blank for a resource that was never classified", () => {
    const zeta = cells[2];
    expect(zeta[C.category]).toBe("awareness"); // live value still shown
    for (const col of [C.oldCategory, C.newCategory, C.oldTags, C.newTags, C.writeStatus, C.reason, C.duplicate]) {
      expect(zeta[col]).toBe("");
    }
    expect(zeta[C.checkedAt]).toBe("");
  });

  it("links to the live URL only once a category has actually been written", () => {
    const [alpha, mid] = cells;
    // applied -> the new category is live, so it belongs in the path
    expect(alpha[C.liveUrl]).toBe("https://www.cancerfax.com/resources/cancer-research/alpha");
    // failed -> production still has the old category
    expect(mid[C.liveUrl]).toBe("https://www.cancerfax.com/resources/treatments/mid");
  });
});

describe("toSharedRows — the 9 columns that leave this machine", () => {
  const shared = toSharedRows(rows);
  const S = { sno: 0, title: 1, slug: 2, category: 3, oldCat: 4, newCat: 5, oldTags: 6, newTags: 7, dup: 8 } as const;

  it("carries exactly the agreed columns, in order", () => {
    expect([...SHARED_HEADER]).toEqual([
      "S.No",
      "Title of Resource",
      "Slug",
      "Category",
      "Old Category",
      "New Category",
      "Old Tags",
      "New Tags",
      "Duplicate",
    ]);
    expect(shared.every((r) => r.length === SHARED_HEADER.length)).toBe(true);
  });

  it("omits write status, reason, live URL and timestamps", () => {
    // Those stay in the committed workbook. Nothing operational leaves here.
    const flat = JSON.stringify(shared);
    expect(flat).not.toContain("failed:stale-taxonomy-slug");
    expect(flat).not.toContain("Technology update");
    expect(flat).not.toContain("cancerfax.com");
    expect(flat).not.toContain("2026-07-28T17:14:33");
  });

  it("renumbers from 1 for whatever rows it is given", () => {
    expect(shared.map((r) => r[S.sno])).toEqual([1, 2, 3]);
    // The CSV passes a filtered subset — it must still start at 1.
    expect(toSharedRows(rows.slice(1)).map((r) => r[S.sno])).toEqual([1, 2]);
  });

  it("shows the proposal even when the write failed", () => {
    // "mid" failed to write. This is a review document, so the intended value
    // is still what a reviewer needs to see; the committed workbook records
    // that it never landed.
    const mid = shared[1];
    expect(mid[S.newCat]).toBe("cancer-research");
    expect(mid[S.newTags]).toBe("liver-cancer; treatment-guide; robotic-surgery");
  });

  it("leaves Duplicate blank when the audit never ran", () => {
    // Blank is not "No". A Write batch never computes duplicates, so claiming
    // "No" would report a check that never happened.
    expect(shared.map((r) => r[S.dup])).toEqual(["", "", ""]);
  });

  it("says No only once the audit has actually run", () => {
    const audited = mergeResourceRows(LIST, {
      ...CHECKS,
      alpha: check({ write_status: "applied", duplicateChecked: true, hasDuplicate: false }),
      zeta: check({ duplicateChecked: true, hasDuplicate: true }),
    });
    const out = toSharedRows(audited);
    expect(out[0][S.dup]).toBe("No"); // audited, clean
    expect(out[2][S.dup]).toBe("Yes"); // audited, found one
  });

  it("blanks the review columns for a resource never classified", () => {
    const zeta = shared[2];
    expect(zeta[S.category]).toBe("awareness"); // live value still shown
    for (const col of [S.oldCat, S.newCat, S.oldTags, S.newTags]) expect(zeta[col]).toBe("");
  });
});

describe("buildSharedWorkbook", () => {
  it("writes only the shared header", () => {
    const back = XLSX.read(XLSX.write(buildSharedWorkbook(rows), { type: "buffer", bookType: "xlsx" }), {
      type: "buffer",
    });
    const [header] = XLSX.utils.sheet_to_json<string[]>(back.Sheets[SHEET_NAME], { header: 1 });
    expect(header).toEqual([...SHARED_HEADER]);
  });

  it("keeps the same rows as the full workbook", () => {
    const count = (wb: XLSX.WorkBook) =>
      XLSX.utils.sheet_to_json(wb.Sheets[SHEET_NAME], { header: 1 }).length;
    expect(count(buildSharedWorkbook(rows))).toBe(count(buildWorkbook(rows)));
  });
});

describe("buildWorkbook", () => {
  const roundTripped = XLSX.read(XLSX.write(buildWorkbook(rows), { type: "buffer", bookType: "xlsx" }), {
    type: "buffer",
  });
  const sheet = roundTripped.Sheets[SHEET_NAME];

  it("writes a single sheet with the expected header", () => {
    expect(roundTripped.SheetNames).toEqual([SHEET_NAME]);
    const [header] = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(header).toEqual([...WORKBOOK_HEADER]);
  });

  it("survives the xlsx round trip with Status as an Excel boolean cell", () => {
    // t:"b" is what the hand-kept sheet held. Text "TRUE" would break it as a tick-box.
    expect(sheet["D2"].t).toBe("b");
    expect(sheet["D2"].v).toBe(true);
    expect(sheet["D3"].v).toBe(false);
  });

  it("writes one row per resource plus the header", () => {
    const all = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    expect(all).toHaveLength(rows.length + 1);
  });
});
