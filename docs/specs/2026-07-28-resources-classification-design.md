# Design: AI re-classification of Strapi resources

**Date:** 2026-07-28
**Status:** as-built — written after implementation, documents commit `c367737`
**Scope:** the Resources tab of the review app, and the `lib/resources/` +
`scripts/` code behind it

---

## 1. Problem

CancerFax publishes blog articles ("resources") in Strapi. Each one carries a
`resource_category` (exactly one) and `resource_tags` (a many-to-many). Both
are wrong or missing across much of the corpus:

- Articles sit in catch-all categories such as `awareness` regardless of subject.
- Many have no tags at all.
- The category is part of the live public URL
  (`/resources/<category-slug>/<slug>`), so a wrong category is also a wrong URL.

Fixing this by hand means reading each article and picking from a large closed
vocabulary of categories and grouped tags. That is slow, and inconsistent
between reviewers.

An AI classifier can propose category + tags per article. The risk is that it
writes something wrong, or invented, straight into production content.

### Existing prior art

Working scripts already lived in the sibling `cancerfax-strapi-backend` repo:

| Sibling script | Purpose |
|---|---|
| `scripts/ai-classify-resources.js` | classify category + tags |
| `scripts/audit-resource-duplicate-content.js` | find repeated content blocks |
| `scripts/_resource-ai-shared.js` | fetch + taxonomy helpers |

They were CLI-only, produced CSV, and required a checkout of that repo plus its
`strapi-config.js`.

---

## 2. Goals

1. A reviewer browses every published resource in the review app, filters and
   multi-selects the ones to work on.
2. **Run** classifies the selection and checks it for duplicate content, and
   writes nothing.
3. **Write** applies category + tags to production Strapi and republishes.
4. The classifier can never write a value outside the live taxonomy.
5. Check state survives a page reload.
6. The app runs from a fresh clone of *this* repo. No sibling checkout.

### Non-goals (YAGNI)

- **Staging.** This app targets production only. The credentials store has no
  staging field.
- **Writing duplicate-content findings.** Duplicates are reported for human
  judgement and never auto-remediated. The confirmation checkbox states this.
- **Editing article body content.** Only the two relation fields are written.
- **Subcategory.** `resource_subcategory` is fetched but not classified or written.
- **Multi-user access control.** This is a localhost operator tool (see §8).

---

## 3. Architecture

The app is a Next.js review dashboard. The existing FAQ workflow became one tab;
Resources is a second. Hospitals and Doctors are `ComingSoonTab` placeholders.

```
components/app-shell.tsx
  └── Tabs: FAQs | Resources | Hospitals | Doctors
        └── ResourcesTab
              ├── Resources    → ResourceListPanel   (browse, select, Run/Write)
              ├── Taxonomy     → TaxonomyPanel       (live categories + tags)
              └── Credentials  → CredentialsPanel    (encrypted secrets)
```

### 3.1 Script-as-subprocess

API routes do not perform the work. Each spawns a Node script and parses its
output.

```
POST   /api/resources/run       → spawns scripts/run-resource-check.js DETACHED, returns 202
GET    /api/resources/batch     → progress of the detached batch
DELETE /api/resources/batch     → SIGTERM the batch process group
POST   /api/resources/export    → rewrites the tagging workbook (§10.2)
GET    /api/resources/list      → node scripts/list-resources.js
GET    /api/resources/taxonomy  → node scripts/fetch-taxonomy.js
GET    /api/resources/checks    → reads data/resource-checks.json directly
```

`run` is the exception to the one-line-JSON contract below: writes are paced
(§7.3), so a batch runs for hours and cannot be held inside an HTTP request.
That route spawns the runner detached and returns immediately; the client polls
`/api/resources/batch` for progress and `/api/resources/checks` for results.

**Contract:** each script writes **exactly one JSON line to stdout** — either the
payload, or `{ "error": "..." }`. All progress goes to stderr.

Rationale:

- The same script serves the UI and a terminal, with no duplicated logic.
- Long `claude -p` work runs outside the Next.js request handler's process.
- The classify/audit modules stay plain CommonJS, portable back to the backend repo.

`lib/run-script.ts` implements the caller. It checks stdout on **both** the
success and failure path, because `execFile` rejects on a non-zero exit and Node
puts the script's real error message in `e.stdout`, not `e.stderr` — a naive
catch surfaces a useless `Command failed: node ...`.

