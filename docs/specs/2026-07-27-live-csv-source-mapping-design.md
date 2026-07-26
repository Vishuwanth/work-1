# Design: map the review app onto the live-site FAQ source

**Date:** 2026-07-27
**Status:** approved, pending implementation plan
**Supersedes:** the Excel-as-source-of-truth model in
`docs/specs/2026-07-08-faq-review-dashboard-design.md`

---

## 1. Problem

The review app treats `docs/source/CancerFax_Content_Architecture_1.xlsx` as its
source of truth. It has no knowledge of which pages actually exist on the live
CancerFax site, and it derives each page's slug by running `slugify()` over the
sheet's title. Both assumptions are wrong.

A new source dropped at `docs/source/cancerfax-faq-generator/` is the production
FAQ pipeline for the live site. It carries exact-slug ground truth rebuilt from
Strapi.

### Measured overlap

| Check | Result |
|---|---|
| Excel content rows (current app source) | 719 |
| Live published pages (`all-pages-faq-status.csv`) | 865 |
| Excel rows matching a live page by derived slug | 233 |
| Excel rows matching a live page by exact title | 238 |
| Excel rows with no live counterpart at all | 460 |
| Live pages absent from Excel | 636 |
| Live pages still needing FAQs (`faq_done != Yes`) | 449 |

### The corpus already produced

`output/faq/done/` holds 619 approved fixtures. All 619 filenames appear in
`master-faq-reconciliation.csv` under the source folder `150 pillar pages`, so
the team has already reconciled them against live Strapi:

| Ledger verdict | Count |
|---|---|
| `DONE - verified live now` | 286 |
| `UNDONE - never had a matching page` | 324 |
| `RAN BUT NOW MISSING (slug drift/deleted)` | 9 |

324 of 619 fixtures (52%) were written for pages that do not exist.

Independently, **all 619 fixtures still contain `⚠ VERIFY` placeholders** in
their `slug` and `route` fields:

```json
"slug":  "⚠ VERIFY: actinium-225-psma-therapy-alpha-particle-theranostics",
"route": "⚠ VERIFY: /<section>/actinium-225-psma-therapy-alpha-particle-theranostics",
```

They were never resolved inside the app. The new CSV supplies exactly the two
missing values — real `collection` and real `slug` — so the placeholder
mechanism becomes unnecessary rather than merely automated.

### Decisions taken

1. The CSV becomes the source of truth. Excel demotes to optional metadata.
2. The app's default working set is pages with `faq_done != Yes` (449 rows).
   All 865 stay loaded; done rows sit behind a filter.
3. Fixtures with no live page are archived to a dated zip and removed from
   `done/`.
4. The app stays fully offline. It never reads or writes Strapi. It exports a
   batch folder for the team's `apply-pillar-faqs.js` runner.
5. The fixture format is the one in `docs/source/cancerfax-faq-generator/batch-2026-07-20/`.

---

## 2. Sources and row identity

### 2.1 Live pages — `lib/pages.ts` (new)

Reads `docs/source/cancerfax-faq-generator/all-pages-faq-status.csv`.

Columns: `collection`, `slug`, `title`, `faq_done`, `role`, `pillar_association`.

Parsing is quote-aware — titles contain commas. A row is valid when
`collection` and `slug` are both non-empty; anything else is skipped and
counted in a parse summary.

### 2.2 Ledger — `lib/ledger.ts` (new)

Reads `docs/source/cancerfax-faq-generator/master-faq-reconciliation.csv` into a
`Map<filename, LedgerStatus>`, where `LedgerStatus` is derived by prefix match:

| CSV `status` starts with | `LedgerStatus` |
|---|---|
| `DONE` | `"live"` |
| `UNDONE` | `"no-page"` |
| `RAN BUT NOW MISSING` | `"drifted"` |
| anything else | `"other"` (audit rows; ignored by the reconciler) |

Prefix matching is required because several `DONE` rows carry a trailing
parenthetical, e.g. `DONE - verified live now (slug renamed cancer-immunotherapy
-> immunotherapy)`.

Only rows whose `source_folder` is `150 pillar pages` are consulted by the
reconciler in §4. Other folders describe batches this app did not produce.

### 2.3 Excel — `lib/excel.ts` (retained, demoted)

Still reads the `All 300 Pages` sheet. Its rows are joined onto live pages by
**exact title match**, comparing `title.trim().toLowerCase()` on both sides.

