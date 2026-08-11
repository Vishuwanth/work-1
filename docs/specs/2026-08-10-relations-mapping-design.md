# Design: AI-mapped cross-content-type relations (the Relations tab)

**Date:** 2026-08-10 (revised 2026-08-11 — schema-registry rewrite, scope
expanded from 10 to 38 content types, then `faq` excluded → 37; corpus/
discovery caching added, §3.3; Run pacing + Excel review workbook added,
§7.1 and §10.1)
**Status:** as-built — written after implementation
**Scope:** the new Relations tab of the review app, and the `lib/relations/` +
`scripts/` code behind it. Also extracts `lib/ai-cli.js` out of
`lib/resources/classify.js` (no behavior change) so both AI pipelines share
one `claude -p` transport.

---

## 1. Problem

CancerFax's Strapi CMS defines content types this app had never touched
before this feature. The first version of this design discovered 10 of them
live by probing candidate routes; reading the actual `cancerfax-strapi-backend`
repo's `schema.json` files directly (§3.2) found the true number: 38 content
types worth mapping relations between — patient-facing pages (`treatment`,
`condition`, `doctor`, `hospital`, `drug`, `clinical-trial`,
`survivor-story`, `guide`, `insight`, `resource`, `access`, `ranking`,
`diagnostic`, `service`, …) *and* taxonomy/hub types (`cancer-type`,
`treatment-modality`, `biomarker`, `specialty`, `tag`, `category`, …) that
turned out not to be flat label lists at all — `cancer-type` and
`treatment-modality` are full topic-hub pages with their own curated lists of
related treatments, doctors, hospitals, insights, guides, drugs, clinical
trials, and survivor stories. Relations depend on these taxonomy types as
much as on the "main" content types, which is why they're in scope too.

One of those 38, `faq`, was dropped shortly after: 1,180 individual Q&A
snippets — more than `resource` and `insight` combined — none of which is a
page a patient reads and follows links from. It dominated every batch count
without being valuable to map (see §3.2's exclusion list for the full
rationale). **37 content types, ~3,400 entries** is the actual working
scope.

Most of these 37 types already carry real Strapi **relation fields** to each
other — `treatment.conditions`, `condition.recommended_doctors`,
`drug.related_guides`, and well over a hundred more across the registry —
but the large majority sit empty. The schema for cross-linking content
already exists; the content itself mostly isn't linked yet.

Building that by hand means a reviewer reading, say, a treatment page and
manually deciding which of ~3,400 other entries across 36 other content
types it should reference. Slow, and easy to miss an obviously relevant
condition or doctor page that exists but wasn't top of mind.

### Existing prior art

The Resources tab (`lib/resources/*`, see
`docs/specs/2026-07-28-resources-classification-design.md`) already
classifies `resource_category`/`resource_tags` with `claude -p`, behind a
Run→Write gate, paced writes, a self-imposed rate limit, and a hard
validation gate. This feature is structurally the same pipeline, generalized
across every registered content type and augmented with live web search.

---

## 2. Goals

1. Know, precisely, which content types Strapi serves and which of their
   fields are relations — from the schema itself, not a guess.
2. Show a reviewer, per entry, what's **currently** related (as Strapi
   actually has it) and what an AI pass **proposes** adding — grounded in
   both the entry's own content and the corpus of every other CancerFax
   entry, with Claude allowed to use WebSearch to judge medical/factual
   soundness.
3. Never propose a link to a page that doesn't exist, and never propose a
   relation whose target is the wrong content type for that field — both are
   hard, structural gates (§6), not judgment calls.
4. Write proposals back to Strapi only for relation fields confirmed to
   exist, behind the same production-write safety net the Resources tab
   already established (confirmation checkbox, pacing, shared rate limit,
   abort-after-failures).
5. The app runs from a fresh clone of this repo for its normal (live-Strapi)
   operation — no sibling checkout, no new secrets. Regenerating the schema
   registry (§3.2) is the one operation that does need a local checkout of
   `cancerfax-strapi-backend`, and is a deliberately rare, manual dev-tool
   step, not something the running app depends on.

### Non-goals (YAGNI)

- **Admin-JWT writes.** Resources' admin-JWT path targets a UID
  (`api::resource.resource`) confirmed over months of use. Guessing that UID
  for 37 content types this app has never written to is exactly the kind
  of assumption a first Write pass shouldn't carry — see §8.
