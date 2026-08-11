# CancerFax FAQ Review App

A local Next.js app for reviewing, correcting, and approving the FAQ-section JSON
fixtures generated for CancerFax content pages. It reads the content plan from a
read-only Excel workbook, shows every content row with its generation and review
state, and lets a reviewer open a row, edit answers, resolve `⚠ VERIFY` slug/route
placeholders, approve, and move the corrected fixture from `raw/` to `done/`.

## Prerequisites

- **Node.js ≥ 18** and npm.
- The **`claude` CLI logged in** (via a Claude Max plan) if you want to generate
  fixtures from inside the app. In-app generation shells out to `claude -p`, so
  `claude -p "hi"` must work in your terminal first. No Anthropic API key is used.
  If `claude` is not logged in, the Generate button surfaces an error toast with
  the hint to run `claude` once in a terminal to log in.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Folder model

All content state lives under `output/faq/`:

- `output/faq/raw/` — generated but not-yet-approved fixtures, named
  `<slug>-faq-section.json`.
- `output/faq/done/` — approved/corrected fixtures (same filename), moved here on
  approval.
- `output/faq/tracker.json` — per-slug review record: status, reviewer note, and
  the edit overlay (answer edits + resolved slug/route), plus timestamps.
- `output/faq/toggles.json` — persisted UI toggles (auto-generate, auto-move).
- `docs/source/CancerFax_Content_Architecture_1.xlsx` — the **read-only** content
  plan. The app reads its `All 300 Pages` sheet (719 titled rows) and never writes
  to it.

## Generating fixtures

There are two ways to generate FAQ-section fixtures:

1. **In-app** — click **Generate** on a not-generated row (or flip **Auto-generate**
   to walk the queue one row at a time, pausable). Each run invokes `claude -p` and
   writes a new fixture into `output/faq/raw/`.
2. **Batch** — use the `cancerfax-faq` Claude Code skill to fan out generation
   across many rows in parallel. It also runs on the Claude subscription (no API
   key) and writes into the same `output/faq/raw/` folder.

## Reviewing and approving

Open a row to see its FAQ groups and answers. Editing lets you correct answers and
fill in the resolved slug/route (clearing the `⚠ VERIFY` flags). **Approve** records
the decision in `tracker.json`; when **Auto-move on approve** is on it also writes
the corrected fixture (edits applied, slug/route resolved) to `output/faq/done/` and
removes it from `raw/`. With auto-move off, use the **Move to done** button to do the
raw → done move manually. **Needs work** keeps a row in `raw/` for another pass.

## Relations tab

The **🔗 Relations** tab maps how CancerFax's ~37 Strapi content types
(treatments, conditions, doctors, hospitals, drugs, clinical trials, rankings,
guides, insights, resources, and more — see `docs/specs/2026-08-10-relations-mapping-design.md`
for the full list) should link to each other. Most of these already have
real relation *fields* in Strapi's schema; most of those fields are simply
empty. This tab uses Claude (with live web search) to propose what belongs
in them, grounded only in content that actually exists — it never invents a
page to link to.

**The workflow is deliberately staged, and nothing reaches production
without an explicit, separate Write step:**

1. **Discover** (Content Types tab → "Discover + refresh cache") — confirms
   every content type is live and refreshes the corpus of ~3,400 entries.
   Takes about a minute; you don't need to do this every time (see Caching
   below).
2. **Run** — select one or more entries in the table and click **Run**. Each
   selected entry gets its own `claude -p` call (with WebSearch allowed) that
   proposes relations, grounded in that entry's content and every other
   CancerFax page. **This never writes to Strapi.** Selecting more than one
   entry does **not** map them back-to-back: a randomized gap (the **Gap**
   field, default 8 minutes ±20%) is inserted between each one, the same
   pacing principle already used for production writes on the Resources
   tab — a batch of relation mappings should look like organic review work
   spread over time, not one mechanical sweep. Lower the Gap for a quicker
   pass on a small selection, or use the CLI directly with
   `--gap-minutes=0` for an unpaced batch.
3. **Export for review** — click **Export for review** to generate
   `output/relations/relations-mapping.xlsx` (also downloaded to your
   browser). This is the actual review artifact: an **Overview** sheet (one
   row per entry — current relations, proposed relations, counts, status)
   and a **Proposed Relations** sheet (one row per individual proposed
   relation — source, relation type, target, the model's rationale, and
   whether a real Strapi field exists to write it to). Review this — in
   Excel, shared with a teammate, printed, whatever fits — **before**
   deciding what to write. The workbook is a report only; nothing typed
   into it is read back by the app.
4. **Write** — only after you've reviewed the proposals, go back to the web
   table, select the rows you actually want applied, tick the "I understand
   Write modifies PRODUCTION" checkbox, and click **Write paced** (or
   **Write fast** to skip the gap, e.g. for retrying a failed batch). This
   is the only step that touches Strapi, and it only ever writes proposals
   that came from a prior Run for that exact entry — it never re-generates
   them. Writes are additive (existing relations are never removed) and only
   ever target relation fields that genuinely exist in Strapi's schema;
   everything else (labeled `see_also`) stays report-only. Writes are paced
   and rate-limited the same way as the Resources tab (max 100 writes per
   rolling 5 minutes, shared between both tabs).

### Caching

The ~3,400-entry corpus is fetched from Strapi **once** and reused — not
refetched on every Run, Write, or tab visit (see
`data/.relations-cache.json`, gitignored). The Relations tab shows
`Cached · <n>m ago` so you always know how fresh it is. Refresh it explicitly
(via the "Refresh" button on the Relations tab, or "Discover + refresh cache"
on the Content Types tab) after you've added or edited content in Strapi —
otherwise a brand-new page won't show up as a linkable candidate yet. The
one thing that's always fetched live, never cached, is the actual content of
whichever entry you're mapping right now — proposals are always grounded in
current content, even when the *candidate list* is a cached snapshot.

### Prerequisites

Same credentials as the Resources tab (Resources tab → Credentials): a prod
Strapi API token is required, an admin email/password is optional. No
separate setup — the Relations tab reuses that same encrypted credential
store.

### Where things live

| Path | What |
|---|---|
| `data/relation-checks.json` | Committed. Every Run/Write result, survives a reload. |
| `output/relations/relations-mapping.xlsx` | Committed. The review workbook — regenerated (not appended to) on every "Export for review". |
| `data/.relations-cache.json` | Gitignored. The cached corpus — see Caching above. |
| `lib/relations/schema-registry.json` | Committed. The ground-truth content-type/relation-field list, generated from Strapi's own schema — see `scripts/generate-relation-schema.js`. |

Full technical design (validation rules, write safety, discovery internals):
`docs/specs/2026-08-10-relations-mapping-design.md`.

## Development

- `npm run dev` — dev server at http://localhost:3000.
- `npm run build` — production build (also runs lint + type checks).
- `npx vitest run` — unit tests for the pure `lib/` helpers.