Fuzzy matching is forbidden. The site's titles are templated ("Accessing X
Through CancerFax", "X Cost Comparison: China vs India") and share enough
boilerplate that high-containment matches merge genuinely different pages. This
is rule 8 of the source skill's critical rules, and this project has already
seen it fail: exact slug matching found 229 live fixtures where the team's
manual reconciliation found 286 — a heuristic that looked ~80% right.

**Ambiguity is two-sided.** Titles repeat on both sides: 14 titles appear twice
in the CSV (28 live pages), and 24 titles appear twice in Excel (48 rows). A
naive join would silently attach one page's metadata to a different page.

The rule is therefore: **join only when a title appears exactly once on each
side.** Any title with a count above one on either side is skipped for every row
carrying it, and recorded in an `ambiguousTitles` list surfaced in the parse
summary.

Measured effect:

| Join | Hits |
|---|---|
| Naive title match | 238 |
| Ambiguity-safe match | **230** |
| Dropped as ambiguous | 8 |

Eight rows lose optional metadata; zero rows get the wrong page's metadata.
Unmatched rows render their Excel columns blank. That is normal, not an error.

### 2.4 Row type

```ts
export type Collection = "guides" | "insights" | "treatments";
export type PageRole = "PILLAR PAGE" | "Support Page" | "";

export interface Row {
  collection: Collection;
  slug: string;
  title: string;
  faqDone: boolean;
  role: PageRole;
  pillarAssociation: string;
  excel?: {
    pillarNum: string;
    pillarName: string;
    excelStatus: string;
  };
}
```

Identity is the pair `collection` + `slug`. The key format used in
`tracker.json` and in React lists is `` `${collection}/${slug}` ``.

`slugify()` in `lib/slug.ts` is no longer used to produce page identity. It is
retained only if some other call site still needs it; otherwise it and
`lib/__tests__/slug.test.ts` are removed.

### 2.5 Removed from the model

`RowView.verifyCount` is deleted, along with the `⚠ VERIFY` resolve-slug and
resolve-route editing controls in the review dialog. Slugs now come from the
CSV and are never guessed, so there is nothing to resolve. `ReviewRecord.edits`
keeps `answers` and drops `slug` and `route`.

---

## 3. Fixture format

Canonical shape, verified across all 56 files in `batch-2026-07-20/`:

```json
{
  "pillar": "Proton therapy",
  "contentType": "Treatments",
  "runner": "apply-pillar-faqs.js",
  "slug": "carbon-ion-therapy",
  "route": "/treatments/carbon-ion-therapy",
  "sectionToMerge": {
    "type": "faq",
    "id": "faq",
    "h2": "Frequently Asked Questions",
    "groups": [
      {
        "title": "",
        "items": [
          { "q": "Is carbon ion therapy better than proton therapy?", "a": "<p>Not necessarily. …</p>" }
        ]
      }
    ]
  }
}
```

### 3.1 Field rules

| Field | Rule |
|---|---|
| filename | `<slug>-faq-section.json`; must equal the `slug` field |
| `pillar` | `pillar_association` when non-empty, else the page `title` |
| `contentType` | Title-case of `collection`: `Guides`, `Insights`, `Treatments` |
| `runner` | always the literal `"apply-pillar-faqs.js"` |
| `slug` | the live slug, verbatim from the CSV |
| `route` | always `/<collection>/<slug>` |
| `sectionToMerge.type` | always `"faq"` |
| `sectionToMerge.id` | always `"faq"` |
| `sectionToMerge.h2` | `"Frequently Asked Questions"` |
| `sectionToMerge.intro` | optional; omitted by default (present in only 4 of 56) |
| `groups[].title` | `""` for support pages; a themed title for pillar pages |
| `items[]` | `{ q, a }` |
| `a` | HTML, one or more `<p>…</p>` blocks; no other tags |

Answer HTML uses only `<p>` — 699 occurrences across the batch, with no lists,
headings, or bold.

**Answers may hold more than one paragraph.** Several shipped fixtures use a
quotable lead paragraph followed by supporting context:

```html
<p>International patients typically have access to…</p><p>Broader support…</p>
```

An earlier draft of this spec required a single `<p>`, inferred from the balanced
699 `<p>` / 699 `</p>` counts. That inference was wrong — balanced tags do not
imply one per answer. Five shipped fixtures use multiple paragraphs. The rule is
"one or more `<p>` blocks, no other tag".

### 3.2 Changes to `lib/types.ts`

