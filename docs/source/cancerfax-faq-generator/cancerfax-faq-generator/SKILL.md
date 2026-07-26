---
name: cancerfax-faq-generator
description: >
  Generate and publish FAQ sections (schema.org/FAQPage-ready) for EXISTING CancerFax
  insight, guide, and treatment pages, following the CancerFax FAQ AEO instructions.
  Use this skill whenever the user asks to "generate FAQs", "add FAQs to [page/pillar]",
  "write FAQs for [slug]", "/faq [slug]", mentions the all-pages-faq-status.csv backlog,
  asks to work through the FAQ backlog, or wants FAQs added/updated on insights, guides,
  or treatment pages for AEO (featured snippets, People Also Ask, voice search, AI answer
  engines). This is different from cancerfax-content-seed-scripts / cancerfax-insights-seed-
  scripts-v2 — those CREATE whole new pages; this skill only edits the FAQ section of pages
  that already exist and are already published, leaving every other field untouched.
---

# CancerFax FAQ Generator

## Overview

CancerFax has 885 live insight/guide/treatment pages tracked in a status CSV
(`all-pages-faq-status.csv` — canonical copy lives in `Cancerfax/CancerFax/Scripts/FAQs/`,
same file also kept in `~/Downloads/` for convenience), of which 497 still need a real FAQ
section as of 2026-07-20 (see `references/PAGE-STATUS-CSV.md` — these numbers drift, always
trust a fresh `list-pending.js` run over anything written down). This skill:

1. **Reads** the live page's actual content first (`seeds/fetch-page-content.js` — read-only)
   so FAQs are grounded in what THIS page specifically says, not generic filler.