- **Schema changes.** If a genuinely useful relation has no backing field,
  it's surfaced as a report-only `see_also` suggestion. Adding a Strapi field
  is a backend-repo change, out of scope here.
- **Semantic search / embeddings** for candidate ranking — see §5's keyword
  heuristic and its documented limitation.
- **Live admin-API schema introspection.** An early draft of discovery used
  Strapi's admin `content-manager/content-types` endpoint at runtime (it
  works, and is how the true 38-type list was first confirmed — see §3.2).
  The shipped version instead reads a **committed, pre-generated** registry:
  no admin credentials required at runtime, no ~30-second live schema call
  on every "Discover" click, and the registry is reviewable, diffable
  checked-in JSON rather than a live side-effect of who happens to have
  admin credentials configured.

---

## 3. Architecture

```
components/app-shell.tsx
  └── Tabs: FAQs | Resources | Hospitals | Doctors | 🔗 Relations
        └── RelationsTab
              ├── Relations      → RelationsListPanel   (browse, current + proposed relations, Run/Write)
              └── Content types  → RelationsContentTypesPanel (registry + live entry counts)
```

Same script-as-subprocess model as Resources: API routes spawn a Node
script and either await it (cheap reads) or spawn it detached (the paced
Run/Write batch).

| Route | Behavior |
|---|---|
| `GET /api/relations/discover` | `node scripts/discover-content-types.js` — always forces a live re-fetch (§3.3), ~1 min |
| `GET /api/relations/list` | `node scripts/list-relation-entries.js` — cache hit: near-instant. `?refresh=true` forces a live re-fetch, ~55s for ~3,400 entries |
| `POST /api/relations/run` | spawns `scripts/run-relation-check.js` DETACHED, returns 202. `{ refresh: true }` in the body forces a live re-fetch first |
| `GET/DELETE /api/relations/batch` | progress / stop, mirrors the Resources route exactly |
| `GET /api/relations/checks` | reads `data/relation-checks.json` directly |

### 3.1 Module layout

| Path | Responsibility |
|---|---|
| `lib/ai-cli.js` | **extracted from** `lib/resources/classify.js`: `callClaude`, `describeModelOutput`, `balancedObjects`, `blockingHookName` — the brace-balancing JSON-envelope parser, now shared by both AI pipelines. `callClaude(prompt, opts)` gained `opts.allowedTools` (forwarded as `--allowedTools`) and `opts.isShaped` (a predicate, replacing the hardcoded categorySlug/tagSlugs check). `lib/resources/classify.js` keeps its old exact behavior via two one-line wrappers. |
| `scripts/generate-relation-schema.js` | **Dev tool, not part of the running app.** Reads `schema.json` files from a `cancerfax-strapi-backend` checkout and emits `lib/relations/schema-registry.json` — see §3.2. |
| `lib/relations/schema-registry.json` | **Committed.** The ground-truth content-type + relation-field registry, generated by the script above. This is what the running app actually reads. |
| `lib/relations/discovery.js` | Loads the registry; live-confirms each type still exists and refreshes its entry count — see §4. |
| `lib/relations/corpus-cache.js` | `getCorpus({forceRefresh})` — the ONE place that decides live-fetch vs. cache-read; see §3.3. |
| `lib/relations/cache-store.js` | Reads/writes `data/.relations-cache.json` — plain file I/O, no policy. |
| `lib/relations/shared.js` | `fetchEntryList`/`fetchCorpusIndex` (cheap, list-shaped — called by corpus-cache.js, not directly by scripts), `fetchEntryByDocumentId` (expensive, `populate=*`, always live), `flattenEntryText` (generic deep-text-walk), `entrySlug` (documentId fallback for the handful of types with no `slug` field), `currentRelations`/`buildCorpusLookup`. |
| `lib/relations/classify.js` | `buildPrompt`, `buildVocabulary`, `selectCandidates`, `validateRelations`, `mapEntry` — see §5-6. |
| `lib/relations/write.js` | `applyRelations` — see §8. |
| `lib/relations/checks-store.js` / `batch-store.js` | Own state files, structurally identical to the Resources versions (`data/relation-checks.json`, `data/.relations-batch-state.json`). |
| `lib/relation-reports.ts` | Pure, client-safe row merging (`mergeRelationRows`) — the relations analogue of `lib/resource-reports.ts`. |

