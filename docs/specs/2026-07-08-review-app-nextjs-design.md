# CancerFax Review App (Next.js) — Design Spec

**Date:** 2026-07-08
**Status:** Approved design, ready for implementation planning
**Deliverable:** A local Next.js 14 (App Router) web app, run with `npm run dev`, that reads the content Excel and generated FAQ fixtures from disk and drives the full generate → review → approve → move workflow.

## Context

CancerFax generates FAQ-section JSON fixtures for ~759 content pages listed in
`CancerFax_Content_Architecture_1.xlsx` (sheet `All 300 Pages`). Fixtures are produced by the
`cancerfax-faq` subagent workflow (`faq_write.py`) and land as `output/faq/*.json`. Each fixture is a
wrapper (`pillar / contentType / runner / slug / route / (section|sectionToMerge) / schemaRecommendation
/ medicalDisclaimer`) with a `type:"faq"` section of grouped `q`/`a` items (`a` = one `<p>…</p>`);
slug/route carry `⚠ VERIFY` until confirmed.

Today there is no tool to see the whole pipeline, review generated content, resolve `⚠ VERIFY`, and
track what's done. This app is that tool: **show every Excel row in a table, click to see its generated
FAQ, track status, and on approval move the fixture from a `raw` folder to a `done` folder.** It runs
locally against the folder (no cloud, no API key), which is why it's Next.js (server can read/write disk)
rather than the sandboxed Artifact we built earlier (that stays as a shareable snapshot).

## Users & primary job

- **Users:** CancerFax content-ops reviewers (Sai Sree, Sandeep).
- **Primary job:** for each of the 759 rows — generate its FAQ (if missing), read + QA it, resolve the
  `⚠ VERIFY` slug/route, approve (→ fixture moves to `done/`) or send back (stays in `raw/`), with a
  reviewer note; track progress across the whole set.

## Goals

- One table of **all** Excel rows with search/filter/sort and clear per-row status.
- Click a row → **detail drawer** rendering its generated FAQ (grouped Q/A, `⚠ VERIFY` flags).
- **Generate** content two ways: in-app (server spawns headless `claude -p`) and by handing batches to
  Claude Code; **manual and automatic** modes.
- **Approve → move `raw/` → `done/`**; needs-work stays in `raw/`; **manual and automatic** move.
- **Inline edit** of answer text and the `⚠ VERIFY` slug/route.
- A **tracker** (status, notes, timestamps) persisted to disk, independent of the Excel.
- A **Bento command-center** overview (progress, VERIFY count, throughput, pillar breakdown, the toggles).

## Non-goals (YAGNI)

- No cloud/multi-user auth or realtime sync — single local operator (or a shared machine).
- **Never writes to the `.xlsx`** — Excel is read-only reference.
- No Anthropic API usage — generation is Max-funded via the Claude CLI / Claude Code only.
- No direct Strapi integration — `done/` fixtures are handed off to the existing seed pipeline.

## Hard constraints

- **Max plan, no API credits.** Content generation cannot call the Anthropic API. It runs by the server
  spawning **headless Claude Code** (`claude -p "<prompt>"`), which uses the logged-in Max subscription;
  throughput is paced by Max usage limits, so "auto-generate all" is a throttled queue, not instant.
  Large batches can alternatively be handed to Claude Code (the `cancerfax-faq` skill) out-of-band; the
  app just reflects whatever lands in `raw/`.
- **Local only.** The app reads/writes the project folder via server actions; it is not deployed.

## Folder reorganization (approved)

