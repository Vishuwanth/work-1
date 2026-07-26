# Page Status CSV — Work Queue

The FAQ backlog is tracked in `all-pages-faq-status.csv`. **Canonical copy**:
`Cancerfax/CancerFax/Scripts/FAQs/all-pages-faq-status.csv` (same file also kept in
`~/Downloads/` for convenience — when you update one, update both, they should stay
byte-identical). Ask for the current path if unknown — don't guess a location.

## Columns

| Column | Meaning |
|---|---|
| `collection` | `insights` \| `guides` \| `treatments` |
| `slug` | matches the live Strapi entry's `slug` field |
| `title` | page title, for human reference only |
| `faq_done` | `Yes` \| `No` — **treat as a hint, not ground truth**. Always confirm with `fetch-page-content.js` (see edge case below) before assuming a "Yes" row needs nothing and a "No" row is starting from zero. |
| `role` | `PILLAR PAGE` \| `Support Page` \| *(blank)* — blank means the page isn't tagged with a pillar cluster; treat it as a standalone page and judge its scope from its actual content |
| `pillar_association` | which content cluster this page belongs to, when tagged |

Snapshot at last count (2026-07-20, post-reconciliation): **885 rows** (down from an original
926 — see "CSV drift" below for why), **497 pending** (`faq_done != Yes`).

## Why `faq_done` alone isn't reliable

Verified empirically: some rows marked `faq_done = No` already have a `section-faq` component
on the live page — but it's an empty placeholder stub (a `groupTitle` with zero `items`), or
in a few cases a fully-written, high-quality FAQ set that the CSV simply never got updated to
reflect (found a PILLAR PAGE with 18 excellent, fully-grouped FAQs still marked `No`).
**`fetch-page-content.js <collection> <slug>` is the actual source of truth** — it reports the
real item count. The CSV is only a queue for deciding *what to look at next*, not proof of
current state.

## CSV drift — the file gets out of sync with live Strapi, and you must re-check periodically

Found 2026-07-20: of 926 tracked rows, **305 had a slug that no longer existed live** (pages
get renamed or removed over time) and **244 live pages were never tracked in the CSV at all**
(new pages ship without the tracker being updated). If you start hitting "Not found" from
`fetch-page-content.js` on more than one or two pages in a row, don't assume the pages are
actually gone — run the reconciliation script first:

```bash
node seeds/reconcile-csv.js ~/Downloads/all-pages-faq-status.csv --dry-run   # preview counts
node seeds/reconcile-csv.js ~/Downloads/all-pages-faq-status.csv            # writes + backs up
```

It fetches every live page (with real FAQ item counts), matches CSV rows by exact slug first,
then falls back to exact title match (same collection) to recover renamed slugs — **never**
fuzzy/similarity matching. That was tried and rejected: even at 85-91% token containment it
confidently merged genuinely different pages (a China page with an India page, DLBCL with
B-Cell ALL, TACE with TARE) because this site's titles are templated and share enough
boilerplate words to fool similarity scoring. Exact string match only, or leave it for a human.
Anything that still doesn't match anything live gets written to a sibling
`dropped-rows-not-live-<date>.csv` for manual review — nothing is silently deleted, and the
original file is always backed up first.

### Cross-checking role/pillar_association against the content architecture doc

`CancerFax_Content_Architecture_1.xlsx` (in `~/Downloads/`, use the `xlsx` skill to read it —
`openpyxl`/`pandas` aren't preinstalled in every environment, install with
`pip3 install --break-system-packages openpyxl` if needed) is a **content-planning workbook**
— pillar titles + support-page titles + writer/status, **no slug or URL column at all** — so
it can't resolve renamed slugs directly. It's useful for a different check: confirming or
correcting `role` and `pillar_association` by exact title match against its two key sheets:

- `Master Overview` + `Treatment ` sheets → list of pillar titles (col B)
- `All 300 Pages` sheet → support-page title (col E) → pillar name (col C) mapping

Only ~260 of 885 live titles matched anything in that workbook as of 2026-07-20 — the site has
grown well past its original ~670-page plan, so most current content simply predates or
postdates that document. Don't expect full coverage; treat a match as authoritative (correct
the CSV's `role`/`pillar_association` to agree with it) and leave everything else as-is. This
cross-check isn't automated by a script (the mismatch rate makes a one-off manual pass more
appropriate than a maintained tool) — redo it by exact title match if asked again, the same way:
build a `title → (role, pillar)` map from those two sheets, compare against the CSV, apply only
where matched.

## FAQ count — fixed, not a range (2026-07-20 team direction)

See `FIXTURE-SCHEMA.md` for full detail. Supersedes `FAQ-AEO-INSTRUCTIONS.md` §2's ranges:

| `role` | FAQ count |
|---|---|
| `PILLAR PAGE` | exactly **20** |
| `Support Page` (or blank) | exactly **10** |

Replace existing FAQ content completely, regardless of how much is already there — don't top
up a partial set to reach the target count.

## Working the queue

```bash
# See what's next, optionally filtered
node seeds/list-pending.js ~/Downloads/all-pages-faq-status.csv --limit=10
node seeds/list-pending.js ~/Downloads/all-pages-faq-status.csv --collection=treatments --role="PILLAR PAGE"

# After a write succeeds, mark it done — only that row changes, everything else preserved
node seeds/mark-faq-done.js ~/Downloads/all-pages-faq-status.csv insights what-is-car-t-cell-therapy
```

For a batch, also append one line per completed page to
`Cancerfax/CancerFax/Scripts/FAQs/master-faq-reconciliation.csv`
(`batch-<date>,<file>,<collection>,<slug>,DONE - verified live now`) — the team's existing
ledger convention, so this skill's work stays visible in the same audit trail as everything
else in that folder.

Work in batches (10-20 pages is reasonable for one sitting) rather than trying to process all
497 rows at once — each page needs its own read of the real content (`fetch-page-content.js`)
before the FAQs can be written well. Drafting many pages' fixtures in parallel (one `Agent` per
page) works well since each is independent; apply the resulting batch to Strapi in one runner
call rather than one write per agent.
