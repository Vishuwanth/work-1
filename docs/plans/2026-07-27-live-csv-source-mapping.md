# Live-CSV Source Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint the CancerFax review app from the 719-row planning workbook onto the 865-page live-site CSV, so every row carries a real Strapi `collection` + `slug` and every exported fixture is publishable by the team's `apply-pillar-faqs.js` runner.

**Architecture:** Two new pure readers (`lib/pages.ts`, `lib/ledger.ts`) built on one shared quote-aware CSV parser replace `lib/excel.ts` as the row source; Excel demotes to an optional metadata join guarded against duplicate titles on both sides. A new `lib/validate.ts` gates every generated fixture against the canonical format taken from `batch-2026-07-20/`. A one-shot `scripts/reconcile-corpus.mjs` splits the existing 619-fixture corpus using the team's ledger as ground truth. The app never touches Strapi; it emits a batch folder plus `mapping.json` for the team's runner.

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest (node environment, `lib/**/*.test.ts` only), `xlsx` for workbook read/write, no new dependencies.

**Spec:** `docs/specs/2026-07-27-live-csv-source-mapping-design.md`

## Global Constraints

- **Never run `git commit` or `git push`.** Vishwanth makes every commit. Each task's final step stages files and prints a suggested message in the form `Vishwanth | <type>: <description>`. Stop there.
- **Source CSVs are read-only.** Never write to `docs/source/cancerfax-faq-generator/all-pages-faq-status.csv`, `master-faq-reconciliation.csv`, or `CancerFax_Content_Architecture_1.xlsx`.
- **No fuzzy matching anywhere.** Title joins are exact, lowercased, trimmed, and skipped entirely when the title is ambiguous on either side. No fuzzy slug matching, no rename inference, no similarity thresholds.
- **Row identity is `collection` + `slug`.** The tracker key and every React list key is the template string `` `${collection}/${slug}` ``.
- **`runner` is always the literal `"apply-pillar-faqs.js"`.**
- **`route` is always `` `/${collection}/${slug}` ``.**
- **`contentType` is the Title-case of `collection`:** `guides` → `Guides`, `insights` → `Insights`, `treatments` → `Treatments`.
- **`sectionToMerge.type` and `sectionToMerge.id` are both the literal `"faq"`.**
- **Default `h2` is `"Frequently Asked Questions"`.**
- **Item counts are fixed, not ranges:** `PILLAR PAGE` → exactly 20 items in 4–5 titled groups of 4–5; `Support Page` or blank role → exactly 10 items in exactly 1 group whose `title` is `""`.
- **Answers are HTML wrapped in `<p>…</p>` with no other tag.**
- **The `⚠` character must never appear in generated output.**
- **"CancerFax" appears in 1–2 answers per fixture.** Zero or three-plus is a hard failure.
- **Tests run with `npx vitest run`.** Vitest only collects `lib/**/*.test.ts`, so every pure helper lives under `lib/`.
- Path alias `@/` maps to the repo root (see `tsconfig.json`).

## File Structure

| File | Responsibility |
|---|---|
| `lib/csv.ts` | **new** — quote-aware CSV text → `Record<string,string>[]`. Nothing else. |
| `lib/pages.ts` | **new** — parse `all-pages-faq-status.csv` into `LivePage[]`. |
| `lib/ledger.ts` | **new** — parse `master-faq-reconciliation.csv` into `Map<filename, LedgerStatus>`. |
| `lib/excel.ts` | **modify** — demoted to an ambiguity-safe title→metadata lookup. |
| `lib/types.ts` | **modify** — new `Row`, canonical `Fixture`, `perCollection` stats. |
| `lib/validate.ts` | **new** — the 10 fixture checks. |
| `lib/fixtures.ts` | **modify** — drop VERIFY helpers, add `question`/`answer` normalization. |
| `lib/reconcile.ts` | **new** — pure corpus split planner. |
| `scripts/reconcile-corpus.mjs` | **new** — the fs + zip side of the one-shot migration. |
| `lib/state.ts` | **modify** — key by `collection/slug`, drop `verifyCount`, `perPillar` → `perCollection`. |
| `lib/generate.ts` | **modify** — role-driven counts, canonical fixture, validator gate. |
| `docs/prompts/faq-generation-prompt.md` | **rewrite** — from the AEO rulebook. |
| `lib/batch-export.ts` | **new** — `mapping.json` shape + batch folder naming. |
| `app/api/export/batch/route.ts` | **new** — writes the batch folder. |
| `lib/export.ts` | **modify** — status workbook columns. |
| `app/actions.ts` | **modify** — wire the new readers and keys. |
| `components/rows-table.tsx` | **modify** — collection filter, new badges, default filter. |
| `components/faq-detail-drawer.tsx` | **modify** — remove slug/route resolve fields. |
| `components/bento-overview.tsx` | **modify** — `perCollection`, drop `withVerify`. |

Tasks 1–10 are pure `lib/` work with real tests. Task 11 is the UI wiring, done last so it compiles against a settled interface.

---

### Task 1: Quote-aware CSV parser

**Files:**
- Create: `lib/csv.ts`
- Test: `lib/__tests__/csv.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseCsv(text: string): Record<string, string>[]` — first non-empty line is the header; every row becomes an object keyed by trimmed header names. Values are trimmed. Rows with fewer cells than the header get `""` for missing keys.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/csv.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/csv.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/csv"`.

- [ ] **Step 3: Write the implementation**

Create `lib/csv.ts`:

```ts
// Quote-aware CSV reader. The source CSVs carry commas and colons inside titles,
// so a split(",") reader silently corrupts them.

/** Split CSV text into rows of raw cells, honouring quotes, doubled quotes, and embedded newlines. */
function toGrid(text: string): string[][] {
  const grid: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      grid.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    grid.push(row);
  }
  return grid;
}

/**
 * Parse CSV text into objects keyed by the header row. Values and header names are
 * trimmed; rows shorter than the header are padded with "". Blank lines are dropped.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const grid = toGrid(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (grid.length === 0) return [];
  const header = grid[0].map((h) => h.trim());
  return grid.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").trim();
    });
    return obj;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/csv.test.ts`
Expected: PASS — 9 passed.

- [ ] **Step 5: Stage and hand off**

```bash
git add lib/csv.ts lib/__tests__/csv.test.ts
```

Suggested message — **do not run it**, report it to Vishwanth:

```
Vishwanth | feat(csv): add quote-aware CSV parser for live-site sources
```

---

### Task 2: Live page reader

**Files:**
- Create: `lib/pages.ts`
- Test: `lib/__tests__/pages.test.ts`

**Interfaces:**
- Consumes: `parseCsv` from Task 1.
- Produces:
  - `type Collection = "guides" | "insights" | "treatments"`
  - `type PageRole = "PILLAR PAGE" | "Support Page" | ""`
  - `interface LivePage { collection: Collection; slug: string; title: string; faqDone: boolean; role: PageRole; pillarAssociation: string }`
  - `interface PagesResult { pages: LivePage[]; skipped: number }`
  - `parsePages(csvText: string): PagesResult`
  - `readPages(csvPath?: string): PagesResult`
  - `pageKey(p: { collection: string; slug: string }): string`
  - `const PAGES_CSV = "docs/source/cancerfax-faq-generator/all-pages-faq-status.csv"`

Note `Collection` and `PageRole` are declared here and **re-exported** from `lib/types.ts` in Task 3, so later tasks may import either path.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/pages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePages, readPages, pageKey } from "@/lib/pages";

const HEADER = "collection,slug,title,faq_done,role,pillar_association";

