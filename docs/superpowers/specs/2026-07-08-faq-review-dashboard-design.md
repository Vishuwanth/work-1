# FAQ Review Dashboard — Design Spec

**Date:** 2026-07-08
**Status:** Approved design, ready for implementation planning
**Deliverable:** A single self-contained HTML Artifact (published via the Artifact tool)

## Context

CancerFax generates FAQ-section JSON fixtures for content pages (`output/faq/<slug>-faq-section.json`),
produced by the `cancerfax-faq` subagent workflow. Each fixture is a wrapper:
`pillar / contentType / runner / slug / route / (section | sectionToMerge) / schemaRecommendation /
medicalDisclaimer`, where the section is a `type:"faq"` object with `groups[].items[].{q,a}` and each
`a` is a single `<p>…</p>` paragraph. Slugs and routes are flagged `⚠ VERIFY` until confirmed against
the live Strapi CMS.

Before these fixtures are merged into Strapi, a human needs to QA them: read the FAQs, check medical
tone/accuracy, resolve `⚠ VERIFY` slugs/routes, and mark each page approved or needs-work. Today there
is no review surface — reviewers would have to open raw JSON files. This dashboard is that review
surface.

**Intended outcome:** a reviewer opens one page, sees every generated FAQ page rendered readably,
QAs each, records decisions/edits, and exports those decisions to feed back into the pipeline —
without any server, account, or install.

## Users & primary job

- **User:** CancerFax content-ops reviewers (e.g. Sai Sree, Sandeep) doing pre-merge QA.
- **Primary job:** for each generated page — read it, verify medical safety + `⚠ VERIFY` fields,
  approve or send back, optionally fix answer text / slug, then hand corrected content + decisions to
  whoever merges into Strapi.

## Goals

- Render every generated FAQ fixture readably (groups, `<p>` answers), faithful to the CMS output.
- Surface `⚠ VERIFY` slug/route prominently so they get resolved before merge.
- Capture per-page **approve / needs-work** decisions + a reviewer note.
- Allow **inline edit** of answer text and the slug/route.
- Show **batch progress** across all loaded pages (approved / needs-work / pending / has-VERIFY).
- Get decisions + corrections **out** via aggregate **Export** (download) and per-page **Copy**.

## Non-goals (YAGNI)

- No accounts, login, or multi-user sync.
- No server, database, or network calls (Artifact sandbox forbids them anyway).
- No direct write-back to Strapi — corrections leave via the export file / clipboard and are merged by
  the existing pipeline.
- No generation of content in the dashboard — it only reviews what `cancerfax-faq` produced.

## Hard constraint: Artifact sandbox

The dashboard is one self-contained HTML file. The Artifact CSP blocks external files, fonts, CDNs,
and all network requests. Therefore: all CSS/JS is inline; there are no separate module files (internal
modularity is by JS section, not by file); data cannot be read from the local filesystem automatically;
state cannot be saved server-side. The two escape hatches the sandbox *does* allow — **`localStorage`**
(client-side persistence) and **file download / clipboard** — are what make decisions durable and
exportable.

## Approved layout: Master–detail

A two-pane app (chosen over a card-feed alternative for careful, one-at-a-time QA):

- **Top bar:** product title + source label (`output/faq · N pages loaded`), a segmented **progress
  bar** + stat counts (approved / needs-work / pending / with-VERIFY), a **Drop JSON files** control,
  and an **Export decisions** button.
- **Left sidebar:** search box; filter pills (`All / Pending / ⚠ VERIFY / Needs work / Approved`); a
  scrollable page list, each row showing title, sub-line (pillar · N FAQs), and a status chip (or
  `⚠ <count>` when the page has VERIFY flags).
- **Main pane:** the selected page — title; metadata (pillar, content type, N FAQs / M groups);
  prominent amber `⚠ VERIFY` slug + route chips; FAQ groups (blue H3 heading) with each `q` and
  rendered `<p>a</p>`; **Approve / Needs-work** controls (top-right); and a bottom action bar with
  **Edit answers & slug**, **Copy corrected JSON**, and a **Reviewer note** field.

(Reference mockups persisted under `.superpowers/brainstorm/`.)

## Components (internal modules within the single file)

1. **Data layer** — the in-memory array of page objects (each = one fixture wrapper). Populated from
   two sources, merged/keyed by `slug`: (a) **baked-in** — fixtures embedded at build time; (b)
   **dropped files** — read in-browser via the file-picker / drag-drop. Re-adding a slug updates it.