All resource routes set `runtime = "nodejs"` and `dynamic = "force-dynamic"`.
They spawn processes and read the filesystem, so Edge is never valid.

### 3.2 Module layout

| Path | Responsibility |
|---|---|
| `lib/resources/strapi-client.js` | REST + admin transport, token/JWT auth |
| `lib/resources/shared.js` | fetch resources + taxonomy, flatten rich text, write rate limit |
| `lib/resources/classify.js` | prompt, `claude -p` call, validation, apply |
| `lib/resources/audit.js` | duplicate-content detection (pure, read-only) |
| `lib/resources/checks-store.js` | persist results per slug |
| `lib/resources/batch-store.js` | progress + liveness of the one in-flight batch |
| `lib/credentials-store.js` | encrypted field get/set/status |
| `lib/secrets-core.js` | AES-256-GCM encrypt/decrypt/mask |
| `lib/resource-reports.ts` | pure client-safe row merging, CSV, link building |

`lib/resources/*` is a deliberate port of the sibling repo's scripts, so goal 6
holds. The port drops the CSV output and the staging branch.

---

## 4. Data flow

### 4.1 Two-stage fetch

Fetching every article's rich-text body is expensive. The list is therefore
fetched without it.

| Stage | Populate | When |
|---|---|---|
| `fetchResourceList()` | `title`, `slug`, `publishedDate`, category, tags | on tab open |
| `fetchAllResources()` | the above **plus** full `content` | only once Run/Write is triggered |

Both paginate at 100 per page with a 150 ms pause between pages.

### 4.2 Run

```
fetchTaxonomy() + fetchAllResources()
  → classifyAll(resources, taxonomy, { slugs })     serial, one claude -p each
  → computeDuplicates(resources)  filtered to targets
  → upsertResults(...)  → data/resource-checks.json
  → one JSON line to stdout
```

`computeDuplicates` receives the **full corpus**, not just the selection.
Cross-page boilerplate detection needs every resource in order to know a block is
repeated elsewhere; the result is filtered to the targets afterwards.

### 4.3 Write

Same classify step, then `applyRows()`. Duplicates are not computed — nothing
ever writes a duplicate finding, so computing them would be wasted time.

---

## 5. Classification

### 5.1 Prompt

`buildPrompt()` embeds:

- Every allowed **category** as `slug — name`.
- Every allowed **tag**, grouped by its first `tag_group`.
- The article: title, excerpt, and flattened body, truncated to **12 000 chars**.
- A framing line: CancerFax is a specialist cancer patient-navigation and
  advanced-treatment-access platform, never "generic medical tourism".
- **How many tags to pick**, and when. Stating the range alone clustered output
  near the top of it: across the first 65 classified resources, 63% got 4 tags
  and 25% got 5, with only 12% at 3 or fewer. The count tracked the range, not
  the article. The prompt now says what each count means — 3 for a single-topic
  article, 4 for a clear second dimension, 5 only for genuinely five distinct
  facets — and forbids padding.

Required output:

```json
{
  "categorySlug": "<one slug from ALLOWED CATEGORIES>",
  "tagSlugs": ["<3 to 5 slugs from ALLOWED TAGS>"],
  "rationale": "<one short sentence explaining the fit>"
}
```

The taxonomy is fetched **live on every run**, never from a local snapshot, so a
tag added in Strapi this morning is available this afternoon.

### 5.2 Validation — the hard gate

`validateClassification()` rejects, in order:

| Check | Failure reason |
|---|---|
| `categorySlug` present and in the live category set | `unknown-category` |
| `tagSlugs` is an array | `tags-not-array` |
| 3 ≤ unique tag count ≤ 5 | `tag-count:<n>` |
| every tag slug in the live tag set | `unknown-tag:<slugs>` |

On failure the prompt is re-sent **once**, with the failure reason appended and
an instruction to use only the allowed slugs. Still failing → the row is marked
`needs-manual-review` and `applyRows` skips it as `skipped:not-ok`.

`MAX_TAGS = 5` is a hard cap regardless of model output.

**Nothing that fails validation is ever written.** This is the single most
important property of the feature.

---

## 6. Duplicate-content detection

Pure computation over the flattened corpus. Three finding types:

| Type | Definition |
|---|---|
| `within-page-exact` | two sections of one article normalise to identical text |
| `within-page-near` | word-set Jaccard similarity ≥ **0.9** |
| `cross-page-boilerplate` | identical text appears in ≥ **5** different articles |

Sections shorter than **40 chars** after normalisation are ignored — short
headings and CTAs are too generic to be meaningful.

Jaccard over word sets is deliberate: cheap, deterministic, no external NLP
dependency, and sufficient to catch a lightly-reworded CTA.

Findings are **reported only**. They surface as a Duplicate? badge, a filter, and
a report column. Remediation is a human decision.

**The audit only runs on a Run batch.** A Write never computes duplicates —
nothing writes a duplicate finding, so the scan would be wasted. The store
therefore records `duplicateChecked` alongside the findings: without it,
"audited, found nothing" and "never looked" are both `hasDuplicate: false`, and
a report would show a confident **No** for a check that never happened. The
shared `Duplicate` column is `Yes` / `No` / **blank**, where blank means the
audit has not run for that row.

---

## 7. Writing to production

### 7.1 Two authentication paths

| Condition | Path | `updatedBy` attributed to |
|---|---|---|
| admin email + password set | `POST /admin/login` → JWT → `/content-manager/...` | that admin user |
| otherwise | API token → `/api/resources/...` | whoever generated the token |

Strapi's admin pipeline stamps `createdBy`/`updatedBy` from `ctx.state.user`.
The public token-based `/api/*` layer has no admin-user concept at all, so token
writes always attribute to the token's creator, never the person running the
review. Admin credentials exist purely to make Strapi's edit history honest.

The admin login happens **once per batch** and the JWT is reused. Login failure
logs a warning and falls back to token writes rather than aborting.

Via content-manager the two operations are separate calls — update, then
publish. There is no `?status=published` shortcut on that endpoint.

### 7.2 Confirmation

`action: "write"` alone returns **400**. The client must also send
`confirmWrite: true`, which the UI sets only when the reviewer ticks:

> I understand Write modifies PRODUCTION (category + tags only — duplicate
> content is never written).

The Write button stays disabled until then. Writing modifies live public content;
one accidental click should not be enough.

### 7.3 Pacing

Writes are always **sequential** — one resource at a time. The original code
wrote three at once via `Promise.all`, producing clusters of identical
timestamps. Concurrency is no longer configurable at all: it only ever affected
writes, so the UI control, the request field and the `--concurrency` flag were
removed.

A **0.9–4 s pause sits between the update call and the publish call** of each
resource, since a person does not save and publish in the same instant. That is
inside one write, so both modes below keep it.

The gap *between* resources is the operator's choice:

| Mode | Gap | Button |
|---|---|---|
| **Paced** (default) | your minutes ±20%, redrawn each time | `Write paced (N)` |
| **Fast** | none | `Write fast (N)` |

The minutes box defaults to **8**, is bounded to 0.5–60, and resets on reload —
the value is visible before every production write rather than remembered
invisibly. The ±20% jitter matters: a dead-regular cadence has as clear a machine
signature as no gap at all.

Measured cost, using a median classify time of **9 s/resource** (n=52, from
consecutive `checkedAt` values in a real batch):

| Selected | Fast | Paced at 8 min |
|---|---|---|
| 10 | ~2 min | ~1.2 h |
| 25 | ~4 min | ~3.2 h |
| 50 | ~8 min | ~6.5 h |

Two consequences follow from paced mode, and both are handled: the batch cannot
run inside an HTTP request (§3.1), and it must persist as it goes rather than at
the end (§9).

**Fast mode exists because pacing has a cost beyond time.** A batch that fails
systemically fails silently for hours — see §7.5. Repairing those rows is work
that was going to happen anyway, so spacing it out buys nothing.

`normalizeGapMinutes()` clamps the value in **both** the API route and the
runner. The important guard there is on the *form* of the input, not the range:
`Number(null)`, `Number("")`, `Number([])` and `Number(false)` are all `0`, and
`0` means "write as fast as Strapi will accept". Only an explicit numeric zero
selects fast mode; anything missing or malformed falls back to the paced default.
A unit test pins this.

### 7.4 Self-imposed write rate limit

Strapi does not rate-limit authenticated REST writes — only `/admin/login` has a
configured limiter. So the app limits itself:

- **100 writes per rolling 5 minutes.**
- Tracked in `data/.write-rate-limit-state.json`, so the cap holds **across
  separate processes** — each button click spawns a fresh one.
- Checked immediately before each write.
- Over the cap, remaining rows are marked `skipped:rate-limited` and the run
  ends. They are **not queued or silently retried** — re-run later.

Paced mode cannot realistically reach this cap — 100 writes 8 minutes apart is
over 13 hours. **Fast mode can**, at roughly 100 rows, which is exactly why the
cap still applies there. It is the last thing standing between a bug and
hammering production.

### 7.5 Failure guards

Added after a measured incident: **35 consecutive writes failed with
`Strapi admin API error [401]: Missing or invalid credentials`, over 4 hours and
17 minutes**, before anyone noticed. 37 applied against 35 failed — nearly half
of all write attempts to that point were thrown away.

Two causes combined. The admin JWT is fetched **once** at batch start and reused
for the whole run, so a stale token breaks every write; and paced mode means the
evidence arrives one failure every eight minutes.

Both are now guarded:

1. **Re-login and retry once on a 401.** The refreshed JWT is kept for the rest
   of the batch, so an expiry costs one retry rather than the run. If no admin
   credentials are configured at all, the original error is rethrown — that is a
   different problem and a silent retry would hide it.
2. **Abort after 3 consecutive failures**, of any kind, recording
   `abortedReason` in batch state and surfacing it in the progress panel. A
   systemic problem — wrong password, Strapi down, taxonomy wiped — now stops in
   about 30 seconds.

The counter resets on every success, so a run where every other row fails is
treated as a per-resource problem and allowed to continue. Only an unbroken run
of failures looks systemic.

### 7.6 Write outcomes

Every row ends with a `write_status`:

| Value | Meaning |
|---|---|
| `dry-run` | Run only, nothing written |
| `applied` | written and republished |
| `skipped:not-ok` | failed classification validation |
| `skipped:rate-limited` | window full |
| `failed:resource-not-found` | slug no longer in Strapi |
| `failed:stale-taxonomy-slug` | category/tag vanished between classify and write |
| `failed:<message>` | Strapi rejected the write |

---

## 8. Credentials

Three fields: `prod.token`, `adminEmail`, `adminPassword`. Only the token is
required.

- Values are **AES-256-GCM** encrypted at rest in
  `data/strapi-credentials.enc.json`. Plaintext is never written to disk.
- The key comes only from `process.env.RESOURCES_SECRET_KEY`, set in
  `.env.local`, which is never committed.
- Ciphertext **is** committed to this private repo. Without the key it is inert,
  and committing it means a fresh clone needs one env var rather than a
  re-entry of every secret.

Two routes, deliberately separate:

| Route | Returns |
|---|---|
| `GET /api/resources/credentials` | field name, `isSet`, masked preview — never plaintext |
| `POST /api/resources/credentials/reveal` | plaintext, one field, on explicit request |

The split means a routine status poll can never leak a secret. Plaintext is
returned only in direct response to a Reveal click.

If the key is missing or wrong, `listFieldStatus()` reports the field as set —
so the UI does not offer to overwrite it — with the masked value
`(set — can't decrypt without RESOURCES_SECRET_KEY)`.

**Deployment assumption:** this app runs on `localhost` for one operator. No API
route authenticates its caller. It must not be exposed on a network interface.

---

## 9. Persistence

`data/resource-checks.json` — a flat object keyed by slug, holding
`old_category`, `new_category`, `old_tags`, `new_tags`, `status`, `reason`,
`write_status`, the four duplicate fields, and `checkedAt`.

Committed to the repo. It is review state the team shares, not scratch data.

**Every row is written the moment it is final, not once at the end.** A batch
runs for hours (§7.3) and can be stopped, killed, or lost to a restart at any
point. Anything already written to production has to be on disk before that
happens, or the local record silently disagrees with live content.

`upsertResults(classifyRows, auditRows, { auditComputed })` merges a batch,
replacing any prior entry per slug. The `auditComputed` flag matters:

- `true` (a Run) — duplicate fields are recomputed from this batch's findings.
- `false` (a Write) — prior duplicate fields are **preserved**, not reset to
  "no duplicate". A write-only batch never recomputes them.

Per-row persistence means a re-run **rewrites** rows that were already applied.
That is intentional: skipping them would make it impossible to re-classify an
article after its content changed.