2. **Generates** a compact FAQ JSON fixture following
   `references/FAQ-AEO-INSTRUCTIONS.md` (the CancerFax team's AEO rulebook) with **exactly
   10 items for a Support Page, exactly 20 for a PILLAR PAGE** — a fixed count, not the
   original instruction doc's range, per explicit direction from the team (2026-07-20):
   replace whatever FAQ content already exists completely, don't top up partial sets.
3. **Writes** it live — either via this skill's own `seeds/seed-faq.js`, or via the team's
   own proven production pipeline at `Cancerfax/CancerFax/Scripts/FAQs/apply-pillar-faqs.js`
   (see "Two runners" below). Either way, the write touches **only** the page's
   `sections[].section-faq` component. Title, hero, SEO, CTA, and every other section are
   never included in the write, so they cannot be altered even by a bug.

This is architecturally different from the page-creation skills
(`cancerfax-content-seed-scripts` / `cancerfax-insights-seed-scripts-v2`): those build a
**full-page fixture** and PUT the entire entry (correct for creating a new page). This skill
edits **one already-published page** and must never risk clobbering its existing content —
so it fetches first, edits only the FAQ section in memory, and PUTs back just that field.

### Two runners — use the team's, know how this skill's own works

`Cancerfax/CancerFax/Scripts/FAQs/apply-pillar-faqs.js` already exists, is already battle-tested
(hundreds of successful applies logged in its own `master-faq-reconciliation.csv`), and is the
**preferred runner for real work** — when in doubt, use it, not `seeds/seed-faq.js`. It takes a
mapping file (`[{collection, slug, file}]`) and a folder of `*-faq-section.json` fixtures (see
"Fixture format" below — note it differs from this skill's original `.faq.json` shape).

This skill's own `seeds/seed-faq.js` is kept working too (same underlying fix, see next
section) as a single-fixture, dry-runnable alternative — useful for one-off pages or when you
want the `--dry-run` safety check this skill provides that the team's runner doesn't have.

---

## Setup — files & portability

Same convention as the other `cancerfax-*-seed-*` skills: the runner scripts are portable —
drop `seeds/*.js` anywhere alongside the **canonical** root `strapi-config.js` (never a copy —
see CLAUDE.md "There is only one strapi-config — never duplicate it" and
`feedback_strapi_config_copies.md`). The scripts search their own directory, `cwd`, then walk
upward for `strapi-config.js`, so running them with `cwd` set to the CancerFax monorepo root
(where the canonical file lives) just works with no setup:

```bash
cd "Cancerfax Main"
STRAPI_ENV=staging node "../Cancerfax Skills/cancerfax-faq-generator/seeds/fetch-page-content.js" insights some-slug
```

### Files

```
cancerfax-faq-generator/
├── SKILL.md
├── references/
│   ├── FAQ-AEO-INSTRUCTIONS.md   ← the content/style rulebook — read before writing any FAQ
│   ├── FIXTURE-SCHEMA.md          ← compact JSON format + verified section-faq schema
│   └── PAGE-STATUS-CSV.md         ← CSV columns, count-mapping table, queue workflow
└── seeds/
    ├── _strapi.js               ← config locator + fetchEntry/putSections (NEVER edit)
    ├── _csv.js                   ← quote-aware CSV read/write (NEVER edit)
    ├── fetch-page-content.js     ← READ-ONLY: dump a page's real content for grounding
    ├── seed-faq.js                ← WRITES: append/replace the FAQ section, live
    ├── list-pending.js            ← reads the CSV, shows next N pages needing FAQs
    ├── mark-faq-done.js           ← flips one CSV row's faq_done to Yes after a successful write
    └── reconcile-csv.js           ← rebuilds the CSV from live Strapi ground truth (run
                                       periodically, or whenever "page not found" errors
                                       start showing up — see PAGE-STATUS-CSV.md)
```

**Output runner files on demand** — if the user says "give me the seed files" / "set up a
new machine" / "give me the scripts": read every file under `seeds/` and output each in full
(never summarize or truncate), plus the setup note above.

---

## Workflow

### 1. Identify the target page(s)

- If the user names a slug directly, use it.
- If the user asks to "work through the backlog" / "next batch" / names a pillar or
  collection, run:
  ```bash
  node seeds/list-pending.js <csv-path> [--collection=] [--role=] [--limit=10]
  ```
- Work in small batches (5–10 pages per sitting) — see `PAGE-STATUS-CSV.md`.

### 2. Read the page's real content (mandatory, do not skip)

```bash
STRAPI_ENV=staging node seeds/fetch-page-content.js <collection> <slug>
```

This tells you:
- The page's actual sections — costs, eligibility criteria, named modalities, comparisons —
  so FAQs reflect what THIS page says, not generic filler (Porting Rule P1 spirit: read
  before writing)
- Whether a `section-faq` already exists, and its **real item count** — a row marked
  `faq_done = No` may already carry an empty placeholder stub (§ known edge case in
  `FIXTURE-SCHEMA.md`); `seed-faq.js` replaces either case cleanly

### 3. Determine the FAQ count and grouping

**Fixed count, not a range (team direction, 2026-07-20 — supersedes `FAQ-AEO-INSTRUCTIONS.md`
§2's ranges):**

| `role` | FAQ count |
|---|---|
| `PILLAR PAGE` | exactly **20**, grouped into 4–5 themed groups of ~4–5 items each |
| `Support Page` (or blank — treat as support) | exactly **10**, usually one flat ungrouped list |

**Replace completely, don't top up.** If the page already has 3, 6, or even 18 real FAQ
items, generate a fresh set at the target count and replace the whole section — don't try to
preserve-and-add-to what's there. (You can still reuse good existing questions/answers as
source material when drafting the replacement — several already-live FAQ sets found this
session were well-written and worth keeping the substance of, just re-counted to hit exactly
10 or 20.)

### 4. Write the FAQ content

Follow `references/FAQ-AEO-INSTRUCTIONS.md` in full:
- §3 answer length by question type (definition / list / comparison / voice)
- §4 writing formula (quotable first sentence + supporting context + hedge)
- §5 question phrasing (how patients actually ask)
- §7 mandatory hedge language on eligibility/cost/trial/access answers
- §8 CancerFax mentioned in exactly 1–2 FAQs, approved phrasing only
- §9 no raw JSON-LD needed — the component renders FAQPage schema automatically

**Two valid fixture formats** — pick based on which runner you're using (see "Two runners"
above). Full detail in `references/FIXTURE-SCHEMA.md`.
- This skill's own format (`seed-faq.js`): `{collection, slug, faq: {h2, intro, groups|items}}`,
  saved as `{slug}.faq.json`.
- The team's format (`apply-pillar-faqs.js`): `{pillar, contentType, runner, slug, route,
  sectionToMerge: {type, id, h2, groups}}`, saved as `{slug}-faq-section.json` in
  `Cancerfax/CancerFax/Scripts/FAQs/batch-<date>/` (or wherever `FAQ_SOURCE_DIR` points), plus
  a mapping JSON (`[{collection, slug, file}]`) passed as the runner's argument.

### 5. Dry-run (this skill's runner), then seed

```bash
# Always dry-run first — prints the exact component that will be written, zero API calls
STRAPI_ENV=staging node seeds/seed-faq.js {slug}.faq.json --dry-run