describe("parsePages", () => {
  it("reads a full row", () => {
    const { pages } = parsePages(
      `${HEADER}\nguides,advanced-cancer-treatment,Advanced Cancer Treatment,Yes,PILLAR PAGE,Advanced Cancer Treatment\n`,
    );
    expect(pages).toEqual([
      {
        collection: "guides",
        slug: "advanced-cancer-treatment",
        title: "Advanced Cancer Treatment",
        faqDone: true,
        role: "PILLAR PAGE",
        pillarAssociation: "Advanced Cancer Treatment",
      },
    ]);
  });

  it("treats any faq_done other than Yes as not done", () => {
    const { pages } = parsePages(
      `${HEADER}\ninsights,a,A,No,,\ninsights,b,B,,,\ninsights,c,C,yes,,\n`,
    );
    expect(pages.map((p) => p.faqDone)).toEqual([false, false, true]);
  });

  it("keeps a blank role blank rather than guessing", () => {
    const { pages } = parsePages(`${HEADER}\ninsights,a,A,No,,\n`);
    expect(pages[0].role).toBe("");
  });

  it("normalizes an unrecognized role to Support Page", () => {
    const { pages } = parsePages(`${HEADER}\ninsights,a,A,No,Something Else,\n`);
    expect(pages[0].role).toBe("Support Page");
  });

  it("skips rows missing collection or slug and counts them", () => {
    const { pages, skipped } = parsePages(
      `${HEADER}\ninsights,,A,No,,\n,b,B,No,,\ninsights,c,C,No,,\n`,
    );
    expect(pages).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("skips rows with an unknown collection", () => {
    const { pages, skipped } = parsePages(`${HEADER}\nblogs,a,A,No,,\n`);
    expect(pages).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("preserves commas inside a quoted title", () => {
    const { pages } = parsePages(
      `${HEADER}\ninsights,x,"Cost: China, India, USA",No,,\n`,
    );
    expect(pages[0].title).toBe("Cost: China, India, USA");
  });
});

describe("pageKey", () => {
  it("joins collection and slug", () => {
    expect(pageKey({ collection: "guides", slug: "abc" })).toBe("guides/abc");
  });
});

describe("readPages (real source file)", () => {
  it("reads all 865 live pages with no skips", () => {
    const { pages, skipped } = readPages();
    expect(pages).toHaveLength(865);
    expect(skipped).toBe(0);
  });

  it("has 449 pages still needing FAQs", () => {
    const { pages } = readPages();
    expect(pages.filter((p) => !p.faqDone)).toHaveLength(449);
  });

  it("has unique collection/slug keys", () => {
    const { pages } = readPages();
    expect(new Set(pages.map(pageKey)).size).toBe(pages.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/pages.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/pages"`.

- [ ] **Step 3: Write the implementation**

Create `lib/pages.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv } from "@/lib/csv";

export const PAGES_CSV = "docs/source/cancerfax-faq-generator/all-pages-faq-status.csv";

export type Collection = "guides" | "insights" | "treatments";
export type PageRole = "PILLAR PAGE" | "Support Page" | "";

const COLLECTIONS = new Set<string>(["guides", "insights", "treatments"]);

/** One live published page, as the site's own status CSV describes it. */
export interface LivePage {
  collection: Collection;
  slug: string;
  title: string;
  faqDone: boolean;
  role: PageRole;
  pillarAssociation: string;
}

export interface PagesResult {
  pages: LivePage[];
  /** Rows dropped for a missing/unknown collection or a missing slug. */
  skipped: number;
}

/** The identity of a page everywhere in the app: tracker keys, React keys, lookups. */
export function pageKey(p: { collection: string; slug: string }): string {
  return `${p.collection}/${p.slug}`;
}

/**
 * A blank role means "Support Page" per the generator skill, but we keep the blank
 * so the UI can show that the source never said. Any other unrecognized value is
 * normalized to Support Page — the count rule treats blank and Support alike.
 */
function toRole(raw: string): PageRole {
  if (raw === "") return "";
  if (raw === "PILLAR PAGE") return "PILLAR PAGE";
  return "Support Page";
}

export function parsePages(csvText: string): PagesResult {
  const pages: LivePage[] = [];
  let skipped = 0;
  for (const r of parseCsv(csvText)) {
    const collection = r.collection ?? "";
    const slug = r.slug ?? "";
    if (slug === "" || !COLLECTIONS.has(collection)) {
      skipped++;
      continue;
    }
    pages.push({
      collection: collection as Collection,
      slug,
      title: r.title ?? "",
      faqDone: (r.faq_done ?? "").toLowerCase() === "yes",
      role: toRole(r.role ?? ""),
      pillarAssociation: r.pillar_association ?? "",
    });
  }
  return { pages, skipped };
}

export function readPages(csvPath?: string): PagesResult {
  const path = csvPath ?? resolve(process.cwd(), PAGES_CSV);
  return parsePages(readFileSync(path, "utf8"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/pages.test.ts`
Expected: PASS — 11 passed. The three `readPages` cases assert against the real
CSV, so a wrong path or a broken parser fails loudly here rather than in the UI.

- [ ] **Step 5: Stage and hand off**

```bash
git add lib/pages.ts lib/__tests__/pages.test.ts
```

```
Vishwanth | feat(pages): read live-site page inventory from all-pages-faq-status.csv
```

---

### Task 3: Ledger reader

**Files:**
- Create: `lib/ledger.ts`
- Test: `lib/__tests__/ledger.test.ts`

**Interfaces:**
- Consumes: `parseCsv` from Task 1.
- Produces:
  - `type LedgerStatus = "live" | "no-page" | "drifted" | "other"`
  - `const APP_BATCH_FOLDER = "150 pillar pages"`
  - `const LEDGER_CSV = "docs/source/cancerfax-faq-generator/master-faq-reconciliation.csv"`
  - `parseLedger(csvText: string, sourceFolder?: string): Map<string, LedgerStatus>`
  - `readLedger(csvPath?: string, sourceFolder?: string): Map<string, LedgerStatus>`

Both functions default `sourceFolder` to `APP_BATCH_FOLDER`. Passing `null` reads every folder.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/ledger.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLedger, readLedger, APP_BATCH_FOLDER } from "@/lib/ledger";

const HEADER = "source_folder,file,target_collection,target_slug,status";
const F = APP_BATCH_FOLDER;

describe("parseLedger", () => {
  it("maps the three real verdicts", () => {
    const m = parseLedger(
      `${HEADER}\n` +
        `${F},a-faq-section.json,guides,a,DONE - verified live now\n` +
        `${F},b-faq-section.json,guides,b,UNDONE - never had a matching page\n` +
        `${F},c-faq-section.json,guides,c,RAN BUT NOW MISSING (slug drift/deleted)\n`,
    );
    expect(m.get("a-faq-section.json")).toBe("live");
    expect(m.get("b-faq-section.json")).toBe("no-page");
    expect(m.get("c-faq-section.json")).toBe("drifted");
  });

  it("matches DONE by prefix so a trailing parenthetical still counts as live", () => {
    const m = parseLedger(
      `${HEADER}\n${F},a-faq-section.json,guides,a,"DONE - verified live now (slug renamed cancer-immunotherapy -> immunotherapy)"\n`,
    );
    expect(m.get("a-faq-section.json")).toBe("live");
  });

  it("labels an unrecognized status as other", () => {
    const m = parseLedger(`${HEADER}\n${F},a-faq-section.json,guides,a,CSV REBUILT from live Strapi\n`);
    expect(m.get("a-faq-section.json")).toBe("other");
  });

  it("keeps only the requested source folder by default", () => {
    const m = parseLedger(
      `${HEADER}\n` +
        `${F},mine.json,guides,a,DONE - verified live now\n` +
        `batch-2026-07-20,theirs.json,guides,b,DONE - verified live now\n`,
    );
    expect(m.has("mine.json")).toBe(true);
    expect(m.has("theirs.json")).toBe(false);
  });

  it("reads every folder when sourceFolder is null", () => {
    const m = parseLedger(
      `${HEADER}\n` +
        `${F},mine.json,guides,a,DONE - verified live now\n` +
        `batch-2026-07-20,theirs.json,guides,b,DONE - verified live now\n`,
      null,
    );
    expect(m.size).toBe(2);
  });

  it("skips rows with no file name", () => {
    const m = parseLedger(`${HEADER}\n${F},,guides,a,DONE - verified live now\n`);
    expect(m.size).toBe(0);
  });
});

describe("readLedger (real source file)", () => {
  it("reproduces the team's 286 / 324 / 9 split for this app's batch", () => {
    const m = readLedger();
    const count = (s: string) => [...m.values()].filter((v) => v === s).length;
    expect(m.size).toBe(619);
    expect(count("live")).toBe(286);
    expect(count("no-page")).toBe(324);
    expect(count("drifted")).toBe(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/ledger.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ledger"`.

- [ ] **Step 3: Write the implementation**

Create `lib/ledger.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv } from "@/lib/csv";

export const LEDGER_CSV =
  "docs/source/cancerfax-faq-generator/master-faq-reconciliation.csv";

/** The source_folder this app's own 619-fixture corpus was filed under. */
export const APP_BATCH_FOLDER = "150 pillar pages";

/**
 * What the team's reconciliation found for one fixture file:
 * live     — applied and verified on the live site
 * no-page  — the target page never existed
 * drifted  — applied once, but the slug has since been renamed or deleted
 * other    — an audit/bookkeeping row, not a fixture verdict
 */
export type LedgerStatus = "live" | "no-page" | "drifted" | "other";

/**
 * Prefix matching, not equality: several DONE rows carry a trailing parenthetical
 * such as "DONE - verified live now (slug renamed cancer-immunotherapy -> immunotherapy)".
 */
function toStatus(raw: string): LedgerStatus {
  if (raw.startsWith("DONE")) return "live";
  if (raw.startsWith("UNDONE")) return "no-page";
  if (raw.startsWith("RAN BUT NOW MISSING")) return "drifted";
  return "other";
}

/** `sourceFolder` defaults to this app's own batch; pass null to read every folder. */
export function parseLedger(
  csvText: string,
  sourceFolder: string | null = APP_BATCH_FOLDER,
): Map<string, LedgerStatus> {
  const out = new Map<string, LedgerStatus>();
  for (const r of parseCsv(csvText)) {
    const file = r.file ?? "";
    if (file === "") continue;
    if (sourceFolder !== null && r.source_folder !== sourceFolder) continue;
    out.set(file, toStatus(r.status ?? ""));
  }
  return out;
}

export function readLedger(
  csvPath?: string,
  sourceFolder: string | null = APP_BATCH_FOLDER,
): Map<string, LedgerStatus> {
  const path = csvPath ?? resolve(process.cwd(), LEDGER_CSV);
  return parseLedger(readFileSync(path, "utf8"), sourceFolder);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/ledger.test.ts`
Expected: PASS — 7 passed. The last case pins the exact 286 / 324 / 9 split the
reconciler in Task 7 depends on.

- [ ] **Step 5: Stage and hand off**

```bash
git add lib/ledger.ts lib/__tests__/ledger.test.ts
```

```
Vishwanth | feat(ledger): read the team's FAQ reconciliation verdicts
```

---

### Task 4: Types and the ambiguity-safe Excel join

**Files:**
- Modify: `lib/types.ts` (full rewrite)
- Modify: `lib/excel.ts` (full rewrite)
- Test: `lib/__tests__/excel.test.ts` (replace existing contents)

**Interfaces:**
- Consumes: `LivePage`, `Collection`, `PageRole`, `pageKey` from Task 2.
- Produces:
  - `interface ExcelMeta { pillarNum: string; pillarName: string; excelStatus: string }`
  - `interface ExcelIndex { byTitle: Map<string, ExcelMeta>; ambiguousTitles: string[] }`
  - `readExcelIndex(xlsxPath?: string): ExcelIndex`
  - `joinExcel(pages: LivePage[], index: ExcelIndex): Row[]`
  - `Row`, `Fixture`, `FaqSection`, `FaqGroup`, `FaqItem`, `ReviewRecord`, `RowView`, `OverviewStats` in `lib/types.ts`

`joinExcel` is where the two-sided guard lives: it counts live titles itself, so a title duplicated on **either** side joins to neither.

- [ ] **Step 1: Write the failing test**

Replace `lib/__tests__/excel.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/excel.test.ts`
Expected: FAIL — `readExcelIndex is not a function` (the module still exports only `readRows`).

- [ ] **Step 3: Rewrite `lib/types.ts`**

```ts
// Shared types for the CancerFax review app.
// Row identity is `collection` + `slug`, taken from the live-site status CSV.
import type { Collection, PageRole } from "@/lib/pages";

export type { Collection, PageRole };

export type ContentState = "not-generated" | "raw" | "done";
export type ReviewStatus = "pending" | "approved" | "needs-work";
/** Transient client-side generation status overlaid on a row during a batch/single run. */
export type GenStatus = "queued" | "running" | "done" | "failed" | "skipped";

/** Optional planning metadata joined in from the read-only workbook. */
export interface ExcelMeta {
  pillarNum: string;
  pillarName: string;
  excelStatus: string;
}

/** One live page, optionally enriched with workbook metadata. */
export interface Row {
  collection: Collection;
  slug: string;
  title: string;
  faqDone: boolean;
  role: PageRole;
  pillarAssociation: string;
  excel?: ExcelMeta;
}

/** A single FAQ item. */
export interface FaqItem {
  q: string;
  a: string;
}

/** A thematic group of FAQ items. Support pages use a single group with title "". */
export interface FaqGroup {
  title: string;
  items: FaqItem[];
}

/** The FAQ section carried by a fixture. `intro` is optional and omitted by default. */
export interface FaqSection {
  type: "faq";
  id: "faq";
  h2: string;
  intro?: string;
  groups: FaqGroup[];
}

/** A fixture in the team's `apply-pillar-faqs.js` format. */
export interface Fixture {
  pillar: string;
  contentType: "Guides" | "Insights" | "Treatments";
  runner: "apply-pillar-faqs.js";
  slug: string;
  route: string;
  sectionToMerge: FaqSection;
}

/** Per-page edit overlay + review decision, persisted in tracker.json keyed "collection/slug". */
export interface ReviewRecord {
  reviewStatus: ReviewStatus;
  note: string;
  edits: {
    /** Keyed "<groupIndex>.<itemIndex>". */
    answers: Record<string, string>;
  };
  reviewedAt?: string;
  movedAt?: string;
  generatedAt?: string;
  /** Set by scripts/reconcile-corpus.mjs for the pre-migration corpus. */
  ledgerStatus?: "live" | "no-page" | "drifted" | "other";
}

/** UI toggles persisted in toggles.json. */
export interface Toggles {
  autoGenerate: boolean;
  autoMove: boolean;
  /** Approve (and move, if autoMove) a row the instant it's generated — no review step. */
  autoApprove: boolean;
}

/** A Row enriched with derived generation + review state. */
export type RowView = Row & {
  contentState: ContentState;
  reviewStatus: ReviewStatus;
  faqCount: number | null;
  /** The fixture file exists but could not be parsed as JSON. */
  invalid?: boolean;
};

/** A single day's generation count, for the 7-day throughput chart. */
export interface ThroughputPoint {
  date: string;
  count: number;
}

/** Aggregate counts for the command-center overview. */
export interface OverviewStats {
  total: number;
  generated: number;
  approved: number;
  needsWork: number;
  pending: number;
  perCollection: Record<string, number>;
  /** Generated-per-day for the last 7 days (oldest → newest). */
  throughput: ThroughputPoint[];
}
```

- [ ] **Step 4: Rewrite `lib/excel.ts`**

```ts
// The workbook is no longer the source of truth — the live-site CSV is. This module
// now supplies OPTIONAL planning metadata, joined onto live pages by exact title.
//
// Fuzzy matching is forbidden. The site's titles are templated ("Accessing X Through
// CancerFax", "X Cost Comparison: China vs India") and share enough boilerplate that
// a similarity match confidently merges two genuinely different pages.
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import type { Row, ExcelMeta } from "@/lib/types";
import type { LivePage } from "@/lib/pages";

const DEFAULT_SHEET = "All 300 Pages";
const DEFAULT_XLSX = "docs/source/CancerFax_Content_Architecture_1.xlsx";

// Column positions (0-indexed) in the "All 300 Pages" sheet:
// # | Pillar # | Pillar Name | Support Page # | Support Page Title | Status | Writer | Assigned To | Target Publish Date | Content Type
const COL = { pillarNum: 1, pillarName: 2, title: 4, status: 5 } as const;

export type { ExcelMeta };

export interface ExcelIndex {
  /** Lowercased, trimmed title -> metadata. Ambiguous titles are absent. */
  byTitle: Map<string, ExcelMeta>;
  /** Titles claimed by more than one workbook row; joined to nothing. */
  ambiguousTitles: string[];
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function normTitle(t: string): string {
  return t.trim().toLowerCase();
}

/**
 * Index the workbook by title. A title used by more than one row is removed from the
 * index and reported in `ambiguousTitles` — picking either row would attach one
 * page's pillar to a different page.
 */
export function readExcelIndex(xlsxPath?: string): ExcelIndex {
  const path = xlsxPath ?? resolve(process.cwd(), DEFAULT_XLSX);
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[DEFAULT_SHEET];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: 1, blankrows: true });

  const byTitle = new Map<string, ExcelMeta>();
  const seen = new Map<string, number>();
  // grid[0] is the header row (Excel row 2); a content row has a non-empty title.
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i] || [];
    const title = str(cells[COL.title]);
    if (title === "") continue;
    const key = normTitle(title);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    byTitle.set(key, {
      pillarNum: str(cells[COL.pillarNum]),
      pillarName: str(cells[COL.pillarName]),
      excelStatus: str(cells[COL.status]),
    });
  }

  const ambiguousTitles: string[] = [];
  for (const [key, n] of seen) {
    if (n > 1) {
      ambiguousTitles.push(key);
      byTitle.delete(key);
    }
  }
  return { byTitle, ambiguousTitles };
}

/**
 * Attach workbook metadata to live pages. A title joins only when it appears exactly
 * once on EACH side — duplicates on the live side are just as dangerous as duplicates
 * in the workbook, so both are counted here.
 */
export function joinExcel(pages: LivePage[], index: ExcelIndex): Row[] {
  const liveCount = new Map<string, number>();
  for (const p of pages) {
    const key = normTitle(p.title);
    liveCount.set(key, (liveCount.get(key) ?? 0) + 1);
  }

  return pages.map((p) => {
    const key = normTitle(p.title);
    const meta = liveCount.get(key) === 1 ? index.byTitle.get(key) : undefined;
    return meta ? { ...p, excel: meta } : { ...p };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/excel.test.ts`
Expected: PASS — 8 passed.

Other suites still reference the old `Row` and will not compile yet. That is expected; Tasks 5–11 fix them in order. Do not run the full suite here.

- [ ] **Step 6: Stage and hand off**

```bash
git add lib/types.ts lib/excel.ts lib/__tests__/excel.test.ts
```

```
Vishwanth | refactor(types): key rows by collection/slug, demote Excel to metadata
```

---

### Task 5: Fixture helpers

**Files:**
- Modify: `lib/fixtures.ts` (full rewrite)
- Test: `lib/__tests__/fixtures.test.ts` (replace existing contents)

**Interfaces:**
- Consumes: `Fixture`, `FaqSection`, `ReviewRecord` from Task 4.
- Produces:
  - `normalizeFixture(raw: unknown): Fixture | null` — accepts `section` or `sectionToMerge`, and `question`/`answer` or `q`/`a`; always returns the canonical shape. Returns `null` when the input is not an object with a usable faq section.
  - `getSection(fx: Fixture): FaqSection`
  - `faqCount(fx: Fixture): number`
  - `isFaqShape(fx: Fixture): boolean`
  - `ensureP(html: unknown): string`
  - `applyEdits(fx: Fixture, rec: ReviewRecord): Fixture`
  - `titleCaseCollection(c: string): "Guides" | "Insights" | "Treatments"`
  - `routeFor(collection: string, slug: string): string`
  - `fixtureFilename(slug: string): string`
  - `rawSectionKeys(raw: unknown): { type: unknown; id: unknown }`

`fixtureFilename` lives here rather than in `lib/generate.ts` so that
`lib/batch-export.ts` can use it without pulling `node:child_process` into its
import graph.

`rawSectionKeys` reads `type` and `id` off the **unnormalized** input, because
`normalizeFixture` forces both to `"faq"`. The validator needs to see what the
file actually said.

`VERIFY_RE`, `cleanSlug`, and `verifyFlags` are deleted. Slugs come from the CSV and are never guessed, so there is nothing to verify.

- [ ] **Step 1: Write the failing test**

Replace `lib/__tests__/fixtures.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import {
  normalizeFixture,
  faqCount,
  isFaqShape,
  ensureP,
  applyEdits,
  titleCaseCollection,
  routeFor,
  fixtureFilename,
  rawSectionKeys,
} from "@/lib/fixtures";
import type { Fixture, ReviewRecord } from "@/lib/types";

const RAW = {
  pillar: "Proton therapy",
  contentType: "Treatments",
  runner: "apply-pillar-faqs.js",
  slug: "carbon-ion-therapy",
  route: "/treatments/carbon-ion-therapy",
  sectionToMerge: {
    type: "faq",
    id: "faq",
    h2: "Frequently Asked Questions",
    groups: [{ title: "", items: [{ q: "Q1", a: "<p>A1</p>" }] }],
  },
};

describe("normalizeFixture", () => {
  it("passes a canonical fixture through unchanged", () => {
    expect(normalizeFixture(RAW)).toEqual(RAW);
  });

  it("moves a legacy `section` key to `sectionToMerge`", () => {
    const { sectionToMerge, ...rest } = RAW;
    const fx = normalizeFixture({ ...rest, section: sectionToMerge });
    expect(fx?.sectionToMerge.groups[0].items[0].q).toBe("Q1");
    expect((fx as unknown as Record<string, unknown>).section).toBeUndefined();
  });

  it("renames question/answer to q/a", () => {
    const fx = normalizeFixture({
      ...RAW,
      sectionToMerge: {
        ...RAW.sectionToMerge,
        groups: [{ title: "", items: [{ question: "Q1", answer: "<p>A1</p>" }] }],
      },
    });
    expect(fx?.sectionToMerge.groups[0].items[0]).toEqual({ q: "Q1", a: "<p>A1</p>" });
  });

  it("drops legacy top-level fields", () => {
    const fx = normalizeFixture({
      ...RAW,
      schemaRecommendation: "x",
      medicalDisclaimer: "y",
    }) as unknown as Record<string, unknown>;
    expect(fx.schemaRecommendation).toBeUndefined();
    expect(fx.medicalDisclaimer).toBeUndefined();
  });

  it("keeps intro when present and omits the key when absent", () => {
    const withIntro = normalizeFixture({
      ...RAW,
      sectionToMerge: { ...RAW.sectionToMerge, intro: "Hello" },
    });
    expect(withIntro?.sectionToMerge.intro).toBe("Hello");
    expect("intro" in (normalizeFixture(RAW) as Fixture).sectionToMerge).toBe(false);
  });

  it("returns null for junk", () => {
    expect(normalizeFixture(null)).toBeNull();
    expect(normalizeFixture("nope")).toBeNull();
    expect(normalizeFixture({ pillar: "x" })).toBeNull();
  });
});

describe("faqCount", () => {
  it("sums items across groups", () => {
    const fx = normalizeFixture({
      ...RAW,
      sectionToMerge: {
        ...RAW.sectionToMerge,
        groups: [
          { title: "G1", items: [{ q: "a", a: "<p>1</p>" }, { q: "b", a: "<p>2</p>" }] },
          { title: "G2", items: [{ q: "c", a: "<p>3</p>" }] },
        ],
      },
    }) as Fixture;
    expect(faqCount(fx)).toBe(3);
  });
});

describe("isFaqShape", () => {
  it("accepts the canonical shape", () => {
    expect(isFaqShape(normalizeFixture(RAW) as Fixture)).toBe(true);
  });
});

describe("ensureP", () => {
  it("wraps a bare string", () => {
    expect(ensureP("hello")).toBe("<p>hello</p>");
  });
  it("leaves an already-wrapped string alone", () => {
    expect(ensureP("<p>hello</p>")).toBe("<p>hello</p>");
  });
  it("does not double-wrap after trimming", () => {
    expect(ensureP("  <p>hello</p>  ")).toBe("<p>hello</p>");
  });
});

describe("applyEdits", () => {
  const rec: ReviewRecord = {
    reviewStatus: "approved",
    note: "",
    edits: { answers: { "0.0": "edited" } },
  };

  it("applies an answer edit and wraps it", () => {
    const out = applyEdits(normalizeFixture(RAW) as Fixture, rec);
    expect(out.sectionToMerge.groups[0].items[0].a).toBe("<p>edited</p>");
  });

  it("never mutates the input", () => {
    const fx = normalizeFixture(RAW) as Fixture;
    applyEdits(fx, rec);
    expect(fx.sectionToMerge.groups[0].items[0].a).toBe("<p>A1</p>");
  });
});

describe("titleCaseCollection / routeFor / fixtureFilename", () => {
  it("title-cases each collection", () => {
    expect(titleCaseCollection("guides")).toBe("Guides");
    expect(titleCaseCollection("insights")).toBe("Insights");
    expect(titleCaseCollection("treatments")).toBe("Treatments");
  });
  it("throws on an unknown collection", () => {
    expect(() => titleCaseCollection("blogs")).toThrow(/unknown collection/);
  });
  it("builds the route", () => {
    expect(routeFor("treatments", "carbon-ion-therapy")).toBe("/treatments/carbon-ion-therapy");
  });
  it("builds the fixture filename", () => {
    expect(fixtureFilename("carbon-ion-therapy")).toBe("carbon-ion-therapy-faq-section.json");
  });
});

describe("rawSectionKeys", () => {
  it("reports what the file actually said, not the normalized value", () => {
    const raw = { ...RAW, sectionToMerge: { ...RAW.sectionToMerge, type: "faqs", id: "nope" } };
    expect(rawSectionKeys(raw)).toEqual({ type: "faqs", id: "nope" });
  });
  it("reads a legacy `section` key too", () => {
    const { sectionToMerge, ...rest } = RAW;
    expect(rawSectionKeys({ ...rest, section: sectionToMerge })).toEqual({
      type: "faq",
      id: "faq",
    });
  });
  it("returns undefineds for junk", () => {
    expect(rawSectionKeys(null)).toEqual({ type: undefined, id: undefined });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/fixtures.test.ts`
Expected: FAIL — `normalizeFixture is not a function`.

- [ ] **Step 3: Rewrite `lib/fixtures.ts`**

```ts
// Pure fixture helpers. No fs, no mutation of inputs.
// The canonical format is the one in docs/source/cancerfax-faq-generator/batch-2026-07-20/.
import type { Fixture, FaqSection, FaqGroup, FaqItem, ReviewRecord } from "@/lib/types";

/** Title-case of a collection, which is exactly what the fixture's contentType must be. */
export function titleCaseCollection(c: string): "Guides" | "Insights" | "Treatments" {
  switch (c) {
    case "guides":
      return "Guides";
    case "insights":
      return "Insights";
    case "treatments":
      return "Treatments";
    default:
      throw new Error(`unknown collection: ${c}`);
  }
}

/** The one true route shape. */
export function routeFor(collection: string, slug: string): string {
  return `/${collection}/${slug}`;
}

/**
 * The fixture filename the team's runner expects. Lives here rather than in
 * lib/generate.ts so lib/batch-export.ts can use it without pulling
 * node:child_process into its import graph.
 */
export function fixtureFilename(slug: string): string {
  return `${slug}-faq-section.json`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * The section's `type` and `id` as the FILE stated them. normalizeFixture forces
 * both to "faq", so the validator has to look at the raw input to catch a fixture
 * that named them wrong.
 */
export function rawSectionKeys(raw: unknown): { type: unknown; id: unknown } {
  const r = asRecord(raw);
  const sec = r ? (asRecord(r.sectionToMerge) ?? asRecord(r.section)) : null;
  return { type: sec?.type, id: sec?.id };
}

/**
 * One batch fixture (integrative-oncology-...) uses `question`/`answer` while the
 * other 55 use `q`/`a`. Accept both on read; always emit `q`/`a`.
 */
function normItem(v: unknown): FaqItem | null {
  const r = asRecord(v);
  if (!r) return null;
  const q = r.q ?? r.question;
  const a = r.a ?? r.answer;
  if (typeof q !== "string" || typeof a !== "string") return null;
  return { q, a };
}

function normGroup(v: unknown): FaqGroup | null {
  const r = asRecord(v);
  if (!r || !Array.isArray(r.items)) return null;
  const items = r.items.map(normItem).filter((i): i is FaqItem => i !== null);
  return { title: typeof r.title === "string" ? r.title : "", items };
}

/**
 * Coerce any historical fixture shape into the canonical one:
 * `section` or `sectionToMerge` both become `sectionToMerge`; legacy top-level
 * `schemaRecommendation` / `medicalDisclaimer` are dropped; `intro` is kept only
 * when present. Returns null when there is no usable faq section.
 */
export function normalizeFixture(raw: unknown): Fixture | null {
  const r = asRecord(raw);
  if (!r) return null;
  const secRaw = asRecord(r.sectionToMerge) ?? asRecord(r.section);
  if (!secRaw || !Array.isArray(secRaw.groups)) return null;

  const section: FaqSection = {
    type: "faq",
    id: "faq",
    h2: typeof secRaw.h2 === "string" ? secRaw.h2 : "Frequently Asked Questions",
    groups: secRaw.groups.map(normGroup).filter((g): g is FaqGroup => g !== null),
  };
  if (typeof secRaw.intro === "string" && secRaw.intro !== "") section.intro = secRaw.intro;

  return {
    pillar: typeof r.pillar === "string" ? r.pillar : "",
    contentType: r.contentType as Fixture["contentType"],
    runner: "apply-pillar-faqs.js",
    slug: typeof r.slug === "string" ? r.slug : "",
    route: typeof r.route === "string" ? r.route : "",
    sectionToMerge: section,
  };
}

export function getSection(fx: Fixture): FaqSection {
  return fx.sectionToMerge;
}

/** Total FAQ items across all groups. */
export function faqCount(fx: Fixture): number {
  return (fx.sectionToMerge?.groups ?? []).reduce((n, g) => n + (g.items ?? []).length, 0);
}

/** True when the fixture carries a well-formed faq section. */
export function isFaqShape(fx: Fixture): boolean {
  const s = fx.sectionToMerge;
  return !!(s && s.type === "faq" && Array.isArray(s.groups));
}

/** Guarantee an answer stays wrapped in a single <p>...</p>. */
export function ensureP(html: unknown): string {
  const t = String(html ?? "").trim();
  return /^<p>[\s\S]*<\/p>$/.test(t) ? t : `<p>${t.replace(/^<p>|<\/p>$/g, "")}</p>`;
}

/**
 * Deep-clone the fixture and apply a review record's answer edits, keyed
 * "<groupIndex>.<itemIndex>" and wrapped via ensureP. Never mutates input.
 * Slug and route are no longer editable — they come from the live-site CSV.
 */
export function applyEdits(fx: Fixture, rec: ReviewRecord): Fixture {
  const out: Fixture = JSON.parse(JSON.stringify(fx));
  (out.sectionToMerge.groups ?? []).forEach((g, gi) =>
    (g.items ?? []).forEach((it, ii) => {
      const e = rec.edits.answers[gi + "." + ii];
      if (e != null) it.a = ensureP(e);
    }),
  );
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/fixtures.test.ts`
Expected: PASS — 16 passed.

- [ ] **Step 5: Stage and hand off**

```bash
git add lib/fixtures.ts lib/__tests__/fixtures.test.ts
```

```
Vishwanth | refactor(fixtures): canonical sectionToMerge shape, drop VERIFY helpers
```

---

### Task 6: Fixture validator

**Files:**
- Create: `lib/validate.ts`
- Test: `lib/__tests__/validate.test.ts`

**Interfaces:**
- Consumes: `normalizeFixture`, `faqCount`, `titleCaseCollection`, `routeFor` from Task 5; `readPages`, `pageKey` from Task 2.
- Produces:
  - `interface ValidationIssue { check: string; message: string }`
  - `interface ExpectedPage { collection: string; slug: string; role: PageRole }`
  - `validateFixture(raw: unknown, expected: ExpectedPage): ValidationIssue[]` — empty array means valid.
  - `expectedItemCount(role: PageRole): number` — 20 for `PILLAR PAGE`, else 10.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { validateFixture, expectedItemCount } from "@/lib/validate";
import { readPages, pageKey } from "@/lib/pages";

const BATCH_DIR = resolve(
  process.cwd(),
  "docs/source/cancerfax-faq-generator/batch-2026-07-20",
);

/** A valid support-page fixture: 10 items, one untitled group, CancerFax mentioned once. */
function makeFixture(overrides: Record<string, unknown> = {}) {
  const items = Array.from({ length: 10 }, (_, i) => ({
    q: `Question ${i}?`,
    a: i === 0 ? "<p>CancerFax can help coordinate this.</p>" : `<p>Answer ${i}.</p>`,
  }));
  return {
    pillar: "Some Pillar",
    contentType: "Insights",
    runner: "apply-pillar-faqs.js",
    slug: "a-slug",
    route: "/insights/a-slug",
    sectionToMerge: {
      type: "faq",
      id: "faq",
      h2: "Frequently Asked Questions",
      groups: [{ title: "", items }],
    },
    ...overrides,
  };
}

const EXPECTED = { collection: "insights", slug: "a-slug", role: "" as const };

function checks(raw: unknown, expected = EXPECTED): string[] {
  return validateFixture(raw, expected).map((i) => i.check);
}

describe("expectedItemCount", () => {
  it("is 20 for a pillar page", () => {
    expect(expectedItemCount("PILLAR PAGE")).toBe(20);
  });
  it("is 10 for a support page and for a blank role", () => {
    expect(expectedItemCount("Support Page")).toBe(10);
    expect(expectedItemCount("")).toBe(10);
  });
});

describe("validateFixture", () => {
  it("accepts a well-formed support fixture", () => {
    expect(validateFixture(makeFixture(), EXPECTED)).toEqual([]);
  });

  it("rejects the wrong item count", () => {
    const f = makeFixture();
    (f.sectionToMerge.groups[0].items as unknown[]).pop();
    expect(checks(f)).toContain("item-count");
  });

  it("rejects a support page split across groups", () => {
    const f = makeFixture();
    const items = f.sectionToMerge.groups[0].items;
    f.sectionToMerge.groups = [
      { title: "", items: items.slice(0, 5) },
      { title: "", items: items.slice(5) },
    ];
    expect(checks(f)).toContain("group-shape");
  });

  it("rejects a titled group on a support page", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].title = "Some Heading";
    expect(checks(f)).toContain("group-shape");
  });

  it("accepts a pillar page with 20 items in 5 titled groups", () => {
    const groups = Array.from({ length: 5 }, (_, g) => ({
      title: `Group ${g}`,
      items: Array.from({ length: 4 }, (_, i) => ({
        q: `Q${g}${i}?`,
        a: g === 0 && i === 0 ? "<p>CancerFax can help here.</p>" : `<p>A${g}${i}.</p>`,
      })),
    }));
    const f = makeFixture({ sectionToMerge: { type: "faq", id: "faq", h2: "Frequently Asked Questions", groups } });
    expect(validateFixture(f, { ...EXPECTED, role: "PILLAR PAGE" })).toEqual([]);
  });

  it("rejects an empty question or answer", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[3].q = "";
    expect(checks(f)).toContain("empty-item");
  });

  it("rejects an answer that is not wrapped in <p>", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[3].a = "bare text";
    expect(checks(f)).toContain("answer-html");
  });

  it("rejects a tag other than <p>", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[3].a = "<p>a <strong>b</strong></p>";
    expect(checks(f)).toContain("answer-html");
  });

  it("rejects a stray VERIFY marker", () => {
    expect(checks(makeFixture({ slug: "⚠ VERIFY: a-slug" }))).toContain("no-verify");
  });

  it("rejects a wrong route", () => {
    expect(checks(makeFixture({ route: "/guides/a-slug" }))).toContain("route");
  });

  it("rejects a slug that disagrees with the page", () => {
    expect(checks(makeFixture({ slug: "other", route: "/insights/other" }))).toContain("slug");
  });

  it("rejects a wrong contentType", () => {
    expect(checks(makeFixture({ contentType: "Guides" }))).toContain("content-type");
  });

  it("rejects a wrong runner", () => {
    expect(checks(makeFixture({ runner: "seed-faq.js" }))).toContain("runner");
  });

  it("rejects a wrong section type or id", () => {
    const f = makeFixture();
    f.sectionToMerge.type = "faqs";
    expect(checks(f)).toContain("section-keys");
  });

  it("rejects zero CancerFax mentions", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[0].a = "<p>Answer 0.</p>";
    expect(checks(f)).toContain("cancerfax-mentions");
  });

  it("rejects three or more CancerFax mentions", () => {
    const f = makeFixture();
    for (let i = 0; i < 3; i++) {
      f.sectionToMerge.groups[0].items[i].a = "<p>CancerFax helps.</p>";
    }
    expect(checks(f)).toContain("cancerfax-mentions");
  });

  it("accepts exactly two CancerFax mentions", () => {
    const f = makeFixture();
    f.sectionToMerge.groups[0].items[1].a = "<p>CancerFax can also assist.</p>";
    expect(validateFixture(f, EXPECTED)).toEqual([]);
  });

  it("rejects junk input", () => {
    expect(checks(null)).toContain("shape");
  });
});

describe("golden files: the shipped batch-2026-07-20 fixtures", () => {
  const { pages } = readPages();
  const byKey = new Map(pages.map((p) => [pageKey(p), p]));
  const files = readdirSync(BATCH_DIR).filter((f) => f.endsWith("-faq-section.json"));

  it("covers all 56 files", () => {
    expect(files).toHaveLength(56);
  });

  const results = files.map((file) => {
    const raw = JSON.parse(readFileSync(resolve(BATCH_DIR, file), "utf8"));
    const collection = String(raw.route ?? "").split("/")[1] ?? "";
    const page = byKey.get(`${collection}/${raw.slug}`);
    const issues = page
      ? validateFixture(raw, { collection, slug: page.slug, role: page.role })
      : [{ check: "unknown-page", message: `${collection}/${raw.slug} not in the live CSV` }];
    return { file, issues };
  });

  it("passes 55 of 56", () => {
    expect(results.filter((r) => r.issues.length === 0)).toHaveLength(55);
  });

  // A real defect in the shipped batch. Asserting the failure proves the validator
  // catches the exact class of bug that reached production.
  it("fails questions-patients-should-ask-about-car-t on item count", () => {
    const bad = results.find(
      (r) => r.file === "questions-patients-should-ask-about-car-t-faq-section.json",
    );
    expect(bad?.issues.map((i) => i.check)).toEqual(["item-count"]);
    expect(bad?.issues[0].message).toContain("9");
    expect(bad?.issues[0].message).toContain("10");
  });

  it("names every other failure, so a regression cannot hide", () => {
    const others = results.filter(
      (r) =>
        r.issues.length > 0 &&
        r.file !== "questions-patients-should-ask-about-car-t-faq-section.json",
    );
    expect(others.map((r) => `${r.file}: ${r.issues.map((i) => i.check).join(",")}`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/validate.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/validate"`.

- [ ] **Step 3: Write the implementation**

Create `lib/validate.ts`:

```ts
// The gate every generated fixture passes before it reaches output/faq/raw/.
// Rules come from docs/specs/2026-07-27-live-csv-source-mapping-design.md §5.4,
// which encodes the CancerFax FAQ AEO instructions plus the team's 2026-07-20
// fixed-count direction.
import type { PageRole } from "@/lib/pages";
import {
  normalizeFixture,
  faqCount,
  titleCaseCollection,
  routeFor,
  rawSectionKeys,
} from "@/lib/fixtures";

export interface ValidationIssue {
  /** Stable machine-readable check id, e.g. "item-count". */
  check: string;
  message: string;
}

export interface ExpectedPage {
  collection: string;
  slug: string;
  role: PageRole;
}

/** Fixed counts, not ranges. A blank role is a Support Page. */
export function expectedItemCount(role: PageRole): number {
  return role === "PILLAR PAGE" ? 20 : 10;
}

/** A single <p>...</p> with no other tag inside. */
const P_ONLY = /^<p>(?:(?!<\/?[a-zA-Z])[\s\S])*<\/p>$/;

export function validateFixture(raw: unknown, expected: ExpectedPage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (check: string, message: string) => issues.push({ check, message });

  const fx = normalizeFixture(raw);
  if (!fx) {
    add("shape", "not a fixture object with a faq section");
    return issues;
  }

  const isPillar = expected.role === "PILLAR PAGE";
  const wantCount = expectedItemCount(expected.role);
  const groups = fx.sectionToMerge.groups ?? [];

  // 1. exact item count
  const count = faqCount(fx);
  if (count !== wantCount) {
    add("item-count", `${count} items, expected ${wantCount} (role=${expected.role || "blank"})`);
  }

  // 2. group shape
  if (isPillar) {
    if (groups.length < 4 || groups.length > 5) {
      add("group-shape", `${groups.length} groups, expected 4-5 for a pillar page`);
    } else if (groups.some((g) => g.title.trim() === "")) {
      add("group-shape", "every pillar group needs a title");
    }
  } else if (groups.length !== 1) {
    add("group-shape", `${groups.length} groups, expected exactly 1 for a support page`);
  } else if (groups[0].title !== "") {
    add("group-shape", `support-page group title must be "", got "${groups[0].title}"`);
  }

  // 3 + 4. per-item content and HTML
  let emptyItem = false;
  let badHtml = false;
  for (const g of groups) {
    for (const it of g.items ?? []) {
      if (it.q.trim() === "" || it.a.trim() === "") emptyItem = true;
      if (!P_ONLY.test(it.a.trim())) badHtml = true;
    }
  }
  if (emptyItem) add("empty-item", "an item has an empty question or answer");
  if (badHtml) add("answer-html", "every answer must be a single <p>...</p> with no other tag");

  // 5. no VERIFY marker anywhere
  if (JSON.stringify(fx).includes("⚠")) {
    add("no-verify", "fixture still contains a ⚠ VERIFY placeholder");
  }

  // 6 + 7 + 8 + 9. wrapper fields
  if (fx.slug !== expected.slug) {
    add("slug", `slug "${fx.slug}" does not match the live page "${expected.slug}"`);
  }
  const wantRoute = routeFor(expected.collection, expected.slug);
  if (fx.route !== wantRoute) {
    add("route", `route "${fx.route}", expected "${wantRoute}"`);
  }
  let wantType: string;
  try {
    wantType = titleCaseCollection(expected.collection);
  } catch {
    wantType = "";
    add("content-type", `unknown collection "${expected.collection}"`);
  }
  if (wantType && fx.contentType !== wantType) {
    add("content-type", `contentType "${fx.contentType}", expected "${wantType}"`);
  }
  if (fx.runner !== "apply-pillar-faqs.js") {
    add("runner", `runner "${fx.runner}", expected "apply-pillar-faqs.js"`);
  }
  // Read the RAW keys: normalizeFixture coerces both to "faq", so checking the
  // normalized fixture here would make this assertion unfalsifiable.
  const keys = rawSectionKeys(raw);
  if (keys.type !== "faq" || keys.id !== "faq") {
    add(
      "section-keys",
      `sectionToMerge.type and .id must both be "faq", got "${String(keys.type)}" / "${String(keys.id)}"`,
    );
  }

  // 10. CancerFax mention discipline: 0 reads impersonal, 3+ reads promotional.
  const mentions = groups
    .flatMap((g) => g.items ?? [])
    .filter((it) => it.a.includes("CancerFax")).length;
  if (mentions < 1 || mentions > 2) {
    add("cancerfax-mentions", `CancerFax mentioned in ${mentions} answers, expected 1-2`);
  }

  return issues;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/validate.test.ts`
Expected: PASS — 24 passed.

The `buildFixture` output in Task 9 sets `type` and `id` to `"faq"` literally, so
generated fixtures satisfy `section-keys` on their raw form. All 56 golden files
set them too.

- [ ] **Step 5: Stage and hand off**

```bash
git add lib/validate.ts lib/__tests__/validate.test.ts
```

```
Vishwanth | feat(validate): gate fixtures on the batch-2026-07-20 format rules
```

---

### Task 7: Corpus reconciliation

**Files:**
- Create: `lib/reconcile.ts`
- Create: `scripts/reconcile-corpus.mjs`
- Test: `lib/__tests__/reconcile.test.ts`

**Interfaces:**
- Consumes: `LedgerStatus` from Task 3.
- Produces:
  - `interface ReconcilePlan { keep: string[]; flagged: string[]; archive: string[]; unknown: string[] }`
  - `planReconcile(doneFiles: string[], ledger: Map<string, LedgerStatus>): ReconcilePlan`

`keep` = `live`, `flagged` = `drifted`, `archive` = `no-page`, `unknown` = every
file the ledger does not mention (including `other`). Unknown files are never
deleted.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/reconcile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planReconcile } from "@/lib/reconcile";
import { readLedger } from "@/lib/ledger";
import type { LedgerStatus } from "@/lib/ledger";

function ledger(entries: [string, LedgerStatus][]): Map<string, LedgerStatus> {
  return new Map(entries);
}

describe("planReconcile", () => {
  it("routes each verdict to its bucket", () => {
    const plan = planReconcile(
      ["a.json", "b.json", "c.json"],
      ledger([
        ["a.json", "live"],
        ["b.json", "no-page"],
        ["c.json", "drifted"],
      ]),
    );
    expect(plan.keep).toEqual(["a.json"]);
    expect(plan.archive).toEqual(["b.json"]);
    expect(plan.flagged).toEqual(["c.json"]);
    expect(plan.unknown).toEqual([]);
  });

  it("treats a file the ledger never mentions as unknown, never archived", () => {
    const plan = planReconcile(["mystery.json"], ledger([]));
    expect(plan.unknown).toEqual(["mystery.json"]);
    expect(plan.archive).toEqual([]);
  });

  it("treats an audit-row verdict as unknown", () => {
    const plan = planReconcile(["a.json"], ledger([["a.json", "other"]]));
    expect(plan.unknown).toEqual(["a.json"]);
    expect(plan.archive).toEqual([]);
  });

  it("ignores ledger entries with no file on disk", () => {
    const plan = planReconcile([], ledger([["gone.json", "no-page"]]));
    expect(plan).toEqual({ keep: [], flagged: [], archive: [], unknown: [] });
  });

  it("is a no-op on a second run, once archived files are gone", () => {
    const l = ledger([
      ["a.json", "live"],
      ["b.json", "no-page"],
    ]);
    const first = planReconcile(["a.json", "b.json"], l);
    const second = planReconcile(
      ["a.json", "b.json"].filter((f) => !first.archive.includes(f)),
      l,
    );
    expect(second.archive).toEqual([]);
    expect(second.keep).toEqual(["a.json"]);
  });

  it("sorts each bucket so output is stable", () => {
    const plan = planReconcile(
      ["c.json", "a.json", "b.json"],
      ledger([
        ["a.json", "live"],
        ["b.json", "live"],
        ["c.json", "live"],
      ]),
    );
    expect(plan.keep).toEqual(["a.json", "b.json", "c.json"]);
  });
});

describe("planReconcile against the real ledger and corpus", () => {
  it("splits the 619-fixture corpus 286 / 324 / 9", () => {
    const files = readLedger().keys();
    const plan = planReconcile([...files], readLedger());
    expect(plan.keep).toHaveLength(286);
    expect(plan.archive).toHaveLength(324);
    expect(plan.flagged).toHaveLength(9);
    expect(plan.unknown).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/reconcile.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/reconcile"`.

- [ ] **Step 3: Write `lib/reconcile.ts`**

```ts
// Pure planner for the one-shot corpus migration. The team's ledger is ground
// truth: 286 of this app's 619 fixtures were applied live, 324 targeted pages
// that never existed, 9 have since drifted.
import type { LedgerStatus } from "@/lib/ledger";

export interface ReconcilePlan {
  /** Applied live — stays in output/faq/done/. */
  keep: string[];
  /** Applied once but the slug has drifted — stays, tracker flags it. */
  flagged: string[];
  /** Target page never existed — archived and removed. */
  archive: string[];
  /** Not a fixture verdict, or absent from the ledger — left untouched. */
  unknown: string[];
}

/**
 * Bucket the fixture files currently in done/ by their ledger verdict.
 * A file the ledger does not classify is NEVER archived — an unexpected file
 * on disk must not be deleted by a migration script.
 */
export function planReconcile(
  doneFiles: string[],
  ledger: Map<string, LedgerStatus>,
): ReconcilePlan {
  const plan: ReconcilePlan = { keep: [], flagged: [], archive: [], unknown: [] };
  for (const file of doneFiles) {
    switch (ledger.get(file)) {
      case "live":
        plan.keep.push(file);
        break;
      case "drifted":
        plan.flagged.push(file);
        break;
      case "no-page":
        plan.archive.push(file);
        break;
      default:
        plan.unknown.push(file);
    }
  }
  for (const bucket of Object.values(plan)) bucket.sort();
  return plan;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/reconcile.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 5: Write the migration script**

Create `scripts/reconcile-corpus.mjs`:

```js
#!/usr/bin/env node
// One-shot corpus migration. Splits output/faq/done/ using the team's ledger:
//   live    (286) stay
//   drifted (9)   stay, tracker flagged
//   no-page (324) move to output/faq/archive-<date>/, then zip and remove the folder
//
// Idempotent: a second run finds nothing to archive and exits 0 with a no-op summary.
// Run with:  node scripts/reconcile-corpus.mjs [--date=YYYY-MM-DD] [--force] [--dry-run]

import { readdirSync, existsSync, mkdirSync, renameSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const DONE_DIR = resolve(ROOT, "output/faq/done");
const OUT_DIR = resolve(ROOT, "output/faq");
const TRACKER = resolve(OUT_DIR, "tracker.json");
const LEDGER_CSV = resolve(ROOT, "docs/source/cancerfax-faq-generator/master-faq-reconciliation.csv");
const APP_BATCH_FOLDER = "150 pillar pages";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const has = (name) => args.includes(`--${name}`);
const DATE = flag("date") ?? new Date().toISOString().slice(0, 10);
const DRY = has("dry-run");
const FORCE = has("force");

// --- inlined CSV + ledger logic (this script must run without a TS build step) ---

function toGrid(text) {
  const grid = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); grid.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); grid.push(row); }
  return grid;
}

function readLedger() {
  const grid = toGrid(readFileSync(LEDGER_CSV, "utf8")).filter((r) => r.some((c) => c.trim() !== ""));
  const header = grid[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iFolder = idx("source_folder"), iFile = idx("file"), iStatus = idx("status");
  const map = new Map();
  for (const cells of grid.slice(1)) {
    const folder = (cells[iFolder] ?? "").trim();
    const file = (cells[iFile] ?? "").trim();
    const status = (cells[iStatus] ?? "").trim();
    if (file === "" || folder !== APP_BATCH_FOLDER) continue;
    map.set(
      file,
      status.startsWith("DONE") ? "live"
        : status.startsWith("UNDONE") ? "no-page"
        : status.startsWith("RAN BUT NOW MISSING") ? "drifted"
        : "other",
    );
  }
  return map;
}

function planReconcile(doneFiles, ledger) {
  const plan = { keep: [], flagged: [], archive: [], unknown: [] };
  for (const file of doneFiles) {
    const v = ledger.get(file);
    if (v === "live") plan.keep.push(file);
    else if (v === "drifted") plan.flagged.push(file);
    else if (v === "no-page") plan.archive.push(file);
    else plan.unknown.push(file);
  }
  for (const b of Object.values(plan)) b.sort();
  return plan;
}

// --- run ---

if (!existsSync(DONE_DIR)) {
  console.error(`no such directory: ${DONE_DIR}`);
  process.exit(1);
}

const before = readdirSync(DONE_DIR).filter((f) => f.endsWith("-faq-section.json"));
const ledger = readLedger();
const plan = planReconcile(before, ledger);

console.log(`done/ before        : ${before.length}`);
console.log(`  live      (keep)  : ${plan.keep.length}`);
console.log(`  drifted   (flag)  : ${plan.flagged.length}`);
console.log(`  no-page   (archive): ${plan.archive.length}`);
console.log(`  unknown   (leave) : ${plan.unknown.length}`);

if (plan.archive.length === 0) {
  console.log("\nnothing to archive — already reconciled. No changes made.");
  process.exit(0);
}

const stageDir = join(OUT_DIR, `archive-${DATE}`);
const zipPath = join(OUT_DIR, `archive-${DATE}.zip`);

if (existsSync(zipPath) && !FORCE) {
  console.error(
    `\n${zipPath} already exists.\n` +
      `Re-run with --date=<other-date> to write a new archive, or --force to overwrite.`,
  );
  process.exit(1);
}

if (DRY) {
  console.log(`\n--dry-run: would archive ${plan.archive.length} files to ${zipPath}`);
  for (const f of plan.archive) console.log(`  ${f}`);
  process.exit(0);
}

mkdirSync(stageDir, { recursive: true });
for (const f of plan.archive) renameSync(join(DONE_DIR, f), join(stageDir, f));
console.log(`\nmoved ${plan.archive.length} files -> ${stageDir}`);
for (const f of plan.archive) console.log(`  ${f}`);

let zipped = false;
try {
  execFileSync("zip", ["-rq", zipPath, `archive-${DATE}`], { cwd: OUT_DIR });
  rmSync(stageDir, { recursive: true, force: true });
  zipped = true;
  console.log(`\nzipped -> ${zipPath}`);
} catch (e) {
  console.warn(
    `\ncould not run \`zip\` (${e.message}).\n` +
      `The files are safe in ${stageDir}. Zip that folder manually, or leave it as-is.`,
  );
}

// Stamp every fixture's ledger verdict into the tracker; keep all review history.
let tracker = {};
try {
  tracker = JSON.parse(readFileSync(TRACKER, "utf8"));
} catch {
  tracker = {};
}
let stamped = 0;
for (const [file, status] of ledger) {
  const slug = file.replace(/-faq-section\.json$/, "");
  if (!tracker[slug]) continue;
  tracker[slug].ledgerStatus = status;
  stamped++;
}
writeFileSync(TRACKER, JSON.stringify(tracker, null, 2) + "\n");
console.log(`stamped ledgerStatus on ${stamped} tracker records`);

const after = readdirSync(DONE_DIR).filter((f) => f.endsWith("-faq-section.json"));
console.log(`\ndone/ after         : ${after.length}`);
console.log(zipped ? "reconciliation complete." : "reconciliation complete (archive left unzipped).");
```

- [ ] **Step 6: Dry-run the script and check the numbers**

Run: `node scripts/reconcile-corpus.mjs --dry-run`
Expected output starts with:

```
done/ before        : 619
  live      (keep)  : 286
  drifted   (flag)  : 9
  no-page   (archive): 324
  unknown   (leave) : 0
```

followed by `--dry-run: would archive 324 files to …/output/faq/archive-<today>.zip`.

If any number differs, **stop** — the ledger or the corpus has changed since this
plan was written. Report the actual numbers before touching any file.

- [ ] **Step 7: Run the migration for real**

Run: `node scripts/reconcile-corpus.mjs --date=2026-07-27`
Expected: `done/ after : 295` (286 kept + 9 flagged) and
`output/faq/archive-2026-07-27.zip` created.

- [ ] **Step 8: Verify idempotency**

Run: `node scripts/reconcile-corpus.mjs --date=2026-07-27`
Expected: `nothing to archive — already reconciled. No changes made.` and exit 0.

- [ ] **Step 9: Stage and hand off**

`output/faq/tracker.json` is gitignored, so it is not staged.

```bash
git add lib/reconcile.ts lib/__tests__/reconcile.test.ts scripts/reconcile-corpus.mjs
git add -A output/faq/done output/faq/archive-2026-07-27.zip
```

```
Vishwanth | chore(corpus): archive 324 fixtures with no live page, keep 295
```

---

### Task 8: Row-view derivation and stats

**Files:**
- Modify: `lib/state.ts` (full rewrite)
- Test: `lib/__tests__/state.test.ts` (replace existing contents)

**Interfaces:**
- Consumes: `Row`, `RowView`, `Fixture`, `ReviewRecord`, `OverviewStats` from Task 4; `faqCount` from Task 5; `pageKey` from Task 2.
- Produces:
  - `deriveRowViews(rows: Row[], rawByKey: Map<string, Fixture>, doneByKey: Map<string, Fixture>, tracker: Record<string, ReviewRecord>, invalidKeys?: Set<string>): RowView[]`
  - `throughputByDay(tracker, days?, now?): ThroughputPoint[]` — unchanged behaviour
  - `overviewStats(views: RowView[]): OverviewStats`

Every map and the tracker are keyed by `pageKey(row)`, i.e. `"collection/slug"`.

- [ ] **Step 1: Write the failing test**

Replace `lib/__tests__/state.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { deriveRowViews, overviewStats, throughputByDay } from "@/lib/state";
import type { Row, Fixture, ReviewRecord } from "@/lib/types";

function row(collection: Row["collection"], slug: string, extra: Partial<Row> = {}): Row {
  return {
    collection,
    slug,
    title: slug,
    faqDone: false,
    role: "",
    pillarAssociation: "",
    ...extra,
  };
}

function fixture(collection: string, slug: string, items = 1): Fixture {
  return {
    pillar: slug,
    contentType: "Insights",
    runner: "apply-pillar-faqs.js",
    slug,
    route: `/${collection}/${slug}`,
    sectionToMerge: {
      type: "faq",
      id: "faq",
      h2: "Frequently Asked Questions",
      groups: [
        {
          title: "",
          items: Array.from({ length: items }, (_, i) => ({ q: `q${i}`, a: `<p>a${i}</p>` })),
        },
      ],
    },
  };
}

const rec = (patch: Partial<ReviewRecord> = {}): ReviewRecord => ({
  reviewStatus: "pending",
  note: "",
  edits: { answers: {} },
  ...patch,
});

describe("deriveRowViews", () => {
  const rows = [row("insights", "a"), row("guides", "b"), row("treatments", "c")];

  it("marks a row done when a done fixture exists for its key", () => {
    const views = deriveRowViews(rows, new Map(), new Map([["insights/a", fixture("insights", "a")]]), {});
    expect(views[0].contentState).toBe("done");
  });

  it("marks a row raw when only a raw fixture exists", () => {
    const views = deriveRowViews(rows, new Map([["guides/b", fixture("guides", "b")]]), new Map(), {});
    expect(views[1].contentState).toBe("raw");
  });

  it("marks a row not-generated with no fixture", () => {
    const views = deriveRowViews(rows, new Map(), new Map(), {});
    expect(views[2].contentState).toBe("not-generated");
  });

  it("prefers done over raw for the same key", () => {
    const views = deriveRowViews(
      rows,
      new Map([["insights/a", fixture("insights", "a", 3)]]),
      new Map([["insights/a", fixture("insights", "a", 7)]]),
      {},
    );
    expect(views[0].contentState).toBe("done");
    expect(views[0].faqCount).toBe(7);
  });

  it("does not confuse the same slug in two collections", () => {
    const dup = [row("insights", "same"), row("guides", "same")];
    const views = deriveRowViews(dup, new Map(), new Map([["guides/same", fixture("guides", "same")]]), {});
    expect(views[0].contentState).toBe("not-generated");
    expect(views[1].contentState).toBe("done");
  });

  it("reads reviewStatus from the tracker by collection/slug key", () => {
    const views = deriveRowViews(rows, new Map(), new Map(), {
      "insights/a": rec({ reviewStatus: "approved" }),
    });
    expect(views[0].reviewStatus).toBe("approved");
    expect(views[1].reviewStatus).toBe("pending");
  });

  it("reports faqCount as null with no fixture", () => {
    expect(deriveRowViews(rows, new Map(), new Map(), {})[0].faqCount).toBeNull();
  });

  it("flags an unparseable fixture", () => {
    const views = deriveRowViews(rows, new Map(), new Map(), {}, new Set(["insights/a"]));
    expect(views[0].invalid).toBe(true);
    expect(views[1].invalid).toBe(false);
  });

  it("carries every row field through", () => {
    const r = row("guides", "x", { title: "T", faqDone: true, role: "PILLAR PAGE", pillarAssociation: "P" });
    const v = deriveRowViews([r], new Map(), new Map(), {})[0];
    expect(v).toMatchObject({ title: "T", faqDone: true, role: "PILLAR PAGE", pillarAssociation: "P" });
  });
});

describe("overviewStats", () => {
  it("counts generated rows per collection", () => {
    const views = deriveRowViews(
      [row("insights", "a"), row("insights", "b"), row("guides", "c"), row("treatments", "d")],
      new Map([["insights/b", fixture("insights", "b")]]),
      new Map([
        ["insights/a", fixture("insights", "a")],
        ["guides/c", fixture("guides", "c")],
      ]),
      {},
    );
    const stats = overviewStats(views);
    expect(stats.total).toBe(4);
    expect(stats.generated).toBe(3);
    expect(stats.perCollection).toEqual({ insights: 2, guides: 1 });
  });

  it("tallies review statuses", () => {
    const views = deriveRowViews([row("insights", "a"), row("insights", "b"), row("insights", "c")], new Map(), new Map(), {
      "insights/a": rec({ reviewStatus: "approved" }),
      "insights/b": rec({ reviewStatus: "needs-work" }),
    });
    const stats = overviewStats(views);
    expect(stats.approved).toBe(1);
    expect(stats.needsWork).toBe(1);
    expect(stats.pending).toBe(1);
  });

  it("has no withVerify field", () => {
    const stats = overviewStats([]) as unknown as Record<string, unknown>;
    expect("withVerify" in stats).toBe(false);
    expect("perPillar" in stats).toBe(false);
  });
});

describe("throughputByDay", () => {
  it("buckets generatedAt into UTC days, oldest first", () => {
    const now = new Date("2026-07-27T10:00:00Z");
    const pts = throughputByDay(
      {
        "insights/a": rec({ generatedAt: "2026-07-27T01:00:00Z" }),
        "insights/b": rec({ generatedAt: "2026-07-27T02:00:00Z" }),
        "insights/c": rec({ generatedAt: "2026-07-26T02:00:00Z" }),
        "insights/d": rec({ generatedAt: "2020-01-01T00:00:00Z" }),
      },
      7,
      now,
    );
    expect(pts).toHaveLength(7);
    expect(pts[6]).toEqual({ date: "2026-07-27", count: 2 });
    expect(pts[5]).toEqual({ date: "2026-07-26", count: 1 });
    expect(pts.reduce((n, p) => n + p.count, 0)).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/state.test.ts`
Expected: FAIL — type errors on the new `Row` shape and `perCollection` missing.

- [ ] **Step 3: Rewrite `lib/state.ts`**

```ts
import type {
  Row,
  RowView,
  Fixture,
  ReviewRecord,
  OverviewStats,
  ThroughputPoint,
} from "@/lib/types";
import { faqCount } from "@/lib/fixtures";
import { pageKey } from "@/lib/pages";

type Tracker = Record<string, ReviewRecord>;

/**
 * Join rows with their generated fixtures and tracker records into RowViews.
 * Every map and the tracker are keyed "collection/slug" — the same slug can exist
 * in two collections, so a slug-only key would collide.
 */
export function deriveRowViews(
  rows: Row[],
  rawByKey: Map<string, Fixture>,
  doneByKey: Map<string, Fixture>,
  tracker: Tracker,
  invalidKeys: Set<string> = new Set(),
): RowView[] {
  return rows.map((row) => {
    const key = pageKey(row);
    const done = doneByKey.get(key);
    const raw = rawByKey.get(key);
    const fixture = done ?? raw ?? null;

    return {
      ...row,
      contentState: done ? "done" : raw ? "raw" : "not-generated",
      reviewStatus: tracker[key]?.reviewStatus ?? "pending",
      faqCount: fixture ? faqCount(fixture) : null,
      invalid: invalidKeys.has(key),
    };
  });
}

/**
 * Bucket the tracker's `generatedAt` timestamps into per-day counts for the last
 * `days` days (oldest → newest), keyed by UTC calendar date (YYYY-MM-DD).
 */
export function throughputByDay(
  tracker: Tracker,
  days = 7,
  now: Date = new Date(),
): ThroughputPoint[] {
  const buckets: ThroughputPoint[] = [];
  const indexByDate = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    indexByDate.set(date, buckets.length);
    buckets.push({ date, count: 0 });
  }
  for (const rec of Object.values(tracker)) {
    if (!rec.generatedAt) continue;
    const idx = indexByDate.get(rec.generatedAt.slice(0, 10));
    if (idx != null) buckets[idx].count++;
  }
  return buckets;
}

/**
 * Aggregate counts for the command-center overview. Grouping is by `collection`,
 * not pillar: 448 of the 449 pending pages have a blank pillar_association, so a
 * per-pillar breakdown of the backlog would read all zeroes.
 */
export function overviewStats(views: RowView[]): OverviewStats {
  const stats: OverviewStats = {
    total: views.length,
    generated: 0,
    approved: 0,
    needsWork: 0,
    pending: 0,
    perCollection: {},
    throughput: [],
  };
  for (const v of views) {
    if (v.contentState !== "not-generated") {
      stats.generated++;
      stats.perCollection[v.collection] = (stats.perCollection[v.collection] ?? 0) + 1;
    }
    if (v.reviewStatus === "approved") stats.approved++;
    else if (v.reviewStatus === "needs-work") stats.needsWork++;
    else stats.pending++;
  }
  return stats;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/state.test.ts`
Expected: PASS — 14 passed.

- [ ] **Step 5: Stage and hand off**

```bash
git add lib/state.ts lib/__tests__/state.test.ts
```

```
Vishwanth | refactor(state): key row views by collection/slug, group stats by collection
```

---

### Task 9: Generation

**Files:**
- Modify: `lib/generate.ts` (full rewrite)
- Rewrite: `docs/prompts/faq-generation-prompt.md`
- Test: `lib/__tests__/generate.test.ts` (replace existing contents)

**Interfaces:**
- Consumes: `Row` from Task 4; `titleCaseCollection`, `routeFor` from Task 5; `validateFixture`, `expectedItemCount` from Task 6.
- Produces:
  - `interface PageTargets { count: number; groups: number; grouped: boolean }`
  - `pageTargets(role: PageRole): PageTargets`
  - `buildPrompt(row: Row, promptPath?: string): string`
  - `buildFixture(row: Row, section: FaqSection): Fixture`
  - `parseSectionFromOutput(text: string): FaqSection`
  - `runGenerate(row: Row, opts?: GenerateOpts): Promise<GenerateResult>`
  - Re-exports `AUTH_RE`, `RATE_RE`, `classifyGenError` from `@/lib/gen-errors` (unchanged)

`fixtureFilename` is **not** defined here — it lives in `lib/fixtures.ts` (Task 5)
and is imported.

`normalizeContentType`, `CONTENT_TYPE_MAP`, `wrapSection`, `MEDICAL_DISCLAIMER`,
and `faqSchemaRec` are deleted — the collection now comes from the CSV and the
disclaimer/schema fields are not part of the canonical format.

- [ ] **Step 1: Write the failing test**

Replace `lib/__tests__/generate.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  pageTargets,
  buildPrompt,
  buildFixture,
  parseSectionFromOutput,
} from "@/lib/generate";
import { validateFixture } from "@/lib/validate";
import type { Row, FaqSection } from "@/lib/types";

const PROMPT = resolve(process.cwd(), "docs/prompts/faq-generation-prompt.md");

function row(extra: Partial<Row> = {}): Row {
  return {
    collection: "treatments",
    slug: "carbon-ion-therapy",
    title: "Carbon Ion Therapy",
    faqDone: false,
    role: "",
    pillarAssociation: "Proton therapy",
    ...extra,
  };
}

function section(items: number, groups = 1): FaqSection {
  const per = items / groups;
  return {
    type: "faq",
    id: "faq",
    h2: "Frequently Asked Questions",
    groups: Array.from({ length: groups }, (_, g) => ({
      title: groups === 1 ? "" : `Group ${g}`,
      items: Array.from({ length: per }, (_, i) => ({
        q: `Q${g}${i}?`,
        a: g === 0 && i === 0 ? "<p>CancerFax can help coordinate this.</p>" : `<p>A${g}${i}.</p>`,
      })),
    })),
  };
}

describe("pageTargets", () => {
  it("is 20 items in 5 titled groups for a pillar page", () => {
    expect(pageTargets("PILLAR PAGE")).toEqual({ count: 20, groups: 5, grouped: true });
  });
  it("is 10 items in one flat group for a support page", () => {
    expect(pageTargets("Support Page")).toEqual({ count: 10, groups: 1, grouped: false });
  });
  it("treats a blank role as a support page", () => {
    expect(pageTargets("")).toEqual({ count: 10, groups: 1, grouped: false });
  });
});

describe("buildFixture", () => {
  it("builds the canonical wrapper with no VERIFY anywhere", () => {
    const fx = buildFixture(row(), section(10));
    expect(fx).toMatchObject({
      pillar: "Proton therapy",
      contentType: "Treatments",
      runner: "apply-pillar-faqs.js",
      slug: "carbon-ion-therapy",
      route: "/treatments/carbon-ion-therapy",
    });
    expect(JSON.stringify(fx)).not.toContain("⚠");
  });

  it("falls back to the title when pillar_association is blank", () => {
    const fx = buildFixture(row({ pillarAssociation: "" }), section(10));
    expect(fx.pillar).toBe("Carbon Ion Therapy");
  });

  it("omits legacy fields", () => {
    const fx = buildFixture(row(), section(10)) as unknown as Record<string, unknown>;
    expect(fx.schemaRecommendation).toBeUndefined();
    expect(fx.medicalDisclaimer).toBeUndefined();
    expect(fx.section).toBeUndefined();
  });

  it("produces a fixture the validator accepts", () => {
    const r = row();
    expect(validateFixture(buildFixture(r, section(10)), r)).toEqual([]);
  });

  it("produces a valid pillar fixture too", () => {
    const r = row({ role: "PILLAR PAGE" });
    expect(validateFixture(buildFixture(r, section(20, 5)), r)).toEqual([]);
  });
});

describe("buildPrompt", () => {
  it("states the exact count and flat shape for a support page", () => {
    const p = buildPrompt(row(), PROMPT);
    expect(p).toContain("exactly 10");
    expect(p).toContain('"title": ""');
    expect(p).toContain("Carbon Ion Therapy");
    expect(p).toContain("/treatments/carbon-ion-therapy");
  });

  it("states the grouped shape for a pillar page", () => {
    const p = buildPrompt(row({ role: "PILLAR PAGE" }), PROMPT);
    expect(p).toContain("exactly 20");
    expect(p).toContain("4-5 themed groups");
  });

  it("carries the CancerFax mention rule", () => {
    expect(buildPrompt(row(), PROMPT)).toContain("exactly 1 or 2");
  });

  it("never leaks a VERIFY placeholder into the prompt", () => {
    expect(buildPrompt(row(), PROMPT)).not.toContain("⚠");
  });
});

describe("parseSectionFromOutput", () => {
  it("extracts JSON from a fenced, prefaced reply", () => {
    const s = parseSectionFromOutput(
      'Sure!\n```json\n{"type":"faq","id":"faq","h2":"H","groups":[]}\n```\nDone.',
    );
    expect(s.type).toBe("faq");
  });

  it("throws when there is no object", () => {
    expect(() => parseSectionFromOutput("no json here")).toThrow(/no JSON object/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/generate.test.ts`
Expected: FAIL — `buildFixture is not a function`.

- [ ] **Step 3: Rewrite the prompt file**

Replace `docs/prompts/faq-generation-prompt.md` with:

```markdown
# CancerFax FAQ Generation Prompt

Authoritative rulebook:
`docs/source/cancerfax-faq-generator/cancerfax-faq-generator/references/FAQ-AEO-INSTRUCTIONS.md`.
Where this file and that file disagree, that file wins — except on FAQ counts,
where the team's 2026-07-20 fixed-count direction (below) supersedes its ranges.

You are writing the FAQ section for a page that is **already published** on
cancerfax.com. You are not creating a page. You are not editing any other part of
the page. Only the FAQ section.

## Audience

Cancer patients and their families, most of them researching treatment abroad
(India and China in particular). They are frightened, time-pressed, and often
reading on a phone. Write for a smart reader with no medical training.

## Answer construction

Each answer is one HTML paragraph:

1. **Open with the direct, quotable answer.** The first sentence must stand alone
   as a featured snippet. No throat-clearing, no restating the question.
2. **Then the supporting context** — what it depends on, what the numbers are,
   who it applies to.
3. **Close with a hedge** when the answer touches eligibility, cost, clinical
   trial access, or international access.

Target 65–75 words per answer.

## Question phrasing

Write questions the way patients actually type and speak them, not the way a
brochure would. Prefer "Is carbon ion therapy better than proton therapy for my
cancer?" over "Comparative efficacy of particle therapies".

## Mandatory hedges

Never guarantee outcomes, cures, enrolment, or approval. Use "may", "can",
"often", "in many cases", "depends on". Eligibility, cost, trial, and access
claims always carry a hedge.

## CancerFax mentions

Mention CancerFax in **exactly 1 or 2 answers**, never zero and never three or
more. Zero reads impersonal; three or more reads promotional and undermines the
clinical seriousness the site requires. Use non-promotional phrasing that defers
to the treating oncology team.

## HTML

Every answer is wrapped in a single `<p>...</p>`. No lists, no headings, no bold,
no links, no markdown. `<p>` is the only tag that may appear.

## Never output

- The `⚠` character.
- A schema recommendation or medical disclaimer field.
- Any key other than the ones the output shape specifies.
```

- [ ] **Step 4: Rewrite `lib/generate.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Row, Fixture, FaqSection } from "@/lib/types";
import type { PageRole } from "@/lib/pages";
import { titleCaseCollection, routeFor, fixtureFilename } from "@/lib/fixtures";
import { validateFixture } from "@/lib/validate";

const execFileP = promisify(execFile);

const PROMPT_PATH = "docs/prompts/faq-generation-prompt.md";
const RAW_DIR = "output/faq/raw";

export interface PageTargets {
  count: number;
  groups: number;
  /** True when the section is split into titled groups (pillar pages only). */
  grouped: boolean;
}

/**
 * Fixed counts, not ranges — the team's 2026-07-20 direction supersedes the
 * ranges in FAQ-AEO-INSTRUCTIONS.md §2. A blank role is a Support Page.
 */
export function pageTargets(role: PageRole): PageTargets {
  return role === "PILLAR PAGE"
    ? { count: 20, groups: 5, grouped: true }
    : { count: 10, groups: 1, grouped: false };
}

function shapeBlock(t: PageTargets): string {
  return t.grouped
    ? `{
  "type": "faq",
  "id": "faq",
  "h2": "Frequently Asked Questions",
  "groups": [
    { "title": "<themed group heading>",
      "items": [ { "q": "<question>", "a": "<p>...single paragraph...</p>" } ] }
  ]
}

Hard rules for this fixture:
- Produce exactly 20 FAQ items in total.
- Split them across 4-5 themed groups of 4-5 items each. Every group has a
  non-empty "title".`
    : `{
  "type": "faq",
  "id": "faq",
  "h2": "Frequently Asked Questions",
  "groups": [
    { "title": "",
      "items": [ { "q": "<question>", "a": "<p>...single paragraph...</p>" } ] }
  ]
}

Hard rules for this fixture:
- Produce exactly 10 FAQ items in total.
- Use exactly ONE group, and its "title" must be the empty string "".`;
}

/** Build the single-shot prompt for `claude -p`. */
export function buildPrompt(row: Row, promptPath?: string): string {
  const master = readFileSync(promptPath ?? resolve(process.cwd(), PROMPT_PATH), "utf8");
  const t = pageTargets(row.role);
  return (
    master +
    `
=====================================================================
OUTPUT FORMAT (this run)
=====================================================================
Return ONLY the FAQ section as a JSON object matching this exact shape:

${shapeBlock(t)}
- Item keys are exactly "q" and "a". Group heading key is exactly "title".
- Each "a" is a SINGLE HTML paragraph wrapped in <p>...</p>. No other tag,
  no markdown, no lists.
- Mention CancerFax in exactly 1 or 2 answers.
- Never emit the ⚠ character, a schemaRecommendation, or a medicalDisclaimer.

=====================================================================
PAGE
=====================================================================
TITLE:      ${row.title}
COLLECTION: ${row.collection}
ROUTE:      ${routeFor(row.collection, row.slug)}
ROLE:       ${row.role || "Support Page (role blank in source)"}
PILLAR:     ${row.pillarAssociation || "n/a"}

Generate the FAQ section now as the JSON object described above.
Return ONLY the section JSON object, with no preamble and no code fences.
`
  );
}

/**
 * Wrap a generated section into the canonical fixture. Every wrapper field is
 * derived from the live-site CSV, so none of them can be a VERIFY placeholder.
 */
export function buildFixture(row: Row, section: FaqSection): Fixture {
  return {
    pillar: row.pillarAssociation || row.title,
    contentType: titleCaseCollection(row.collection),
    runner: "apply-pillar-faqs.js",
    slug: row.slug,
    route: routeFor(row.collection, row.slug),
    sectionToMerge: {
      type: "faq",
      id: "faq",
      h2: section.h2 || "Frequently Asked Questions",
      ...(section.intro ? { intro: section.intro } : {}),
      groups: section.groups ?? [],
    },
  };
}

/** Extract the outermost {...} JSON object from model output (strips preamble/fences). */
export function parseSectionFromOutput(text: string): FaqSection {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON object found in output");
  }
  return JSON.parse(text.slice(start, end + 1)) as FaqSection;
}

export interface GenerateOpts {
  timeout?: number;
  maxBuffer?: number;
  outDir?: string;
}

export type GenerateResult =
  | { ok: true; fixturePath: string }
  | { ok: false; error: string };

// Re-exported for server-side callers; the definitions live in the client-safe
// lib/gen-errors.ts (no Node imports) so client components can use them too.
export { AUTH_RE, RATE_RE, classifyGenError } from "@/lib/gen-errors";

/** Spawn `claude -p <prompt>`, parse + wrap + validate + write the raw fixture. */
export async function runGenerate(row: Row, opts: GenerateOpts = {}): Promise<GenerateResult> {
  const prompt = buildPrompt(row);
  let stdout: string;
  try {
    const res = await execFileP("claude", ["-p", prompt], {
      timeout: opts.timeout ?? 300_000,
      maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return { ok: false, error: err.stderr || err.message || "claude spawn failed" };
  }

  let fixture: Fixture;
  try {
    fixture = buildFixture(row, parseSectionFromOutput(stdout));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // The gate: a fixture that fails any check never reaches raw/.
  const issues = validateFixture(fixture, row);
  if (issues.length > 0) {
    return { ok: false, error: issues.map((i) => `${i.check}: ${i.message}`).join("; ") };
  }

  const dir = opts.outDir ?? resolve(process.cwd(), RAW_DIR);
  mkdirSync(dir, { recursive: true });
  const fixturePath = join(dir, fixtureFilename(row.slug));
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
  return { ok: true, fixturePath };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/generate.test.ts`
Expected: PASS — 15 passed.

- [ ] **Step 6: Delete `lib/slug.ts` if nothing imports it**

Run: `grep -rn "lib/slug" --include=*.ts --include=*.tsx app lib components scripts`
Expected: no output.

If there is no output, remove both files:

```bash
git rm lib/slug.ts lib/__tests__/slug.test.ts
```

If there IS output, leave both files in place and note which file still imports
them — do not rewrite that call site here.

- [ ] **Step 7: Stage and hand off**

```bash
git add lib/generate.ts lib/__tests__/generate.test.ts docs/prompts/faq-generation-prompt.md
```

```
Vishwanth | feat(generate): fixed 10/20 counts, canonical fixture, validator gate
```

---

### Task 10: Batch export and status workbook

**Files:**
- Create: `lib/batch-export.ts`
- Create: `app/api/export/batch/route.ts`
- Modify: `lib/export.ts`
- Modify: `app/api/export/route.ts`
- Test: `lib/__tests__/batch-export.test.ts`
- Test: `lib/__tests__/export.test.ts` (replace existing contents)

**Interfaces:**
- Consumes: `RowView`, `Fixture` from Task 4; `fixtureFilename` from Task 5; `pageKey` from Task 2.
- Produces:
  - `interface MappingEntry { collection: string; slug: string; file: string }`
  - `buildMapping(rows: { collection: string; slug: string }[]): MappingEntry[]`
  - `batchDirName(now?: Date): string` — `"batch-YYYY-MM-DD"`, server-local date
  - `SHEET_NAME`, `HEADERS`, `toRowArrays`, `buildStatusWorkbook`, `exportFilename` in `lib/export.ts`

`duplicateSlugs` is deleted: the live CSV has zero duplicate slugs and zero
duplicate `collection`/`slug` pairs, so the flag has nothing to report.

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/batch-export.test.ts`:

```ts
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
```

Replace `lib/__tests__/export.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/batch-export.test.ts lib/__tests__/export.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/batch-export"`, and `HEADERS` mismatch.

- [ ] **Step 3: Write `lib/batch-export.ts`**

```ts
// Builds the handoff artefacts for the team's apply-pillar-faqs.js runner.
// The app never writes to Strapi; this folder is what a human runs the runner against.
import { fixtureFilename } from "@/lib/fixtures";

/** One line of mapping.json — exactly the shape apply-pillar-faqs.js expects. */
export interface MappingEntry {
  collection: string;
  slug: string;
  file: string;
}

export function buildMapping(rows: { collection: string; slug: string }[]): MappingEntry[] {
  return rows.map((r) => ({
    collection: r.collection,
    slug: r.slug,
    file: fixtureFilename(r.slug),
  }));
}

/**
 * `batch-YYYY-MM-DD` using the server's LOCAL date. A UTC stamp reads as
 * yesterday for the first 5.5 hours of every IST day.
 */
export function batchDirName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `batch-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
```

- [ ] **Step 4: Rewrite `lib/export.ts`**

```ts
// Builds the reviewer-facing status workbook: one row per live page, carrying its
// collection, role, FAQ status, generation state, and any workbook metadata that
// joined. Pure — no fs.
import * as XLSX from "xlsx";
import type { RowView } from "@/lib/types";

export const SHEET_NAME = "Content Status";

export const HEADERS = [
  "Collection",
  "Slug",
  "Title",
  "Role",
  "Pillar Association",
  "FAQ Done",
  "Gen Status",
  "Review Status",
  "Excel Status",
] as const;

const WIDTHS = [12, 55, 60, 14, 30, 10, 14, 14, 14];

export function toRowArrays(views: RowView[]): (string | number)[][] {
  return views.map((v) => [
    v.collection,
    v.slug,
    v.title,
    v.role,
    v.pillarAssociation,
    v.faqDone ? "Yes" : "No",
    v.contentState === "not-generated" ? "Not generated" : "Generated",
    v.reviewStatus,
    v.excel?.excelStatus ?? "",
  ]);
}

/** A single-sheet workbook: header row + one row per view, autofiltered, sized. */
export function buildStatusWorkbook(views: RowView[]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet([[...HEADERS], ...toRowArrays(views)]);
  ws["!cols"] = WIDTHS.map((wch) => ({ wch }));
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: views.length, c: HEADERS.length - 1 },
    }),
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  return wb;
}

/**
 * Date-stamped download name; `subset` marks an export of the on-screen rows.
 * The stamp is the server's LOCAL date — a UTC one reads as yesterday for the
 * first 5.5 hours of every IST day.
 */
export function exportFilename(subset: boolean, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `cancerfax-content-status${subset ? "-view" : ""}-${date}.xlsx`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/batch-export.test.ts lib/__tests__/export.test.ts`
Expected: PASS — 4 + 8 passed.

- [ ] **Step 6: Update the existing xlsx export route**

In `app/api/export/route.ts`, drop `duplicateSlugs` and key the subset filter by
`collection/slug`. Replace lines 1–35 with:

```ts
import * as XLSX from "xlsx";

import { loadAll } from "@/app/actions";
import { buildStatusWorkbook, exportFilename } from "@/lib/export";
import { pageKey } from "@/lib/pages";

// Reads the CSV + output/faq/ from disk — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Build the status workbook. `keys` limits it to those rows, kept in source order. */
async function respond(keys: string[] | null): Promise<Response> {
  const { views, error } = await loadAll();
  if (error) return new Response(error, { status: 500 });

  const wanted = keys ? new Set(keys) : null;
  const selected = wanted ? views.filter((v) => wanted.has(pageKey(v))) : views;
  if (selected.length === 0) return new Response("no rows to export", { status: 400 });

  const wb = buildStatusWorkbook(selected);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${exportFilename(keys !== null)}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

Then in the same file rename the POST body field from `slugs` to `keys`:

```ts
/** POST `{ keys }` — "collection/slug" for just the rows currently visible in the table. */
export async function POST(request: Request): Promise<Response> {
  let body: { keys?: unknown };
  try {
    body = (await request.json()) as { keys?: unknown };
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((s): s is string => typeof s === "string")
    : [];
  if (keys.length === 0) return new Response("no keys provided", { status: 400 });
  return respond(keys);
}
```

Leave `export async function GET()` as it is.

- [ ] **Step 7: Write the batch export route**

Create `app/api/export/batch/route.ts`:

```ts
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import { loadAll, getFixture, getReview } from "@/app/actions";
import { applyEdits, fixtureFilename } from "@/lib/fixtures";
import { buildMapping, batchDirName } from "@/lib/batch-export";
import { pageKey } from "@/lib/pages";

// Writes to output/faq/ — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Write every approved row's corrected fixture plus mapping.json into
 * output/faq/batch-<date>/. Re-running on the same date replaces the folder, so a
 * re-export after fixing one row is safe.
 */
export async function POST(): Promise<Response> {
  const { views, error } = await loadAll();
  if (error) return new Response(error, { status: 500 });

  const approved = views.filter(
    (v) => v.reviewStatus === "approved" && v.contentState !== "not-generated",
  );
  if (approved.length === 0) {
    return new Response("no approved rows to export", { status: 400 });
  }

  const dir = resolve(process.cwd(), "output/faq", batchDirName());
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const written: { collection: string; slug: string }[] = [];
  const skipped: string[] = [];
  for (const v of approved) {
    const key = pageKey(v);
    const fixture = await getFixture(key);
    if (!fixture) {
      skipped.push(key);
      continue;
    }
    const corrected = applyEdits(fixture, await getReview(key));
    writeFileSync(
      join(dir, fixtureFilename(v.slug)),
      JSON.stringify(corrected, null, 2) + "\n",
    );
    written.push({ collection: v.collection, slug: v.slug });
  }

  writeFileSync(
    join(dir, "mapping.json"),
    JSON.stringify(buildMapping(written), null, 2) + "\n",
  );

  return Response.json({ dir, count: written.length, skipped });
}
```

- [ ] **Step 8: Stage and hand off**

```bash
git add lib/batch-export.ts lib/export.ts lib/__tests__/batch-export.test.ts \
        lib/__tests__/export.test.ts app/api/export/route.ts app/api/export/batch/route.ts
```

```
Vishwanth | feat(export): emit batch folder + mapping.json for apply-pillar-faqs.js
```

---

### Task 11: Server actions and UI

**Files:**
- Modify: `app/actions.ts`
- Modify: `components/rows-table.tsx`
- Modify: `components/faq-detail-drawer.tsx`
- Modify: `components/bento-overview.tsx`
- Modify: `components/batch-panel.tsx`
- Modify: `lib/batch.ts`
- Test: `lib/__tests__/batch.test.ts`, `lib/__tests__/e2e-flow.test.ts`, `lib/__tests__/move.test.ts` (update)

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: no new exported types. Every server action that took a `slug: string`
  now takes a `key: string` in `"collection/slug"` form.

This is wiring, not new logic. Work through it in the order below and keep the
type checker as the guide.

- [ ] **Step 1: Repoint `app/actions.ts` at the new readers**

Replace the import of `readRows` and the body of `loadAll`'s row read:

```ts
import { readPages, pageKey } from "@/lib/pages";
import { readExcelIndex, joinExcel } from "@/lib/excel";
```

Inside `loadAll`, replace `rows = readRows();` with:

```ts
    const { pages } = readPages();
    rows = joinExcel(pages, readExcelIndex());
```

Everywhere `loadAll` builds `rawBySlug` / `doneBySlug`, key the maps by the
fixture's own `collection` + `slug`. Derive the collection from the fixture's
`route` field (`route.split("/")[1]`) so a fixture on disk is self-describing:

```ts
function keyOfFixture(fx: Fixture): string {
  return `${fx.route.split("/")[1] ?? ""}/${fx.slug}`;
}
```

Rename the local variables to `rawByKey` / `doneByKey` and pass them to
`deriveRowViews` unchanged otherwise.

- [ ] **Step 2: Rename the slug parameter across every action**

In `app/actions.ts`, change these signatures from `slug: string` to `key: string`
and use `key` for the tracker lookup and for locating the fixture file. The
filename on disk is still `` `${key.split("/")[1]}-faq-section.json` ``.

- `getFixture`
- `getReview`
- `saveReview`
- `move` (private)
- `moveToDone`
- `moveBack`
- `approveRow`
- `approveRows` (takes `keys: string[]`)
- `generateRow`

In `generateRow`, replace the row lookup:

```ts
export async function generateRow(key: string): Promise<GenerateResult> {
  const { pages } = readPages();
  const rows = joinExcel(pages, readExcelIndex());
  const row = rows.find((r) => pageKey(r) === key);
  if (!row) return { ok: false, error: `unknown page: ${key}` };
  ...
}
```

- [ ] **Step 3: Run the type checker**

Run: `npx tsc --noEmit`
Expected: errors only in `components/*.tsx` and `lib/batch.ts`. Note the list —
it is the exact worklist for the remaining steps.

- [ ] **Step 4: Update `lib/batch.ts` and its test**

`lib/batch.ts` queues rows for generation. Replace every `slug` identifier in its
queue with `key`, and in `lib/__tests__/batch.test.ts` replace the row factory so
it produces the new `Row` shape:

```ts
function row(collection: Row["collection"], slug: string, extra: Partial<Row> = {}): Row {
  return {
    collection,
    slug,
    title: slug,
    faqDone: false,
    role: "",
    pillarAssociation: "",
    ...extra,
  };
}
```

Run: `npx vitest run lib/__tests__/batch.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `e2e-flow.test.ts` and `move.test.ts`**

Both build fixtures and rows by hand. Apply the same two changes:

- rows use the factory from Step 4
- fixtures use `sectionToMerge` only, with no `schemaRecommendation`,
  no `medicalDisclaimer`, and no `⚠ VERIFY` values

Run: `npx vitest run lib/__tests__/e2e-flow.test.ts lib/__tests__/move.test.ts`
Expected: PASS.

- [ ] **Step 6: Collection filter in `components/rows-table.tsx`**

Three changes:

1. Replace the pillar filter's option source. Where it currently builds options
   from `pillarName`, build them from `collection` with fixed options
   `guides`, `insights`, `treatments`, each showing its ungenerated count —
   the same count logic as commit `1ca83a6`, grouped by `collection`.
2. Default the FAQ-status filter to "not done". Add filter state
   `faqDoneFilter` initialised to `"no"`, filtering `views` on `!v.faqDone`.
   Render the active filter in the toolbar so the visible row count is never
   mistaken for the full 865.
3. Replace every `key={v.slug}` and selection-set entry with `pageKey(v)`, and
   change the export POST body from `{ slugs }` to `{ keys }`.

Remove the VERIFY count column and its cell renderer.

- [ ] **Step 7: Add the role, collection, and FAQ-done badges**

In the same file, add three badge cells reading `v.collection`, `v.role || "—"`,
and `v.faqDone ? "Done" : "Pending"`. Match the existing badge component and
class names already used for `contentState`; do not introduce a new badge style.

- [ ] **Step 8: Strip slug/route editing from `components/faq-detail-drawer.tsx`**

Remove the two input fields bound to `edits.slug` and `edits.route` and their
labels, and remove those keys from the `saveReview` payload. Answer editing is
unchanged. Show `collection`, `slug`, and `route` as read-only text instead.

- [ ] **Step 9: Update `components/bento-overview.tsx`**

Replace `stats.perPillar` with `stats.perCollection` and delete the
`withVerify` tile. Keep every other tile.

- [ ] **Step 10: Add an "Export batch" button**

In `components/batch-panel.tsx`, add a button that POSTs to
`/api/export/batch` and toasts the returned `count` and `dir` via the existing
`sonner` toast. On a non-OK response, toast the response text.

- [ ] **Step 11: Run the full check**

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

Expected: no type errors; every suite passes; the build completes.

If `npm run build` reports an ESLint error about an unused import left behind by
Steps 6–10, remove that import. Do not disable the rule.

- [ ] **Step 12: Verify in the running app**

```bash
npm run dev
```

Open http://localhost:3000 and confirm all five:

1. The table opens showing **449** rows, with the "FAQ done: No" filter visible.
2. Clearing that filter shows **865** rows.
3. The collection filter offers guides / insights / treatments with non-zero counts.
4. Opening a row shows its real route as read-only text, with no `⚠ VERIFY` anywhere.
5. The overview tiles show a per-collection breakdown and no VERIFY tile.

Report any of the five that fails rather than working around it.

- [ ] **Step 13: Stage and hand off**

```bash
git add app/actions.ts lib/batch.ts components/ lib/__tests__/
```

```
Vishwanth | feat(ui): collection filter, live-slug rows, batch export button
```

---

## Done criteria

All of these must hold before the work is called complete:

- [ ] `npx vitest run` passes with every suite green.
- [ ] `npx tsc --noEmit` is clean.
- [ ] `npm run build` succeeds.
- [ ] `grep -rn "VERIFY" lib app components` returns nothing.
- [ ] `grep -rn "perPillar\|verifyCount\|duplicateSlugs\|readRows" lib app components` returns nothing.
- [ ] `output/faq/done/` holds 295 files; `output/faq/archive-2026-07-27.zip` exists.
- [ ] The app opens on 449 rows and reveals 865 when the FAQ-done filter is cleared.
- [ ] A batch export produces a folder of fixtures plus a `mapping.json` whose
      every `file` entry exists in that folder.
- [ ] Nothing is committed. Every suggested commit message is reported to Vishwanth.