```
work-1/                          # Next.js app root (npm run dev here)
├── app/                         # App Router: page.tsx, layout.tsx, actions.ts (server actions)
├── components/
│   ├── ui/                      # shadcn primitives
│   ├── bento-overview.tsx       # command-center tiles
│   ├── rows-table.tsx           # shadcn data table (all Excel rows, virtualized)
│   ├── faq-detail-drawer.tsx    # Sheet: FAQ viewer + inline editor + actions
│   └── generate-controls.tsx    # generate/approve/move + auto toggles
├── lib/
│   ├── excel.ts                 # read All 300 Pages → Row[]
│   ├── fixtures.ts              # load raw/done fixtures, slug↔row linkage, validate, applyEdits
│   ├── tracker.ts               # read/write tracker.json
│   └── generate.ts              # spawn `claude -p`; queue for auto mode
├── output/faq/
│   ├── raw/                     # generated, awaiting review  (2 existing files migrate here)
│   ├── done/                    # approved
│   └── tracker.json             # app tracker (status/notes/timestamps) — source of truth for review state
├── docs/                        # reference/, prompts/, specs/, plans/, source/CancerFax_..._1.xlsx
├── design-system/cancerfax-review/  # ui-ux-pro-max MASTER.md + pages/ (design tokens/guidance)
├── scripts/                     # generate_faq.py, faq_write.py
├── artifacts/                   # faq-review-dashboard.html (the earlier shareable Artifact)
└── package.json  next.config.ts  tsconfig.json  components.json  tailwind config …
```
Cleanups during the move: delete `PLAN_faq_generator.md` and the duplicate `.agents/…xlsx`.

## Architecture

- **Next.js 14 App Router.** Server Components render the page; **Server Actions** (`app/actions.ts`) do
  all disk I/O — read Excel, list raw/done, read a fixture, write tracker, generate, move. No API routes
  needed beyond actions (add a route only for the streaming generate log if desired).
- **No database.** State = the Excel (read) + `output/faq/raw|done/*.json` (files) + `tracker.json`
  (review state). The app reconciles these on load.
- **Client components** for interactivity: the table (TanStack Table + shadcn), the drawer, toggles;
  they call server actions and revalidate.
- Skills used at build time: `react-nextjs-development`, `shadcn-ui`, `frontend-design`, `ui-ux-pro-max`
  (design system persisted under `design-system/cancerfax-review/`), `dataviz` for the throughput tile.

## Data model

**Row (from Excel, read-only):** `{ rowNum, pillarName, title, excelStatus, contentType }` from
`All 300 Pages`. `slug = slugify(title)` links a row to its fixture.

**Fixture (raw or done):** the `faq_write.py` wrapper, unchanged. Located by `slug` in `raw/` or `done/`.

**Tracker (`output/faq/tracker.json`), keyed by slug:**
```
{ "<slug>": {
    "rowNum": 463,
    "reviewStatus": "pending | approved | needs-work",
    "note": "string",
    "edits": { "answers": { "<gi>.<ii>": "<p>…</p>" }, "slug": "resolved", "route": "/resolved" },
    "generatedAt": "iso", "reviewedAt": "iso", "movedAt": "iso"
} }
```

**Derived per-row state shown in the table:**
- **Content state:** `not-generated` (no file) / `raw` (file in raw/) / `done` (file in done/).
- **Review state:** from tracker (`pending`/`approved`/`needs-work`).
- **VERIFY count:** unresolved `⚠ VERIFY` fields on the fixture (0 once edited/resolved).
- Excel Status shown as a muted reference column.

## Generation (manual + automatic)

- **Manual, in-app:** a row's `Generate` button calls a server action → `lib/generate.ts` spawns
  `claude -p` with the `cancerfax-faq` prompt for that title/pillar/type; on success writes the fixture to
  `raw/` and updates the tracker. Streams a progress/log line back.
- **Automatic, in-app:** the `Auto-generate` toggle runs a throttled queue over all `not-generated` rows,
  one (or a small concurrency) at a time, respecting Max limits; pausable; shows queue progress.
- **Batch via Claude Code (out-of-band):** for big runs, the operator tells Claude Code "generate the next
  N" (the `cancerfax-faq` skill); the app picks up new files in `raw/` on refresh/revalidate.

## Approve / move flow (manual + automatic)

- **Approve:** sets `reviewStatus=approved`, applies any edits to a corrected fixture, and — if
  `Auto-move on approve` is **on** — moves the corrected file `raw/<slug>.json → done/<slug>.json`
  (stamps `movedAt`). If the toggle is **off**, approval marks it approved and a separate **Move to done**
  button performs the move (manual).