| Field | Currently | Becomes |
|---|---|---|
| `section` | optional alternative to `sectionToMerge` | removed; `sectionToMerge` is required |
| `schemaRecommendation` | required | removed — absent from all 56 batch files |
| `medicalDisclaimer` | required | removed — absent from all 56 batch files |
| `FaqSection.intro` | required `string` | optional `string` |
| item keys | `{ q, a }` | `{ q, a }`, unchanged |

### 3.3 Known source defect: item key variant

55 of 56 batch files use `{ q, a }`. One file,
`integrative-oncology-combining-cancer-treatment-supportive-care-faq-section.json`,
uses `{ question, answer }`.

The reader normalizes `question`/`answer` to `q`/`a` on load. The writer always
emits `q`/`a`. The variant is accepted on input and never produced on output.

---

## 4. One-time corpus reconciliation

`scripts/reconcile-corpus.mjs`, run once, ledger-driven.

| Ledger status | Count | Action |
|---|---|---|
| `live` | 286 | stays in `output/faq/done/` |
| `drifted` | 9 | stays in `output/faq/done/`; tracker gains `ledgerStatus: "drifted"` |
| `no-page` | 324 | added to `output/faq/archive-2026-07-27.zip`, then deleted from `done/` |

A fixture in `done/` with no ledger row is treated as `"other"` and left in
place, so an unexpected file is never deleted.

`tracker.json` retains its record for all 619 slugs, each gaining a
`ledgerStatus` field. No review history is lost.

**Idempotency.** A second run finds the 324 files already gone and exits with a
no-op summary. It never appends to an existing zip; if
`archive-2026-07-27.zip` already exists the script aborts and asks to be
re-run with a different date or `--force`.

**Output.** The script prints a before/after count for `done/` and the exact
list of archived filenames, so the operation is auditable from the terminal
alone.

The 71 shorter-slug rename candidates identified during analysis are
deliberately **out of scope**. The team's manual reconciliation already resolved
57 of them into the `live` bucket; the remainder fall into `no-page` and get
archived. No automated rename matching is performed anywhere in this design.

---

## 5. Generation

### 5.1 Rulebook

`docs/source/cancerfax-faq-generator/cancerfax-faq-generator/references/FAQ-AEO-INSTRUCTIONS.md`
becomes the authority. `docs/prompts/faq-generation-prompt.md` is rewritten to
carry its rules and a pointer back to the reference file.

### 5.2 Counts

Fixed counts, per the team's 2026-07-20 direction, which supersedes the ranges
in the AEO instructions:

| `role` | Items | Group shape |
|---|---|---|
| `PILLAR PAGE` | exactly 20 | 4–5 titled groups of 4–5 items |
| `Support Page`, or blank | exactly 10 | one group with `title: ""` |

A blank `role` is treated as `Support Page`. In the pending 449 that means 448
support pages and 1 pillar page.

Existing FAQ content on a page is replaced in full, never topped up.

### 5.3 Offline limitation — accepted, stated

The source skill makes "fetch the live page's real content before writing"
a mandatory step, so answers are grounded in what that specific page says.

This design is offline by decision, so **that step does not happen**. Generated
answers will be correct for the topic but cannot reflect a specific page's
costs, named centres, or eligibility criteria. This is the quality ceiling of
the offline choice and is the most likely source of future rework.

It is reversible without redesign: adding a `STRAPI_CONFIG_PATH` env var and a
call to `seeds/fetch-page-content.js` before prompting would close the gap,
touching only the generation path.

### 5.4 Validator — `lib/validate.ts` (new)

Every generated fixture is validated before it is written to
`output/faq/raw/`. A failure surfaces as a generation error, not a silent write.

Checks:

1. Item count matches the role rule exactly (20 or 10).
2. Pillar pages have 4–5 groups; support pages have exactly 1 group with
   `title: ""`.
3. Every item has non-empty `q` and `a`.
4. Every `a` is one or more `<p>…</p>` blocks and contains no tag other than `<p>`.
5. No `⚠` character anywhere in the fixture.
6. `route` equals `/<collection>/<slug>`.
7. `contentType` is the Title-case of `collection`.
8. `runner` is `"apply-pillar-faqs.js"`.
9. `type` and `id` are both `"faq"`.
10. "CancerFax" appears in 1–2 answers — 0 reads impersonal, 3+ reads
    promotional.

Checks 1–9 are hard failures. Check 10 is a hard failure too; the source skill
lists mention discipline as non-optional.

---

## 6. UI

### 6.1 Collection replaces pillar