# Seed to staging, verify on the staging frontend, then seed to prod
STRAPI_ENV=staging node seeds/seed-faq.js {slug}.faq.json
STRAPI_ENV=prod    node seeds/seed-faq.js {slug}.faq.json
```

`seed-faq.js` fetches the live published entry, replaces or appends only the FAQ section, and
PUTs with `?status=published` in the same request — the change is live immediately, no
separate "click Publish in admin" step (unlike the full-page seeders).

If using `apply-pillar-faqs.js` instead (no built-in dry-run — verify the fixture JSON by eye,
and consider a staging run first if the page exists there):

```bash
cd "Cancerfax/CancerFax/Scripts/FAQs"
FAQ_SOURCE_DIR="./batch-<date>" STRAPI_ENV=staging node apply-pillar-faqs.js /path/to/mapping.json
FAQ_SOURCE_DIR="./batch-<date>" STRAPI_ENV=prod    node apply-pillar-faqs.js /path/to/mapping.json
```

Batching many pages: draft each page's fixture independently (each is a self-contained,
grounded read-then-write task with no cross-page dependency), then apply the whole mapping
file in one runner call. Parallel `Agent` dispatch — one page per agent, each running
`fetch-page-content.js` then writing its own fixture file — works well here since drafting is
the slow, independent part; keep the actual live write (the runner call) as a single
centralized step you run yourself, not something parallel agents each do independently.

### 6. Mark the CSV row done

```bash
node seeds/mark-faq-done.js <csv-path> <collection> <slug>
```

Only that row changes — every other row is preserved exactly as-is. For a whole batch, mark
each row done right after its runner call succeeds — don't mark rows done before confirming
the write actually succeeded (a batch runner logs OK/FAIL per row; only mark the OK ones).
Also append a line to `Cancerfax/CancerFax/Scripts/FAQs/master-faq-reconciliation.csv`
(`batch-<date>,<file>,<collection>,<slug>,DONE - verified live now`) to match the team's
existing ledger convention.

---

## Critical rules — do not violate

1. **This skill never creates new pages.** If `fetch-page-content.js` reports "Not found",
   stop and tell the user — that slug needs the page-creation skill
   (`cancerfax-content-seed-scripts` / `cancerfax-insights-seed-scripts-v2`) first, not this one.
   It may also mean the CSV is stale (see rule 7) rather than the page being genuinely gone —
   don't assume without checking.
2. **`__component` must be the FIRST key of every dynamic-zone item you write back, or the
   write 400s.** This was the actual root cause of a whole debugging session (2026-07-20):
   Strapi's REST write validator on this deployment (^5.49.0) rejects `sections` items with
   `400 "Invalid key __component at sections"` unless `__component` is first — but every GET
   response places it last, so a naive fetch-then-PUT round trip always reproduces the broken
   order. `_strapi.js`'s `stripIds()` already reorders it correctly — **never** hand-build a
   sections payload without going through `stripIds()`, and never "simplify" it by inlining a
   plain object spread. If you ever see this exact 400 again, this is why.
3. **Never hand-build the populate query differently from `_strapi.js`.** The shallow
   `populate[sections][populate]=*` form used elsewhere in this codebase silently drops FAQ
   `groups[].items[]` and bar-chart `groups[].bars[]` (verified 2026-07-20 — see the comment
   in `_strapi.js`). Always go through `fetchEntry()`.
4. **Never touch fields other than `sections`.** The PUT body is always
   `{ data: { sections } }` — nothing else. If a task ever seems to require changing hero/seo/
   title too, that's a different skill's job, not this one's.
5. **Always dry-run before writing to prod** when using this skill's own `seed-faq.js` —
   staging first, verify, then prod. `apply-pillar-faqs.js` has no dry-run flag; the fixture
   JSON is the thing to check by eye, and a staging run first is still worth it when the page
   exists there (it often won't — staging and prod have diverged, see rule 7).
6. **CancerFax mention discipline (§8) is not optional.** 0 mentions reads as impersonal; 3+
   reads as promotional and undermines the clinical-seriousness positioning the org requires
   sitewide.
7. **Never guarantee outcomes, cures, enrollment, or approval** anywhere in an answer — see
   `FAQ-AEO-INSTRUCTIONS.md` §7 for the exact banned phrasing and required hedges.
8. **The CSV drifts from live Strapi — don't trust it blindly.** Found 2026-07-20: 305 rows
   whose slug no longer existed live (mostly renamed), 244 live pages never tracked at all.
   If `fetch-page-content.js` unexpectedly reports "Not found" for several pages in a row,
   run `reconcile-csv.js` before concluding pages are actually missing — it's very likely the
   CSV, not the site. Never auto-match renames by fuzzy title similarity, even at 85-90%+
   containment — this site's titles are templated (e.g. "Accessing X Through CancerFax",
   "X Cost Comparison: China vs India") and share enough boilerplate to make fuzzy matching
   confidently merge two genuinely different pages. Exact title match only.