### 3.3 Caching — fetch once, keep it

The corpus fetch (§5) is the expensive part of this feature: ~55s across
~3,400 entries in 37 content types. Before caching, **every** Run, every
Write, and every Relations-tab page load re-paid that cost in full — mapping
a single entry cost the same ~55s corpus fetch as mapping a hundred.

`lib/relations/corpus-cache.js`'s `getCorpus({forceRefresh})` is now the only
way any script reaches Strapi for the content-type list or corpus index:

- **Cache hit** (the default): reads `data/.relations-cache.json` — a file
  read, no network calls at all. Confirmed live: a `list-relation-entries.js`
  call dropped from **52s to 0.06s** (~900×) on a cache hit, and a
  `run-relation-check.js` batch dropped from ~105s to ~52s (the remaining
  time is entirely the `claude -p` call itself).
- **Cache miss or `forceRefresh: true`**: fetches live (`discoverContentTypes`
  + `fetchCorpusIndex`) and overwrites the cache file with the result plus an
  `updatedAt` timestamp.

**No TTL — a deliberate choice, not an oversight.** This is a single-operator
local tool; staleness is something the operator notices and fixes with a
click, not something the system should silently guess an expiry for. Three
explicit refresh paths exist:

1. The Relations tab's **"Refresh (re-fetch from Strapi)"** button
   (`?refresh=true` on `GET /api/relations/list`).