Pillar-based grouping, filtering, and the per-pillar ungenerated counts added in
commit `1ca83a6` are re-pointed at `collection`. In the pending backlog 448 of
449 rows have a blank `pillar_association`, so every per-pillar count would read
zero. Collection has a real distribution:

| Collection | Pending rows |
|---|---|
| insights | 330 |
| guides | 75 |
| treatments | 44 |

`pillarAssociation` is still displayed on a row when present, but is not a
filter dimension.

### 6.2 Default filter

The table opens filtered to `faq_done = No` — 449 rows. All 865 are loaded; a
toggle reveals the 416 already done. The active filter is visible in the
toolbar so the row count is never mistaken for the full set.

### 6.3 Badges and columns

Added: `collection`, `role`, `faq_done`.
Removed: the VERIFY count column, and the resolve-slug / resolve-route fields in
the review dialog.

### 6.4 Overview stats

`OverviewStats.perPillar` becomes `perCollection`. `withVerify` is removed.
Remaining counters are unchanged.

---

## 7. Export

`POST /api/export/batch` writes, from the rows currently approved:

```
output/faq/batch-<YYYY-MM-DD>/<slug>-faq-section.json   one per approved row
output/faq/batch-<YYYY-MM-DD>/mapping.json              [{ collection, slug, file }]
```

`mapping.json` is the argument shape the team's runner expects. The folder is
then handed off manually:

```bash
cd "Cancerfax/CancerFax/Scripts/FAQs"
FAQ_SOURCE_DIR="./batch-<date>" STRAPI_ENV=staging node apply-pillar-faqs.js /path/to/mapping.json
FAQ_SOURCE_DIR="./batch-<date>" STRAPI_ENV=prod    node apply-pillar-faqs.js /path/to/mapping.json
```

The date stamp uses the server's local date, matching the existing rule in
`lib/export.ts` — a UTC stamp reads as yesterday for the first 5.5 hours of
every IST day.

Re-exporting on the same date overwrites the folder's fixtures and regenerates
`mapping.json`, so a re-run after fixing one row is safe.

The existing status workbook export in `lib/export.ts` is retained, with its
columns re-pointed: `Pillar`/`Pillar Name` become `Collection`/`Pillar
Association`, `Dup Slug` is dropped, and `FAQ Done` is added.

Dropping `Dup Slug` is safe: across the 865 live pages there are **zero**
duplicate slugs and zero duplicate `collection`/`slug` pairs. The duplicate-slug
problem was an artifact of deriving slugs from titles, and it disappears with
the derivation.

---

## 8. Testing

All new logic lives in pure `lib/` helpers, so it is covered by `npx vitest run`
with no fixtures on disk beyond trimmed real samples.

| File | Covers |
|---|---|
| `lib/__tests__/pages.test.ts` | CSV parse, quoted titles containing commas, `faq_done` truthiness, blank-role handling, skipped-row counting |
| `lib/__tests__/ledger.test.ts` | prefix mapping of the four `LedgerStatus` values, including `DONE …(slug renamed …)`; `source_folder` filtering |
| `lib/__tests__/reconcile.test.ts` | the 286 / 324 / 9 split against a sample ledger; unknown files left untouched; second run is a no-op; abort on existing zip |
| `lib/__tests__/validate.test.ts` | all 56 batch fixtures as golden inputs |
| `lib/__tests__/excel.test.ts` | updated: exact-title join, blank metadata on miss, and two-sided ambiguity — a title duplicated in the CSV, in Excel, and in both must join to neither side |

### Golden-file test

`validate.test.ts` runs the validator over all 56 files in `batch-2026-07-20/`.

- 55 must pass.
- `questions-patients-should-ask-about-car-t-faq-section.json` must **fail**
  check 1 with "9 items, expected 10". It is a known real defect in the shipped
  batch, and asserting the failure proves the validator catches the exact class
  of bug that reached production.

### Tests requiring update

`batch.test.ts`, `e2e-flow.test.ts`, `generate.test.ts`, `state.test.ts`, and
`move.test.ts` reference Excel-derived slugs and `verifyCount`. They are updated
to the new `Row` shape, not deleted. `slug.test.ts` is removed with
`lib/slug.ts` if nothing else consumes it.

---

## 9. Out of scope

- Any Strapi read or write from this app.
- Automated rename or fuzzy slug matching.
- Re-running generation for the 286 fixtures already live.
- Editing the source CSVs. They are read-only inputs, exactly as the workbook
  was.
- Recovering the 324 archived fixtures into live pages. Those pages do not
  exist; creating them is the page-creation skill's job, not this one's.
