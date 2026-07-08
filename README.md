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

## Development

- `npm run dev` — dev server at http://localhost:3000.
- `npm run build` — production build (also runs lint + type checks).
- `npx vitest run` — unit tests for the pure `lib/` helpers.
