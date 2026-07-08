# Project Memory — "FAQ's - Pillar and Support Pages"

> Captured from the Claude.ai project's Memory panel (last updated ~7h before capture).
> This is the authoritative operational knowledge behind the manual FAQ-generation workflow.

## Purpose & context
Sai Sree works in content operations for CancerFax, producing structured, CMS-ready content —
specifically FAQ section scripts for pillar pages (treatments, guides, insights) — using a
**fixture-based seed script system integrated with a Strapi CMS**. Answers optimized for AEO,
medical accuracy, and cross-border accessibility. Success = validated, pipeline-ready JSON fixtures
that pass structural + content quality checks before entering the seed runner workflow.

## Key learnings & principles

### Architecture verification before drafting (non-negotiable)
- Always check `CONTENT-ARCHITECTURE.md` first to confirm **content type** (Treatment / Guide /
  Insight), **status** (Done vs. Pending), **pillar number**, **route**, and **namespace** before
  writing any content.
- **"Done" status → output is a `section-faq` snippet for merge; "Pending" → standalone fixture.**
- Treatment pages use `insights.*` namespace and `/treatments/:slug` route (despite the naming);
  Guide pages use `guides.*` namespace and `/guides/:slug`; Insight pages use `insights.*` with
  `seed-insight.js`.

### Schema rules (hard constraints)
- `section-faq` must **omit** the `style` / `sectionStyle` field entirely (not null — omitted);
  its presence triggers runner warnings/errors.
- **Compact key names: `q` / `a`** (not `question` / `answer`) and **`groups[].title`**.
- Answers wrapped in `<p>` tags for CKEditor5 compatibility.
- When slug or route is absent from the architecture document's detailed lookup, flag with
  **⚠ VERIFY** rather than assume.

### Content rules (enforced per fixture)
- 18–20 FAQs per pillar page, organized into **5 thematic groups** (typically: Understanding /
  Eligibility & Safety / Cost & Access / Advanced Options & Clinical Trials / Practical Questions
  for International Patients).
- Answers: ~65–75 words, opening with a direct quotable sentence.
- Hedge language required on all eligibility, cost, trial access, and international access claims.
- CancerFax mentioned **exactly once**, in the final FAQ only, non-promotional, defers to treating
  medical team.
- No outcome guarantees, cure claims, or prohibited promotional language.
- Medical facts verified via web search before drafting.

### Validation (always before delivery)
- Python3 inline validation: JSON parse integrity, group count, per-group item count, total FAQ
  count, per-answer word counts (using `re.sub('<[^>]+>', '', answer)` to strip HTML before counting).
- Confirm `style` field absence.
- Confirm CancerFax mention count = 1.

## Workflow sequence (consistent across all tasks)
1. Read `SKILL.md` to confirm correct skill version (v1 vs. v2).
2. Grep `CONTENT-ARCHITECTURE.md` for pillar metadata (content type, status, route, runner).
3. Check `SECTION-TYPES.md` for `section-faq` schema (authoritative for field rules).
4. Check `FIXTURE-SCHEMA.md` for compact key mappings (**SECTION-TYPES.md overrides
   FIXTURE-SCHEMA.md on conflicts**).
5. Check `CONTENT-TYPE-MAP.md` for namespace if not explicit in architecture doc.
6. Run web search to verify medical facts before drafting.
7. Draft FAQ content.
8. Run Python validation pass.
9. Write to `/home/claude/` first, then copy to `/mnt/user-data/outputs/` only after all checks pass.

## Output structure
- `meta` block (merge instructions, schema recommendation, medical disclaimer) included as
  **top-level fields**.
- `meta` block must be stripped before running seed merge if pipeline expects clean payload.
- Schema recommendations: FAQPage + MedicalTherapy/MedicalProcedure/MedicalWebPage + BreadcrumbList
  (Treatment); FAQPage + MedicalWebPage + BreadcrumbList (Guide).

## Tools & resources
- **Skills:** `cancerfax-content-seed-scripts` (v1, Admin REST API) and
  `cancerfax-treatments-insights-guides-seed-scripts-v2` (v2, JSON fixture-based — the ACTIVE system).
- **Reference files:** `SKILL.md`, `CONTENT-ARCHITECTURE.md`, `SECTION-TYPES.md`, `FIXTURE-SCHEMA.md`,
  `CONTENT-TYPE-MAP.md` (in `/mnt/skills/organization`).
- **Runner scripts:** `seed-treatment.js` (Treatment), `seed-guide.js` (Guide), `seed-insight.js`
  (Insight).
- **CMS:** Strapi with CKEditor5 rich-text fields.
- **Output path:** `/mnt/user-data/outputs/` (after validation); working path: `/home/claude/`.
