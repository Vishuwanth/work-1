# Plan: Batch FAQ-Section Generator for CancerFax Content Architecture

## Context

CancerFax maintains a content plan in `CancerFax_Content_Architecture_1.xlsx`. The `All 300 Pages`
sheet lists **759 support/pillar pages**, each a medical/oncology topic. Today these FAQ sections are
generated **manually, one page at a time**, inside a Claude.ai project ("FAQ's - Pillar and Support
Pages", created by Sandeep). The goal is a **batch script** that automates that exact manual process
for every row.

### How the manual process works (observed in the BNCT chat)

1. User pastes a **250-line master prompt** ("CANCERFAX FAQ GENERATION PROMPT FOR CLAUDE") with the
   TOPIC + PAGE TYPE filled in, and says: *"Use the FAQ Seed script to generate a complete FAQ
   section script on the Pillar page 'X'. Verify all details … in Downloadable JSON format."*
2. Claude reads **project knowledge files**: `CONTENT-ARCHITECTURE.md` (to find the page's Content
   Type, status, slug/route, and which seed script/namespace applies), `FIXTURE-SCHEMA.md` (compact
   short-key fixture format), and the **FAQ schema** (`section-faq`).
3. Claude **verifies medical facts via web search** (approvals, trial status, countries, cost).
4. Claude emits **status-aware JSON**:
   - **"Done" pages** → a `sectionToMerge` snippet to merge into the page's existing `sections` array.
   - Other pages → (per convention) a fuller section/page fixture.
   - Fixture uses **short keys**: `q`/`a` → `question`/`answer`, `groups[].title` → `groupTitle`;
     `section-faq` takes **no `style` field** (omitted); `a` values are wrapped in `<p>…</p>`.
   - Schema recommendation + medical disclaimer included as top-level fields.
5. Claude validates programmatically (e.g. 18/18 items, 5/5 groups) and flags anything uncertain
   (e.g. slug/route) with ⚠ VERIFY.

### Master prompt rules (captured in full)

- **FAQ count by page type:** Pillar 15–20 (default 18); Support/Guide/Insight 8–10;
  Condition/Treatment 8–12; Clinical Trial 5–8; Single-question 3–5.
- **Answer length:** ~65–75 words; first sentence a direct, self-contained, quotable answer.
- **Grouping:** Pillar → 3–5 H3 groups (Understanding · Eligibility/Process/Safety ·
  Cost/Access/Countries · Advanced Options & Clinical Trials · Practical for International Patients);
  Support → 2–3 groups or one flowing ungrouped list.
- **Voice:** patient/caregiver natural language; medically cautious; hedge all eligibility/cost/
  trial/international-access answers ("may be considered", "depends on … specialist review",
  "final decisions … treating medical team"). **Never** claim cure/100% success/no side effects/
  risk-free/replaces standard care/CancerFax guarantees.
- **CancerFax mention:** once or twice only; ideally one final FAQ "How does CancerFax help …?"
  with the approved answer; never make it sound like it replaces doctors.
- **AEO optimization:** match real search intent, entities (cancer type, country, biomarker, trial…),
  each answer standalone.
- **Schema suggestion:** FAQPage + relevant parent schema (MedicalWebPage, MedicalCondition,
  MedicalTherapy, MedicalProcedure, Physician, Hospital, MedicalOrganization, MedicalTrial,
  BreadcrumbList, Place).
- **Medical disclaimer** (fixed text) included at end / as a top-level field.
- **Final QA checklist:** count correct, quotable first sentences, ~65–75 words, natural language,
  no duplicate intent, safe tone, hedged sensitive answers, CancerFax ≤2 mentions, schema + disclaimer
  present, each answer stands alone.

> Note the layered rule: the master prompt says "DO NOT INCLUDE HTML," but the **fixture format**
> (`FIXTURE-SCHEMA.md`) wraps each `a`/answer in `<p>` tags. The fixture-conversion rules override the
> generic prose rule — which is exactly why the script needs the project's schema files, not just the
> prompt.

### Decisions locked with the user

- Source: `All 300 Pages` sheet; **Claude API batch script (Python)**; research + cite (web search)
  to ground facts but **no visible citations** in the JSON.
- **Match the project's convention:** "Done" → `sectionToMerge` snippet; Pending → full section.
- First run: first **1–2 Pending** rows, review, then scale to all rows.

## ⛔ Blocker: reference files are not local

Filesystem search confirms `work-1/` contains only the spreadsheet, the sample
`car-t-cell-therapy-solid-tumors-faq-section.json`, and this plan. The files the manual process
depends on — **`FIXTURE-SCHEMA.md`, `CONTENT-ARCHITECTURE.md`, the `section-faq` schema, and the
seed scripts (`seed-treatment.js` etc.)** — live in the Claude.ai project knowledge and/or a separate
Strapi content repo I don't have. Without them the script cannot reproduce exact slugs/routes,
namespaces, the fixture short-key shape, or the Done-vs-Pending output.

**Need from user (see question):** point me to the local content repo, OR drop these files into
`work-1/`. The 250-line master prompt is already captured (I can save it to `work-1/` as
`faq-generation-prompt.md`).

## Step 0 (first implementation step): gather inputs from the Claude.ai project

Before writing the script, extract and save into `work-1/` (browser is read-only; these need write
access, so they happen after plan approval):
1. **Master prompt** → save the captured 250-line prompt from the BNCT chat to
   `work-1/faq-generation-prompt.md` (the script's system prompt).
2. **Reference files** → open the "FAQ's - Pillar and Support Pages" project and pull
   `FIXTURE-SCHEMA.md`, `CONTENT-ARCHITECTURE.md`, the `section-faq` schema, and the seed script(s);
   save copies into `work-1/reference/`.
   - The BNCT chat "ran a command / read a file," implying these live in a connected repo, so they
     may not be downloadable from the web UI. **Fallback:** reconstruct the fixture contract from the
     BNCT chat's JSON output + the local `car-t-…-faq-section.json` sample, and flag any gaps (exact
     slug/route/namespace rules) with ⚠ VERIFY for the user to confirm.
3. Also capture one full known-good JSON output (the BNCT `sectionToMerge`) as the format fixture to
   validate against.

## Approach (once reference files are available)

Single self-contained Python script (`generate_faq.py`) using the Anthropic Python SDK; `openpyxl`
already installed. Reference the **`claude-api`** skill for current model IDs, the web-search tool,
and tool-forced/structured JSON output before writing the API calls.

Per-row pipeline (mirrors the manual steps):
1. **Read row** from `All 300 Pages` — title, pillar, status, content type. Filter `Pending`,
   take first `--limit` (default 2). Look up the page in `CONTENT-ARCHITECTURE.md` for
   content-type/slug/route/namespace + confirm status.
2. **Research** — Claude API call with the **web search tool**; return grounding notes. Discarded
   after use (no citations in output).
3. **Generate** — Claude API call: system prompt = the captured master prompt (page-type-aware
   count/grouping) + the fixture short-key rules from `FIXTURE-SCHEMA.md`; force valid JSON via a
   tool/structured-output schema shaped like `section-faq`.
4. **Validate** — parse JSON; assert count matches page type, groups present, keys are the fixture
   short keys, every `a` wrapped in `<p>…</p>`, disclaimer + schema fields present; retry once on
   failure. Flag unresolved slug/route as ⚠ VERIFY.
5. **Write** — status-aware: `sectionToMerge` snippet for Done, full section for Pending;
   file `output/faq/<slug>-faq-section.json` (mirror the sample's naming).

Config via flags/env: `ANTHROPIC_API_KEY`, `--sheet`, `--status`, `--limit`, `--model`, `--out`.

## Files

- **New:** `generate_faq.py`, `output/faq/`, `faq-generation-prompt.md` (captured master prompt).
- **Needed (from user):** `FIXTURE-SCHEMA.md`, `CONTENT-ARCHITECTURE.md`, `section-faq` schema,
  seed scripts.
- **Reference (local):** `CancerFax_Content_Architecture_1.xlsx`,
  `car-t-cell-therapy-solid-tumors-faq-section.json`.

## Verification (end-to-end)

1. `python generate_faq.py --limit 2` on the first 2 Pending rows (with `ANTHROPIC_API_KEY` set).
2. Each output parses as JSON and passes the validator (count for page type, fixture short keys,
   `<p>`-wrapped answers, disclaimer + schema present, ≤2 CancerFax mentions).
3. **Compare against a known-good manual output** (e.g. the BNCT JSON / the car-t sample) for shape,
   voice, and Done-vs-Pending convention.
4. Spot-check factual currency against the research notes.
5. On approval, scale to all Pending / all rows, watching API + web-search cost across ~759 rows.

## Open follow-ups

- Model choice for the full run (quality vs. cost across 759 rows).
- Confirm the exact full-section fixture shape for non-Done pages (from `FIXTURE-SCHEMA.md`).
- How generated JSON is merged into the live Strapi `sections` array downstream.