2. The Content Types tab's **"Discover + refresh cache"** button — this one
   *always* forces a refresh (its whole purpose is "tell me what's current
   right now"), so it doubles as the corpus cache's refresh trigger too.
3. `POST /api/relations/run` accepts `{ refresh: true }` for one-off "map
   this with guaranteed-fresh candidates" runs without visiting the list
   first.

The UI shows `Cached · <n>m ago` (or `Fetched fresh` right after a refresh)
next to the Run/Write buttons, and the Content Types panel shows the same
timestamp — staleness is visible, never hidden.

**What is never cached, on purpose**: `fetchEntryByDocumentId` — the full
`populate=*` body of the specific entry actually being mapped — is always
fetched live. Caching the *candidate list* is safe (worst case, a brand-new
page isn't linkable until the next refresh); caching the *content the model
reasons about* would not be — the whole point is judging current content.

`data/.relations-cache.json` is gitignored (large, fully derived, stale the
moment anyone edits Strapi content) — see `.gitignore`.

### 3.2 Why a generated registry, not live probing

The first version of `discovery.js` had no schema source at all: it guessed
10 candidate plural routes, sampled live entries, and inferred which fields
were relations by sniffing populated shapes — a second probe pass for
fields that were empty in the sample, a name-pattern check to tell a media
field from a real relation, and so on. It worked, but every one of those
heuristics was a place to be wrong, and it had no way to discover a content
type it hadn't already guessed the name of.

Reading `cancerfax-strapi-backend`'s own `schema.json` files removed the
guessing entirely. A relation attribute states its exact shape:

```json
"conditions": { "type": "relation", "relation": "manyToMany", "target": "api::condition.condition" }
```

— field name, cardinality, and target content type, all explicit. This is
what `scripts/generate-relation-schema.js` reads (from
`src/api/*/content-types/*/schema.json`, one directory per content type) to
produce `lib/relations/schema-registry.json`. Per content type, it records:

- `apiId`, `plural`, `displayName`
- `titleField` — from the `uid` (slug) field's `targetField`, i.e. whichever
  field Strapi actually slugifies from. Ground truth, not a guess; falls
  back to a short candidate list (`title`, `name`, `question`, …) only for
  the few included types with no `uid` field at all (`country`, `tag` — `faq`
  was the third, before it was excluded, §3.2 below).
- `lastNameField` — set only when the title fallback picked `first_name`
  and a `last_name` field also exists (`doctor`), so the display title can
  join both instead of showing half a name.
- `slugField` — `null` for the few types with no `uid` field (`country`,
  `tag`); `lib/relations/shared.js`'s `entrySlug()` falls back to
  `documentId` for these, which is what the rest of the feature's identity
  system (`${contentType}/${slug}`) actually keys on.
- `excerptField` — best-effort short-text field, if the type has one.
- `relationFields[]` — `{ field, cardinality, targetApiId, private, nonContent }`.

**Content types excluded entirely** (never a mappable source or a link
target, regardless of what relations they declare):

| Category | Excluded | Why |
|---|---|---|
| Patient PII / leads | `contact-submission`, `cost-calculator-lead`, `patient-intake`, `clinical-trial-intake`, `subscriber` | Contact details, medical intake forms, mailing-list signups — never content to link to or feed to a prompt. |
| Operational | `crm-sync-log` | An audit log, not content. |
| Site plumbing | `menu-item`, `redirection` | Navigation/routing structure, not content with meaning to a patient. |
| Singleton config | `cancerfax-help-config`, `global`, `resource-tag-config` | Strapi `singleType`s — one config record, not a corpus of entries. Excluded generically (`schema.kind !== 'collectionType'`), not by name. |
| No content identity | `location` | No `uid` slug and no plain string field either (only `seo`/`isActive`/`contact`/`address` components) — nothing to title an entry with, zero relations declared, never referenced by anything else. |
| Wrong grain | `faq` | 1,180 individual Q&A snippets — more than `resource`+`insight` combined — none of which is a page a patient reads and follows links from. Dominated every batch count without being worth mapping. Its two relation fields (`category`, `tags`) were FAQ taxonomy, not content links either. |

**One relation field excluded on every type regardless of target**:
`author` (`nonContent: true`) — who wrote a page is an editorial assignment,
not a relevance judgement the model has any principled basis for making.
Still shown under "current relations" (so a byline resolves to a name), just
never a proposal target — see `buildVocabulary` in §5.

Re-run `node scripts/generate-relation-schema.js --backend="/path/to/cancerfax-strapi-backend"`
whenever the backend schema changes; the output is deterministic and
committed, so a diff on `schema-registry.json` is a readable record of what
changed. The running app never reads the backend repo itself — only this
generated file.

---

## 4. Discovery — registry + a live liveness/count check

`lib/relations/discovery.js` loads the registry and, for each of its 38
entries, makes one cheap live call (`GET /api/<plural>?pagination[pageSize]=1`)
to confirm the route still exists and to get a current entry count. A 404
means the registry is stale for that type (renamed/removed backend-side
since generation) and it's silently dropped from the result — the schema
*structure* doesn't need re-verifying on every call, but *existence* and
*counts* do, since those change without a schema change.

**Any other error (missing token, 401, network failure) propagates**
rather than being treated as "doesn't exist" — a misconfigured token must
never read as "this app has zero content types" instead of "credentials are
broken". (This exact conflation was a real bug in an earlier version of this
file, caught before it shipped.)

`isRelationValue`/`isMediaEntry`/`isInternalField`/`SENSITIVE_FIELD_NAME_RE`
remain in this module even though they're no longer used to *detect*
relation fields (the registry does that now) — `lib/relations/shared.js`
still needs them to tell a relation/media subtree apart from prose when
deep-walking a fully-populated entry for `flattenEntryText`.

Live result (2026-08-11): all 38 registered types resolved, **4,592 entries
total** — before `faq` (1,180 entries) was excluded (§3.2), leaving **37
types and 3,436 entries**. `resource` (742) and `insight` (553) are now the
two largest, and are exactly why `selectCandidates` (§5) ranks rather than
including every candidate for every prompt.

---

## 5. Corpus + prompt

Two-stage fetch, same principle as Resources' `fetchResourceList`/
`fetchAllResources`:

- **Cheap, corpus-wide**: `fetchCorpusIndex` gets every entry's title/slug/
  excerpt (a handful of schema-verified fields — see `pickListFields`, which
  must ask Strapi for exactly the fields a given type has: an unknown
  `fields[]` name 400s the whole request, so this can't be a fixed guessed
  list) across all 37 types — ~3,400 entries, ~55s live. This is the pool of
  legitimate link targets. As of §3.3 it's no longer fetched fresh on every
  batch — `lib/relations/corpus-cache.js` serves it from a persistent cache
  by default, so this cost is paid once and reused until an explicit refresh.
- **Expensive, per-target, always live**: `fetchEntryByDocumentId`
  (`populate=*`) only for the entries actually selected to be mapped — never
  cached, since the model must always reason over current content (§3.3).

**Candidate selection** (`selectCandidates`): a content type with ≤60
entries is shown to the model in full; a larger one (`faq`, `resource`,
`insight`, `condition`, `doctor`) is ranked by simple keyword overlap
between the entry being mapped and each candidate's title+excerpt, top 60
kept. This is a plain heuristic, not semantic search — a known
simplification. A future version could embed titles/excerpts once and rank
by cosine similarity instead.

**Relation-type vocabulary is not hand-invented.** An earlier draft of this
design used an abstract taxonomy (`treats`, `performed_by`, `see_also`).
The schema registry showed CancerFax's own Strapi already defines a much
more precise vocabulary — the real field names themselves
(`treatment.conditions`, `condition.recommended_doctors`, …), each with an
**exact** target content type from the schema, not a guess. Using the field
name as `relationType` means a proposal is automatically the same shape as
a current relation, and directly writable where the field is real.
`buildVocabulary(typeConfig)` excludes fields another feature reserves
(`resource_category`/`resource_subcategory`/`resource_tags`) and the
`author` field (§3.2), and always adds `see_also`: a generic,
always-report-only bucket for a genuinely useful link with no backing
field.

`buildPrompt` gives the model: the target entry's flattened text (generic
deep-text-walk over the whole entry, skipping relation/media subtrees and
internal fields — `flattenEntryText`, capped at 12,000 chars, same cap as
Resources' `flattenResourceText`), its current relations (so the model
never re-proposes them), the vocabulary (each field annotated with its
**exact** target type from the schema — `recommended_doctors (target type:
doctor)`), and the candidate list. Explicit instructions: `relationType` is
the field name, never the target's content type (a model that wants to link
to a `guide` page but has no guide-specific field should use `see_also`,
not invent a `relationType` named `"guide"` — an early live run showed this
happening: harmless, since `validateRelations` rejected every one, but
wasteful); and WebSearch may inform judgment but every `targetSlug` must be
copied from the candidate list — never an external URL, never an invented
page.