- **Needs-work:** sets `reviewStatus=needs-work`; file **stays in `raw/`**.
- **Un-approve / move back:** available to reverse (done/ → raw/).
- Moves are atomic writes (write to done/, then unlink raw/); the corrected (edited, VERIFY-resolved)
  content is what lands in `done/`.

## UI — Bento command-center + table + drawer

**Design system** (from `ui-ux-pro-max`, persisted): style = clean dense admin with an Apple-style Bento
overview; palette blue `#1E40AF` / secondary `#3B82F6` / **amber `#D97706`** (VERIFY) / green success /
destructive `#DC2626` / light bg `#F8FAFC` with full dark tokens; fonts **Fira Sans** (UI + FAQ reading)
+ **Fira Code** (tabular `#`/counts/slug); dense 8px rhythm; subtle 200–300ms motion; light + dark.

- **Bento overview (top):** modular rounded-2xl tiles — Generated (`n/759`), Approved, **⚠ VERIFY to
  resolve**, weekly throughput (small bar chart, `dataviz`), By-pillar breakdown, and the **Auto-generate**
  / **Auto-move on approve** toggles as tiles. Responsive 4→2→1 cols.
- **Data table (below):** shadcn + TanStack Table of all rows — columns `# · Title · Pillar · Type ·
  Excel · Content · Review · Action`; search, pillar + state filters, sortable headers (`aria-sort`),
  **virtualized** for 759 rows, tabular-nums, keyboard nav; status badges are glyph+label (never
  color-only). Action = `Generate` (not-generated) or `Review →` (generated).
- **Detail drawer (shadcn Sheet, right):** the generated FAQ rendered (blue group headings, bold Q,
  `<p>` answers), amber `⚠ VERIFY` slug/route chips, an **Edit** toggle (answers → textarea, slug/route →
  inputs, saved to tracker `edits`), and a sticky footer: **Approve (& move)** / **Needs work** / **Copy
  corrected JSON** / reviewer note. Focus-trapped, Escape/scrim to close, 40–60% scrim.

## Error handling

- **Missing/locked Excel** → clear error state with the expected path.
- **Malformed fixture in raw/** → row shows a "fixture invalid" badge; drawer shows the parse error, not a
  crash.
- **`claude -p` fails / not authenticated** → the generate action returns the stderr; row returns to
  not-generated; a toast explains (e.g. "run `claude` once to log in").
- **Move conflict** (target exists in done/) → confirm overwrite.
- **Empty states** (no rows match filter; nothing generated yet) → helpful placeholders.
- **Max rate-limit during auto-generate** → queue pauses with a "resume later" notice.

## Verification plan

Run `npm run dev`, open the app, and:
1. Table lists all 759 Excel rows; the 2 existing fixtures show **Content = Raw** with correct VERIFY badges.
2. Click row 463 → drawer renders 18 FAQs / 5 groups; edit an answer + resolve the slug → **Copy corrected
   JSON** yields valid JSON with the edit and no `⚠ VERIFY`.
3. Approve row 463 with **Auto-move on** → file moves `raw/ → done/`; table shows **Done/Approved**; tracker
   updated; refresh persists.
4. Mark row 464 **Needs work** → stays in `raw/`.
5. Click **Generate** on an ungenerated row → `claude -p` runs, a new fixture appears in `raw/`, row flips
   to Raw/Pending. (If not logged into `claude`, the error path shows the auth message.)
6. Toggle **Auto-generate** on a small filtered set → throttled queue generates them; pause works.
7. Bento tiles + throughput + pillar breakdown reflect the above; light/dark both legible (contrast checked).
Driven in the browser; screenshots as evidence.

## Open follow-ups (post-MVP)

- Bulk actions (select many → generate/approve/move).
- Concurrency tuning + persistent queue for auto-generate across restarts.
- Optional: write a status export (CSV) for pasting into Excel (Excel stays read-only in-app).