2. **Review-state store** — per `slug`: `status` (`pending | approved | needs-work`), `note` (string),
   and `edits` (overrides for answer text and slug/route). Persisted to `localStorage` under one
   namespaced key; loaded on startup and merged over the data layer for display.
3. **Sidebar** — renders the list + filters + search from data layer ⨝ review-state.
4. **Detail view** — renders the selected page's groups/items, surfaces VERIFY, hosts status + note.
5. **Editor** — toggles the detail answers/slug into editable fields; writes into review-state `edits`
   (never mutates the original baked/dropped fixture in place — edits are an overlay).
6. **Export / Copy** — **Export** downloads one JSON: an array of `{slug, status, note, correctedFixture}`
   for every loaded page. **Copy** puts a single page's corrected fixture (edits applied) on the clipboard.
7. **Progress board** — derives counts live from review-state for the top-bar bar + stats.

## Data model

**Page object (data layer)** — the fixture as produced by `faq_write.py`, unchanged:
```
{ pillar, contentType, runner, slug, route, section|sectionToMerge:{type,id,h2,intro,groups[]},
  schemaRecommendation, medicalDisclaimer }
```
`slug` (with its `⚠ VERIFY:` prefix stripped for use as the key) is the unique id.

**Review-state (localStorage)** — one key, e.g. `cancerfax-faq-review:v1`:
```
{ "<slug>": { "status": "pending|approved|needs-work",
              "note": "string",
              "edits": { "answers": { "<groupIdx>.<itemIdx>": "<p>…</p>" },
                         "slug": "resolved-slug", "route": "/resolved/route" } } }
```
Only pages the reviewer has touched appear here; untouched pages default to `pending` in the UI.

**Corrected fixture (Export/Copy output)** — a deep copy of the page object with `edits` applied:
resolved slug/route replace the `⚠ VERIFY:` values, edited answers replace originals.

## Data flow

`baked-in fixtures  +  dropped files → Data layer`
`Data layer ⨝ Review-state (localStorage) → Sidebar + Detail render`
Reviewer approves / notes / edits → **Review-state → localStorage** (immediate).
Outbound: **Export** → downloaded decisions file; **Copy** → clipboard (one corrected fixture).
Nothing leaves the browser except the download and clipboard.

## Error handling

- **Non-JSON or wrong-shape dropped file** → skip it, show a non-blocking "couldn't load `<name>`"
  message; the board keeps working. Shape check: must parse and contain `section` or `sectionToMerge`
  with a `type:"faq"` object.
- **Empty state** (nothing baked, nothing dropped) → placeholder: "Drop your `output/faq/*.json`
  files here."
- **`localStorage` unavailable/full** → warn once that decisions won't persist this session; continue
  in memory.
- **Duplicate slug** (same page loaded twice) → newest load wins; note it subtly in the row.
- **Answer not `<p>`-wrapped after edit** → on Copy/Export, wrap plain text in `<p>…</p>` so output
  stays fixture-valid.

## Build & update model

The Artifact is generated/republished by the assistant. On build, current `output/faq/*.json` fixtures
are embedded (baked-in). To refresh with new pages, either the reviewer drops the new files in-browser
(no rebuild) or the assistant rebuilds and republishes to the **same Artifact URL**. Design skills used
at build time: `artifact-design` (Artifact fundamentals) and `frontend-design` (dashboard polish,
anti-AI-slop).

## Verification plan

Build → publish → open the Artifact and:
1. Drop the two real fixtures from `output/faq/` → both render with 18 FAQs / 5 groups; VERIFY
   slug/route show in amber.
2. Approve one, mark the other needs-work + add a note → refresh the page → decisions persist
   (localStorage).
3. Edit one answer and a slug → **Copy corrected JSON** → paste → valid JSON with the edit applied and
   the `⚠ VERIFY:` prefix gone.
4. **Export decisions** → downloaded file lists both pages with status + note + corrected fixture.
5. Progress bar/counts reflect the two decisions.
Driven in the browser with screenshots as evidence.

## Open follow-ups (post-MVP, not in scope now)

- A "copy all approved" bulk action once volumes grow.
- Auto-embedding the full batch as it scales toward ~759 pages (baked payload size — may prefer
  drop-only at scale).