Gitignored — all ephemeral local runtime state, none of it a durable record:

| File | Contents |
|---|---|
| `data/.write-rate-limit-state.json` | rolling-window write counter |
| `data/.batch-state.json` | progress of the in-flight batch |
| `data/.batch.log` | the detached runner's stderr |

### 9.1 Batch state

`data/.batch-state.json` is how the detached runner and the UI communicate:
`batchId`, `pid`, `action`, `status`, `phase`, `current` slug, counters
(`classified`, `written`, `applied`, `failed`, `rateLimited`), and `nextWriteAt`
for the countdown.

The API route seeds it — including the pid it got from `spawn` — before
returning, so a poll arriving before the child has booted sees the new batch
rather than the previous one's stale state. The runner then patches it as it
goes, and records a terminal `status` on completion, failure, or SIGTERM.

**Liveness.** A batch whose process vanished without recording a terminal status
— SIGKILL, a crash, a machine restart — would read as `running` forever and
block every future batch. `getStatus()` therefore tests the pid with signal 0
and reports `interrupted` when it is gone.

**One at a time.** `POST /api/resources/run` returns 409 if a batch is already
running. Two would interleave writes to the same slugs and race on this file.

**Stop** signals the process *group* (negative pid). The runner is spawned
detached so it leads its own group, which is what lets its in-flight `claude`
child die with it instead of being orphaned. Rows already written stay written —
nothing is rolled back.

---

## 10. UI

### 10.1 Resource list

TanStack table, row id = slug, client-side filtering and pagination.

| Control | Behaviour |
|---|---|
| Search | title, category, or tag substring |
| Status | all / checked / not-checked / needs-review |
| **Write status** | all / applied / failed / skipped / classified-not-written / never run |
| Duplicate | all / yes / no |
| Category | any live category |
| Rows per page | 50 (default) / 100 / 200 / 500 / All |

Every row shows the **change**, not just the outcome: category renders as
`old → new` when the classifier proposes something different, tags list the
proposal with a `was:` line beneath, and the classifier's rationale appears
under the title. Those three values were all being stored and none were visible,
which left nothing to actually review.

Write-status badges are coloured by outcome (applied green, failed amber) and
truncated with the full value on hover, so a long `failed:<strapi message>`
cannot stretch the column.

Changing any filter resets to page 1, so the view is never an empty page.

**Select-all is page-scoped, not table-scoped.** Each selected row triggers a
real `claude -p` call; a table-wide select would silently commit to hundreds.

Columns: Resource (title + slug, linked to the live URL), Category, Tags,
Duplicate?, Which content, Write status.

Export CSV runs client-side over the **filtered** rows, no server round trip.

### 10.2 Tagging workbook

`output/resources/resources-tagging.xlsx` — the team's hand-kept tagging sheet,
now generated. **Update workbook** rewrites it from the rows the browser holds.

It is a **report**: every cell is regenerated on each export and nothing typed
into it is ever read back. That is the whole contract, and it is what keeps the
feature free of merge rules.

**Two shapes, one row set.** The committed file keeps the full record; what
leaves this machine is narrower:

| Output | Rows | Columns |
|---|---|---|
| `output/resources/…xlsx` (committed) | all live | **16** — full record |
| Downloaded `.xlsx` | all live | **9** — shared |
| `Export CSV` | filtered | **9** — shared |

Both are built from the same `rows` inside one request, so they can differ in
how much they show but never in what they say. The shared shape is
`SHARED_HEADER` / `toSharedRows()` in `resource-reports.ts`, rendered to xlsx by
`buildSharedWorkbook()` and to CSV by `toCsvFromCells()` — one definition, so
the two shared files cannot disagree.

```
S.No · Title of Resource · Slug · Category ·
Old Category · New Category · Old Tags · New Tags · Duplicate
```

Dropped from the shared copies: `Status`, `Write Status`, `Reason`,
`Duplicate Section`, `Duplicate Content`, `Live URL`, `Checked At`. All of it is
operational detail that matters on this machine and not to a reviewer.

Two rules in the shared shape:

- **`New Category` / `New Tags` fill as soon as the classifier proposes them**,
  written or not. These files are review documents — "here is what we intend".
  A proposal that never reached production is therefore indistinguishable from
  one that did, which is exactly why the committed workbook keeps `Write Status`.
