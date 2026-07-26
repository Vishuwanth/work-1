# FAQ Fixture Schema

## FAQ count is fixed, not a range (team direction, 2026-07-20)

- `PILLAR PAGE` → exactly **20** items, grouped into 4–5 groups of ~4–5
- `Support Page` (or blank role) → exactly **10** items, usually one flat ungrouped group

This **supersedes** `FAQ-AEO-INSTRUCTIONS.md` §2's ranges (6–10 / 8–12 / 15–20) — the team
wants every page standardized to one of exactly two counts, and wants existing FAQ content
**replaced completely**, not topped up, even if a page already has a perfectly good partial
set. Reuse the substance of good existing Q&As as source material if you like; just don't
ship anything other than exactly 10 or exactly 20 items.

## Two fixture formats — pick one per runner

This skill's own runner (`seed-faq.js`) and the team's existing production pipeline
(`Cancerfax/CancerFax/Scripts/FAQs/apply-pillar-faqs.js`) expect **different** JSON shapes.
Both are documented below — use whichever matches the runner you're actually calling. See
`SKILL.md`'s "Two runners" section for when to use which (short version: prefer the team's).

## Compact JSON format (what Claude generates) — for `seed-faq.js`

```json
{
  "collection": "insights",
  "slug": "what-is-car-t-cell-therapy",
  "faq": {
    "h2": "Frequently Asked Questions",
    "intro": "Optional 1-sentence intro — usually omitted.",
    "groups": [
      {
        "title": "Understanding CAR-T Therapy",
        "items": [
          { "q": "What is CAR-T cell therapy?", "a": "<p>Direct quotable answer...</p>" },
          { "q": "How does CAR-T differ from chemotherapy?", "a": "<p>...</p>" }
        ]
      },
      {
        "title": "Eligibility, Process, and Safety",
        "items": [ ]
      }
    ]
  }
}
```

**When the set is small enough that §6 of FAQ-AEO-INSTRUCTIONS.md says don't group**
(typically insight support pages with 6–10 FAQs), use flat `items` instead of `groups`:

```json
{
  "collection": "insights",
  "slug": "cytokine-release-syndrome-explained",
  "faq": {
    "items": [
      { "q": "What is cytokine release syndrome?", "a": "<p>...</p>" },
      { "q": "How is CRS treated?", "a": "<p>...</p>" }
    ]
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `collection` | yes | `insights` \| `guides` \| `treatments` — must match the page's actual Strapi collection |
| `slug` | yes | Must match an **existing, published** entry — this skill only adds to existing pages, it never creates new ones |
| `faq.h2` | no | Defaults to `"Frequently Asked Questions"` |
| `faq.intro` | no | Optional 1-sentence intro line |
| `faq.groups[].title` | no | Omit for an ungrouped page (§6) |
| `faq.groups[].items[].q` / `.a` | yes | `q` = plain string question. `a` = HTML answer, wrapped in `<p>` tags (CKEditor5 field) |
| `faq.items[].q` / `.a` | yes | Same shape, used only when `groups` is omitted |

## What `seed-faq.js` builds from this (the live Strapi component)

```js
{
  __component: "insights.section-faq",   // or "guides.section-faq" — see NAMESPACE mapping
  sectionId:   "faq",
  h2Title:     faq.h2 || "Frequently Asked Questions",
  introText:   faq.intro,
  groups: [
    {
      groupTitle: "Understanding CAR-T Therapy",   // undefined if ungrouped
      items: [
        { question: "What is CAR-T cell therapy?", answer: "<p>...</p>" }
      ]
    }
  ]
}
```

## `section-faq` schema — verified against schema.json (2026-07-20)

`cancerfax-strapi-backend/src/components/insights/section-faq.json` (and the
`guides.section-faq` / `guides.faq-group` / `guides.faq-item` equivalents — identical shape,
different namespace):

```
insights.section-faq
├── sectionId   string, default "faq"
├── h2Title     string, REQUIRED
├── introText   text
└── groups[]    insights.faq-group (repeatable)
    ├── groupTitle  string
    └── items[]     insights.faq-item (repeatable)
        ├── question  string, REQUIRED
        └── answer    CKEditor5 customField, REQUIRED