---

## 6. Validation — the hard gate

`validateRelations` differs from Resources' `validateClassification` in one
structural way: **a relations reply is a list, not a single required value**,
so an individually-invalid proposal is dropped rather than failing the
whole reply. The overall result only fails outright if the reply isn't even
shaped like `{ relations: [...] }`.

Per-proposal checks, in order:

| Check | Rejection reason |
|---|---|
| `relationType` is a string in the vocabulary (or `see_also`) | `unknown-relation-type:<x>` |
| the target's content type matches the field's schema-declared `targetApiId` (skipped for `see_also`, which has none) | `target-type-mismatch:expected <x>, got <y>` |
| `targetContentType`+`targetSlug` resolves in the fetched corpus | `target-not-in-corpus` — the core anti-hallucination gate |
| not the entry relating to itself | `self-relation` |
| not already a current relation | `already-current` |
| not a duplicate within the same reply | `duplicate-in-reply` |

The type-mismatch check is new in the schema-registry rewrite and is a
**hard structural fact**, not a heuristic: a Strapi `manyToMany` field is
declared against exactly one target model, so a `conditions` field can
never legitimately point at a `doctor`. Earlier drafts only had a
name-based *hint* here (`guessTargetContentType`), never an enforced
constraint, because there was no ground truth to enforce against.

**Nothing failing `target-not-in-corpus` is ever written or even reported as
proposed** — this is the single most important property, mirroring
Resources' "nothing failing validation is ever written."

---

## 7. Claude invocation (WebSearch)

```js
callClaude(prompt, { allowedTools: ['WebSearch'] })
// → execFile('claude', ['-p', prompt, '--allowedTools', 'WebSearch', '--output-format', 'json'], ...)
```

Confirmed via the Claude Code CLI docs: WebSearch is **not** auto-approved
in `-p` mode — omitting `--allowedTools` would leave the model unable to
search at all, not merely slower. `--bare` is deliberately not used: it
requires `ANTHROPIC_API_KEY`, and this whole app runs on the logged-in
`claude` CLI subscription with no API key anywhere (see README.md).
`--output-format json` still returns one envelope with `result` as the
final text even when WebSearch calls happened in between, so the existing
brace-balancing parser needs no changes.