- **`S.No` renumbers from 1 per file.** It is a visual counter, not an identity —
  slug is. The CSV holds only the filtered rows, so carrying the workbook's
  number over would produce a column full of gaps.

| Decision | Choice |
|---|---|
| Rows | Every live resource, **ignoring UI filters** |
| Ordering | Title, `localeCompare`; `S.No.` renumbered 1–N |
| Trigger | The button only — never automatic |
| Data source | The browser, so the sheet matches what was on screen |
| Git | Committed |
| Download | Yes — the same response also saves a dated copy |

The route responds with the `.xlsx` **bytes**, not JSON, so the downloaded copy
and the committed file are byte-identical by construction; rebuilding it
client-side would let the two drift the moment the mapping changed. Row count
and repo path ride along in `X-Workbook-Rows` / `X-Workbook-Path` headers for
the toast. Errors still respond as JSON, so the client branches on content-type.

The download is dated (`resources-tagging-2026-07-29.xlsx`) while the repo file
keeps the undated canonical name — repeated downloads then don't pile up as
`… (1).xlsx`, and each saved copy records when it was taken. The trade-off
accepted here is that a downloaded copy goes stale as soon as the next export
runs; the repo file is the one to trust.

Columns A–E preserve the shape of the sheet the team already kept; F–P add the
review detail it had no room for:

| Col | Header | Source |
|---|---|---|
| A–C | `S.No.` · `Title of Resource` · `Slug` | live list |
| D | `Status` | Excel **boolean** — true only when `write_status === "applied"` |
| E | `Category` | proposal if classified, else what's live |
| F–I | `Old`/`New Category`, `Old`/`New Tags` | the change under review |
| J–K | `Write Status`, `Reason` | outcome and rationale |
| L–N | `Duplicate?`, `Duplicate Section`, `Duplicate Content` | audit findings |
| O–P | `Live URL`, `Checked At` | — |

Column D is deliberately true **only** for `applied`. A row that was attempted
and failed reads FALSE with the reason in `Write Status`, so the column answers
"is production correct?" rather than "did we try?". Rows never classified get
blanks from F onward instead of echoing live values into columns that describe a
proposed change.

**Writing is atomic** — to a `.tmp` beside the target, then `rename`. A crash
mid-write can never leave a truncated workbook where the good one was. An empty
`rows` array is rejected rather than silently replacing the file with a header.

Two known limits, both accepted:

- SheetJS's community build writes column widths but **not** freeze panes or
  autofilter, so those are absent rather than silently doing nothing.
- On macOS the write succeeds even while the file is open in Excel, but Excel
  shows stale content until reopened. The success toast says so.

Before starting, a selection of more than one shows its estimated write
duration, so a three-hour batch is a decision rather than a surprise.

### 10.1a Batch progress

Because a batch outlives the request — and usually the browser tab — the panel
has to answer "is it still going, how far in, and when does the next write
land" without a spinner:

- Phase, status badge, and a prominent `n / total` count with a progress bar.
  The count is the headline, not a footnote — it is the question the panel
  exists to answer.
- Applied / failed / rate-limited counters during a write.
- What is running **now** versus the last thing finished, a countdown to the
  next write, and an estimate of time remaining.
- **Stop** while running, **Dismiss** once finished.

The progress bar carries `role="progressbar"` with `aria-valuenow`/`min`/`max`
and a label, so the count is available to a screen reader rather than being
conveyed by bar width alone.

**Per-row state.** The summary panel alone cannot say *which* resources are
done. Rows belonging to the running batch are marked `working…` (highlighted),
`queued`, or left plain once finished:

| Phase | How "done" is determined |
|---|---|
| classifying | `checkedAt >= batch.startedAt` |
| writing | `write_status !== "dry-run"` |

The two rules differ because classification stamps `checkedAt` on every row
before writing begins — a timestamp check during the write phase would report
the whole batch finished before a single write had happened.

This is also why the runner tracks `current` (in flight now, cleared while
idle) separately from `lastDone`. A single field would mark the last finished
row as active throughout each 5–10 minute gap.

The UI polls every 5 s while a batch is running, refreshing both progress and
the persisted results, so rows flip to their new category and tags as each one
lands. It also polls once on mount: a batch may have been started before this
tab was opened, or still be running after a reload.

### 10.2 Taxonomy