```

The component's own `info.description` states it "Renders as schema.org/FAQPage JSON-LD for
AEO" — this is automatic on the frontend, nothing to add in the fixture (see
FAQ-AEO-INSTRUCTIONS.md §9).

## Namespace mapping (collection → dynamic-zone component prefix)

| `collection` | Strapi UID | Section namespace | Route |
|---|---|---|---|
| `insights` | `api::insight.insight` | `insights.*` | `/insights/:slug` |
| `guides` | `api::guide.guide` | `guides.*` | `/guides/:slug` |
| `treatments` | `api::treatment.treatment` | `insights.*` (reuses insight components) | `/treatments/:slug` |

This mapping lives in `seeds/_strapi.js` (`NAMESPACE`) — the same mapping used by
`cancerfax-insights-seed-scripts-v2`'s `CONTENT-TYPE-MAP.md` for creating whole pages.

## Alternate format — for `apply-pillar-faqs.js` (the team's runner)

Saved as `{slug}-faq-section.json` in a fixtures folder (conventionally
`Cancerfax/CancerFax/Scripts/FAQs/batch-<date>/`), plus a separate mapping JSON file listing
which fixture applies to which page:

```json
{
  "pillar": "CAR-T Cell Therapy",
  "contentType": "Insights",
  "runner": "apply-pillar-faqs.js",
  "slug": "what-is-car-t-cell-therapy",
  "route": "/insights/what-is-car-t-cell-therapy",
  "sectionToMerge": {
    "type": "faq",
    "id": "faq",
    "h2": "Frequently Asked Questions",
    "groups": [
      { "title": "", "items": [ { "q": "...", "a": "<p>...</p>" } ] }
    ]
  }
}
```

Mapping file (passed as the runner's CLI argument, default path `/tmp/faq_mapping.json`):

```json
[
  { "collection": "insights", "slug": "what-is-car-t-cell-therapy", "file": "what-is-car-t-cell-therapy-faq-section.json" }
]
```

Differences from this skill's own format: everything lives under `sectionToMerge` (mirroring
the section object shape more directly), and `pillar`/`contentType`/`runner`/`route` are
carried along as metadata even though the runner only actually reads `sectionToMerge` — keep
them for consistency with the many existing fixtures already in that folder. The runner's own
`normalizeFaq()` is actually format-tolerant (it deep-searches for any object with
`groups[].items[]`), so minor shape variations still work, but match the convention above for
new fixtures rather than relying on that tolerance.

`apply-pillar-faqs.js` internals worth knowing (see the file itself for the full comments):
- Deep-populates `sections` with a per-type `on` map, same reasoning as this skill's
  `buildSectionsPopulate()` — a type left out of the `on` map is filtered out of the response
  entirely, not just left shallow.
- Reorders `__component` to the first key before writing (`reorderComponent`) — this is the
  fix documented in `SKILL.md` critical rule 2; it's been correct in this script from the
  start, which is why it never hit the 400 this skill's own runner did before being fixed.
- Single-step `PUT ?status=published` — no draft/publish dance needed once the reorder is done.
- No dry-run flag — verify the fixture JSON by eye before running against prod.

## Validation `seed-faq.js` runs before writing anything

- `collection` is one of the three valid values
- Every item has both `q` and `a`
- Item count warning if `< 3` or `> 25`
- Warning if `"CancerFax"` appears in 0 or more than 2 answers (§8)
- Errors block the write; warnings print but do not block

## Position in the page

FAQ is always the **last** section on the page (matches the established convention in
`cancerfax-insights-seed-scripts-v2` §16 — `stats` → `support-pages` → `faq`). `seed-faq.js`:
- If a `section-faq` component already exists anywhere in `sections` → **replaces it in
  place** at the same index (handles both a real existing FAQ and an empty placeholder
  stub — see next section)
- If none exists → **appends** a new one at the end

## Known edge case: empty placeholder FAQ sections

Some pages already carry a `section-faq` with a `h2Title` and even a `groupTitle`, but
**zero actual items** (`faq_done = No` in the CSV despite the section technically existing).
Always run `fetch-page-content.js` first — it reports the real item count, not just whether
the component is present, so you don't mistake a stub for a completed FAQ set.