Verified end-to-end against prod, twice: mapping a `treatment` page
(`treatment/3d-crt`) produced 13 proposals across 5 relation types plus one
`see_also`; mapping a `ranking` page (`ranking/car-t-hospitals-in-china`) —
a content type that didn't exist in this feature's first version —
correctly resolved 16 current relations across 6 different target content
types (author, cancer-type, treatment, condition, country, hospital,
treatment-modality) and proposed 9 valid new relations plus 2 `see_also`
links into the 1,180-entry `faq` corpus, while cleanly rejecting 9
model-invented `relationType`s (`guide`, `insight`, `country-treatment`)
that don't exist as fields on `ranking` — exactly the safety gate working
as designed. Both runs took ~100s including the corpus fetch.

### 7.1 Run is paced too, not just Write

Only Write was paced in the first version — Run mapped every selected entry
back-to-back, on the reasoning that nothing there touches production so
there was nothing to pace *for*. That missed the point: a selection of many
entries all mapped in one unbroken sweep is itself a mechanical signature,
independent of whether anything gets written. `scripts/run-relation-check.js`
now inserts the same jittered `humanGapMs` gap (§8's write pacing, reused
directly) between each entry during a Run, skipped only for the last entry
and for `--action=write` (whose own pacing already lives inside
`applyRelations`). The **Gap** control in the UI now governs both.

Confirmed live: a 2-entry Run with `--gap-minutes=0.5` took 2m9s total for
two ~35–65s `claude -p` calls plus one ~33s gap between them — the gap is
real, not just configured.