A manual **Fetch live taxonomy** button — not auto-loaded — showing categories
and tags with their groups, filterable and exportable. It answers "what is the
classifier allowed to choose from?"

### 10.3 Credentials

One row per field: masked value, Reveal/Hide, Set/Update. Password inputs.

---

## 11. Known defects

Found in review on 2026-07-28, after the commit.

### Fixed

| # | Defect | Resolution |
|---|---|---|
| 2 | A 10-minute route timeout could kill the process mid-write, and `upsertResults` ran only at the end — so a timeout during Write left production writes with no local record. | The batch is detached with no request timeout at all (§3.1), and every row persists the moment it is final (§9). |
| 3 | Concurrency was unbounded: neither the input nor the route capped it, so a large value burst that many parallel writes at production. | Removed entirely. Writes are strictly sequential and paced (§7.3). |
| 4 | Dry-run broke the live link: `mergeResourceRows` picked `new_category` on classification status, so after a Run every row linked to a URL that did not exist yet. | The link is built from `write_status === "applied"` — the category that is actually live (§10). |
| 5 | No old → new comparison, so a reviewer could not see what was changing. | Table shows `old → new` for category and `was:` for tags; CSV exports both as separate columns (§10). |

Also fixed in the same pass: the classifier's rationale was stored and never
displayed; unbounded duplicate snippets stretched row height; the "All" page-size
option collided with the fixed sizes when the filtered count matched one of them;
and selection surviving a filter change was invisible (now shown with a
Clear selection control).

### Open

| # | Severity | Defect |
|---|---|---|
| 1 | high | **Write re-classifies rather than applying the reviewed values.** `run-resource-check.js` calls `classifyAll` again on Write and never reads `resource-checks.json`. Since `claude -p` is non-deterministic, the value written can differ from the value the reviewer approved, and `upsertResults` then overwrites the store so the difference is invisible. The review gate in §7.2 does not actually gate the classification. Pacing makes this worse: a reviewer now approves values that get rewritten hours later. |
| 6 | low | **Documented CLI usage does not work.** The scripts read `RESOURCES_SECRET_KEY` from the environment and nothing loads `.env.local`; it works through the UI only because Next.js loads it and `execFile` inherits it. |
| 7 | low | **Thin test coverage.** Only the workbook mapping is covered; the classify/audit/rate-limit/batch modules are not. See §12. |

---

## 12. Testing

Two suites so far:

- `resource-workbook.test.ts` — both shapes. Full: sort and numbering, the
  boolean `Status` column and its applied-only rule, blank review columns for
  never-classified rows, live-URL construction, and an xlsx round trip asserting
  the cell keeps type `b`. Shared: the exact 9-column header, that operational
  detail is genuinely absent from the output, renumbering from 1 on a filtered
  subset, and that `Duplicate` is blank until the audit has run.
- `resource-pacing.test.ts` — `normalizeGapMinutes` and `humanGapMs`: the
  coercion guard, clamping, and that jitter actually varies. **This suite caught
  a live bug**: the first implementation returned `0` — fast mode — for `null`,
  `""`, `[]` and `false`, so a malformed value meant "write to production with
  no gap". `--gap-minutes=` with an empty value reached it.

The rest of the feature is still uncovered. These are pure and trivially
testable:

| Function | What to assert |
|---|---|
| `validateClassification` | rejects unknown category, unknown tag, non-array, <3 and >5 tags; accepts a valid answer |
| `applyRows` | aborts after 3 consecutive failures; the counter resets on success; a 401 triggers exactly one re-login |
| `checkAndRecordWrite` | allows up to 100, blocks the 101st, expires entries past the window |
| `upsertResults` | `auditComputed: false` preserves prior duplicate fields; `true` recomputes them |
| `computeDuplicates` | exact vs near within-page, 5-resource cross-page threshold, 40-char floor |
| `mergeResourceRows` | proposed vs applied values, link construction |
| `resolveTargets` | slugs take priority over limit |
| `humanGapMs` | every draw lands within 5–10 min |
| `getStatus` | a running batch with a dead pid reports `interrupted` |

---

## 13. Out of scope

- Staging environment support.
- Auto-remediation of duplicate content.
- Classifying `resource_subcategory`.
- Bulk undo / rollback of a write batch.
- More than one batch at a time.
- Resuming a stopped batch automatically — re-select and re-run instead.
- Authentication on the API routes.