(This surfaced a pre-existing display-only bug, fixed while adding this:
rounding a gap's minutes and seconds independently — `Math.round(gap /
60_000)` and `Math.round((gap % 60_000) / 1000)` — can disagree, e.g. a 33
-second gap printing as "1m 33s" because 33/60 = 0.55 rounds up on its own.
Floor the minutes first, then take the remainder in seconds, the way the
UI's own `formatDuration` already did. Cosmetic only — a stderr log line,
never the actual delay — but worth fixing since it was about to be copied a
third time.)

---

## 8. Writing to production

**One deliberate simplification versus Resources' writer**: writes always
go through the plain API token (`strapiRequest`), never the admin-JWT
content-manager path. Resources' admin path targets a UID
(`api::resource.resource`) confirmed by months of use; guessing that UID
for the other 37 content types this app has never written to before is
exactly the kind of assumption a first Write pass on new content types
shouldn't carry. Trade-off: writes attribute to the token's creator rather
than a specific admin — acceptable for a first version, revisit once each
UID is confirmed.

**Never re-classifies on Write.** `scripts/run-relation-check.js`'s
`--action=write` branch reads the **persisted** `proposedRelations` from
the most recent Run for each targeted key and applies exactly those — it
does not call Claude again. This is a direct fix for a defect Resources'
own design doc records as still open there (§11 defect #1 in
`2026-07-28-resources-classification-design.md`): re-classifying on Write
let a non-deterministic `claude -p` output silently diverge from what a
reviewer actually approved. A Write with no prior Run for a key fails that
entry with `failed:not-yet-run` instead of mapping it fresh.

**Additive, never replacing.** `buildRelationBody` unions each writable
field's already-current documentIds with the newly-approved ones — a
relation-suggestion tool must never silently drop a relation someone else
already set. A field with no new proposal for a given row is left out of
the write body entirely.

**Reuses Resources' safety net directly, not a fork of it**:
`checkAndRecordWrite` (the same rolling 100-writes/5-minutes budget — one
shared counter across both features, since it's a Strapi-wide self-imposed
cap, not per-feature), `humanGapMs`/`normalizeGapMinutes` (paced writes,
default 8 min ±20%, fast mode = 0), `MAX_CONSECUTIVE_FAILURES` (abort after
3 in a row). Same UI contract: Write is disabled until the "I understand
this writes to PRODUCTION" checkbox is ticked.

---

## 9. Persistence

`data/relation-checks.json` — committed, keyed by `${contentType}/${slug}`
(not a bare slug — relations span multiple content types, and slugs are only
unique within one; a few types with no real slug field key on `documentId`
instead — see `entrySlug()` in §3.2). Same row-by-row incremental-write
discipline as `resource-checks.json`: a batch can be killed mid-run and
nothing already written to prod is ever missing from the local record.

Gitignored (ephemeral, mirrors Resources exactly):
`data/.relations-batch-state.json`, `data/.relations-batch.log`. The write
rate-limit file (`data/.write-rate-limit-state.json`) is **shared with
Resources**, not duplicated.

---

## 10. UI

`components/relations-tab.tsx`: a TanStack table, one row per entry across
all 37 content types — content type badge, title/slug (linked), current
relations as badges, proposed relations as badges (relation type → target,
rationale on hover, outlined if report-only), write status. Search + status
+ content-type filters, page-scoped multi-select, Run/Write with the same
production-write confirmation checkbox pattern as Resources, and a batch
progress panel polling `/api/relations/batch` + `/api/relations/checks`
every 5s while running.

`components/relations-content-types-panel.tsx`: the registry report — one
manual "Discover" button re-confirms liveness and entry counts (§4); the
field/relation structure itself only changes when the schema registry is
regenerated. Each field is labeled "owned by the Resources tab's classifier"
(reserved), "editorial metadata — not a content link" (`author`), or
"propose + write", and its exact schema-declared target type is shown
alongside cardinality.

### 10.1 Excel review workbook — the step between Run and Write

Reviewing proposals purely in the web table doesn't scale to sharing with a
teammate, printing, or working offline — and more importantly, the intended
workflow is Run → **review** → Write, not Run → Write, so that review step
needed its own artifact. `lib/relation-workbook.ts` +
`app/api/relations/export/route.ts` mirror the Resources tab's existing
export exactly (`lib/resource-workbook.ts` /
`app/api/resources/export/route.ts`): same contract (a REPORT, regenerated
whole on every export, nothing typed into it ever read back by the app),
same atomic write-then-rename to the committed file
(`output/relations/relations-mapping.xlsx`), same "client sends every loaded
row, not the filtered view" rule, same byte-identical repo-copy/download.

Two sheets, not one, because "what's the state of everything" and "should
THIS specific relation actually be written" are different questions:

| Sheet | Grain | Columns |
|---|---|---|
| **Overview** | one row per entry | type, title, slug, current relations (joined), proposed relations (joined), writable-proposal count, status, write status, checked at |
| **Proposed Relations** | one row per *individual* proposed relation | source type/title/slug, relation type, target type/title/slug, rationale, writable?, a blank `Approve (Y/N)` column for the reviewer's own tracking, source write status |

`Approve (Y/N)` is deliberately never read back — approving happens by
selecting rows and clicking Write in the web UI, the same as every other
gate in this feature. The workbook's job is to make that decision informed,
not to be a form.

No "live URL" column, unlike the Resources tab's export: that would require
a verified public-site route per content type, and 28 of the 38 don't have
one confirmed. Omitted rather than guessed.

---

## 11. Testing

`lib/__tests__/relations-discovery.test.ts` — `isRelationValue` (accepts
real relations, rejects media even with `documentId`, rejects mixed
media/relation arrays), `isInternalField`, `SENSITIVE_FIELD_NAME_RE`
(including the `led_trials` vs `leads` near-miss), `isWritableRelationField`.

`lib/__tests__/relations-classify.test.ts` — `validateRelations` (accepts
valid, whole-reply failure only on non-array, drops individually-invalid
proposals while keeping good ones, the **target-type-mismatch** check, the
corpus anti-hallucination gate, self-relation, already-current, in-reply
duplicate, `see_also` non-writability and its exemption from type-checking),
`buildVocabulary` (reserved + non-content exclusion).

`lib/__tests__/relation-reports.test.ts` — `mergeRelationRows` (a never-run
entry isn't an error; a persisted check joins onto its matching entry only).

No automated test covers `generate-relation-schema.js` itself (it requires a
local backend checkout that won't exist in CI) — its output is verified by
inspection each time it's regenerated, and downstream code only ever
consumes the committed JSON, never the generator, at runtime.

---

## 12. Out of scope

- Admin-JWT writes (see §8/§2 non-goals) — token-only for this version.
- Semantic/embedding-based candidate ranking — keyword overlap only.
- Auto-adding a Strapi relation field for a recurring `see_also` pattern.
- Resuming a stopped batch automatically — re-select and re-run.
- More than one Relations batch at a time (independent of the Resources
  tab's own one-at-a-time rule — each feature has its own batch slot).
- Authentication on the API routes (same operator-tool assumption as
  Resources — see its design doc §8).
- Automatically regenerating the schema registry when the backend changes —
  it's a manual, occasional step (§3.2).
