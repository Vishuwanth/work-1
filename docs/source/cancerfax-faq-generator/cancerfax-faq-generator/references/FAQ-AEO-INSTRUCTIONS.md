# CancerFax FAQ Generation Instructions for AEO (Pillar & Support Pages)

> Version 1.0 — supplied by the CancerFax team as the authoritative content/style rulebook
> for every FAQ set this skill generates. Read this in full before writing any FAQ content.
> The skill's job is to turn this document into a live `section-faq` component — nothing
> here is optional; count ranges, answer length, hedge language, and the CancerFax-mention
> limit are all validated (with warnings) by `seeds/seed-faq.js`.

Purpose: Use this instruction file whenever generating FAQ sections for Pillar Pages or
Support Pages. It governs FAQ count, structure, length, grouping, phrasing, compliance, and
schema so that every FAQ set is consistent and optimized for Google Featured Snippets, People
Also Ask, voice search, and AI answer engines (ChatGPT, Perplexity, Google AI Overviews,
Claude, Bing Copilot).

## 1. Why FAQ structure matters for AEO

Answer engines and AI search tools do not reward long, marketing-style content. They reward:
- A direct, self-contained, quotable answer as the first sentence
- Clear question phrasing that matches how patients actually type or speak
- Concise, non-repetitive answers with no duplicate intent between questions
- Structured markup (FAQPage schema) that lets machines parse question/answer pairs cleanly
- Medically hedged language that reads as trustworthy rather than promotional

Every FAQ on CancerFax should be written to stand alone as a citable answer, even if pulled
out of context by an AI engine or snippet box.

## 2. How many FAQs per page type

Use these ranges. Do not default to a round number without checking the page type first.
See `PAGE-STATUS-CSV.md` for how this skill maps a CSV row's `collection` + `role` to one
of these buckets.

| Page type | FAQ count | Notes |
|---|---|---|
| **Pillar pages** (`role = PILLAR PAGE`, any collection) | 15–20 | Authority pages. Wide enough to capture PAA variations, comparisons, and long-tail voice queries without diluting answer quality. |
| **Support pages — insights** (`collection = insights`, `role = Support Page`) | 6–10 | Answers one specific patient question. Do not let it drift into a second topic — that belongs on its own page. |
| **Support pages — treatments / guides** (`collection = treatments` or `guides`, `role = Support Page`) | 8–12 | Sits between pillar and insight depth — covers eligibility, process, risk, cost for that specific treatment/guide. |
| Condition / hospital / doctor pages (not in this skill's CSV scope) | 8–12 | Reference only — this skill currently covers insights/guides/treatments. |
| Individual clinical trial pages | 5–8 | Eligibility, exclusion factors, process. Never guarantee enrollment or benefit. |
| Answer pages (single-question conversational format) | 3–5 | Tightly related follow-ups only, not a second topic. |

**Why not more:** past ~20–25 FAQs on a single page, AEO value drops — each FAQ competes with
the others for which one gets pulled into a snippet or AI citation, and near-identical
questions confuse which one is canonical. If a topic genuinely needs more, split the surplus
into a dedicated support page instead of overloading one FAQ set.

## 3. Answer length rules

Match the answer length to the query type being targeted:

**Definition / direct questions** ("What is...", "Is X suitable for...", "Does X work for..."):
- Direct answer sentence: 40–60 words, placed immediately after the question, no links or
  lists inside it
- Optional supporting detail after: up to 200–400 words total for pillar-page FAQs; tighter
  (80–150 words total) for support-page FAQs

**List / process questions** ("How to...", "What are the top...", "What steps..."):
- Open with a one-sentence summary, then a numbered or bulleted list
- Each list item under 20 words
- 5–9 items maximum (snippets rarely show more than 8)

**Comparison questions** ("X vs Y", "How does X compare to Y"):
- Consider a short table (3–5 rows) if the page format allows it
- If kept as prose, lead with the single-sentence distinction before elaborating

**Voice search variants** (conversational, long-tail):
- Keep the core answer to 29–45 words
- Full sentences only, no bullets, no special characters
- Use contractions and second person ("you may be eligible" not "patients may be eligible")
  where it does not compromise clinical precision

Across all types: the direct answer must be able to stand alone if quoted out of context by
an AI engine, with no pronouns referring to something earlier on the page.

## 4. FAQ writing formula

```
Q: [Question phrased exactly the way a patient would type or say it]
A: [Direct, quotable answer in the first sentence] + [Supporting clinical context]
   + [Hedge/caution language where relevant]
```

Example (good):
> Q: Is CAR T-cell therapy suitable for all cancer patients?
> A: No. CAR T-cell therapy is mainly used for selected blood cancers and is being studied
> in some solid tumors. Eligibility depends on cancer type, antigen expression, previous
> treatment, overall health, and specialist review.

Avoid vague FAQs that don't reflect real patient search intent ("What is cancer?", "Is
treatment important?") unless the page is basic awareness content.

Avoid two FAQs answering the same underlying question in different words. If two draft
questions overlap more than 70%, merge them or cut one.

## 5. Question phrasing rules

Write questions the way patients actually search or ask a voice assistant, not the way a
medical writer would title a section.

| Intent | Preferred opener |
|---|---|
| Definitions | "What is...", "What does...mean" |
| Eligibility / suitability | "Is X suitable for...", "Can I...", "Does X work for..." |
| Process | "How does X work", "How is X done" |
| Cost | "How much does X cost", "What does X cost in [country]" |
| Availability | "Which countries / hospitals offer X" |
| Value / ranking | "What are the top / best X" (answer with a list, not a single winner) |
| Eligibility | "Who is eligible for X" |
| Safety | "What are the risks / side effects of X" |
| Access | "How do I access X abroad" |

Do not force keyword phrases into a question if it breaks natural patient language. A real
patient asks "Is CAR-T available in India?" not "What is the availability status of CAR
T-cell therapy within the Indian subcontinent?"

## 6. Grouping FAQs for clarity (pillar pages and longer support pages)

When a FAQ set exceeds roughly 8–10 questions, organize it into 3–5 thematic groups with a
short group title (H3 level, `groups[].title` in the fixture) so both readers and AI engines
can navigate faster.

Typical pillar-page grouping (15–20 FAQs):
1. Understanding the Treatment / Topic (definitions, mechanism, who it's for)
2. Eligibility, Process, and Safety
3. Cost, Access, and Countries
4. Clinical Trials and Advanced Options (if relevant)
5. Practical / Logistics Questions

For support pages (6–12 FAQs), 2–3 groups is usually enough, or none at all if the topic is
narrow enough to read as one flowing list. **Do not force grouping on a short set (under 8
questions)** purely for structure's sake — use flat `faq.items` instead of `faq.groups` (see
`FIXTURE-SCHEMA.md`).

## 7. Medical safety language inside FAQs

Every FAQ touching eligibility, cost, trials, or international access must include hedge
language:
- "may be considered" / "may be suitable for selected patients"
- "depends on cancer type, stage, biomarker profile, prior treatment, and specialist review"
- "should be discussed with a qualified oncology team"
- "final treatment decisions should be made by the treating medical team"

Never write inside an FAQ: guaranteed cure, 100% success, best treatment for everyone, no
side effects, risk-free, assured results, replaces standard medical care.

- **Cost FAQs**: estimated ranges only; note that final costs depend on hospital,
  diagnostics, protocol, and length of stay.
- **Clinical trial FAQs**: never guarantee enrollment or benefit; eligibility is determined
  only after investigator review.
- **Country/access FAQs**: never guarantee hospital acceptance, visa approval, or admission.

## 8. How CancerFax should appear in FAQ sets

CancerFax integration must stay subtle and useful, never promotional.
- Do not mention CancerFax in every FAQ.
- Include CancerFax positioning in only **1, sometimes 2**, FAQs per set — usually the final
  FAQ or a "How does CancerFax help with X" question. `seed-faq.js` validates this count and
  warns outside 1–2.
- Approved phrasing pattern: "CancerFax helps patients organize medical reports, identify
  relevant specialists or trials, estimate costs, and coordinate travel, visa, and follow-up
  support alongside the treating oncology team."
- Never state or imply CancerFax replaces the oncologist, guarantees outcomes, or makes
  treatment decisions.

## 9. Schema application for FAQ sections

**Already handled automatically — no action needed in the fixture.** The `section-faq`
Strapi component is described in its own schema as rendering `schema.org/FAQPage` JSON-LD for
AEO (see `SECTION-FAQ-SCHEMA.md`). You do not need to write raw JSON-LD — populating
`groups[].items[].question`/`answer` is sufficient; the frontend generates the structured
data from it.

The parent page type still carries its own companion schema (already live, unrelated to this
skill): MedicalWebPage/BreadcrumbList on all pages, MedicalTherapy on treatments,
MedicalCondition on conditions, etc.

## 10. Output format for FAQ delivery

This skill's output format differs slightly from the original instruction (which described
plain-prose chat delivery) because these FAQs are written straight into a live Strapi
component via `seed-faq.js`, not pasted into a CMS by hand. Concretely:
- Generate the compact JSON fixture described in `FIXTURE-SCHEMA.md`
- `answer` values use the same HTML the CKEditor5 field expects — wrap in `<p>` tags
- No raw JSON-LD in the fixture — the schema is automatic (§9)
- Still include the medical disclaimer *concept* — the page-level `ctaSection.medicalDisclaimer`
  already carries this sitewide; do not duplicate a full disclaimer inside every FAQ answer,
  only the specific hedge language called for in §7

## 11. Final quality check before finalizing any FAQ set

- Is the FAQ count appropriate for this page type (§2)?
- Does every answer open with a direct, quotable sentence?
- Is every question phrased the way a patient would actually type or ask it?
- Are there any two FAQs answering the same underlying question?
- Does every eligibility, cost, trial, or access answer include the required hedge language?
- Is CancerFax mentioned in only one or two FAQs, and only with approved phrasing?
- Would this answer still make sense if quoted alone, with no other page content around it?
- Did you read the page's actual existing content first (`fetch-page-content.js`) so the FAQs
  reflect what THIS page specifically says (its cost figures, its eligibility criteria, its
  named modalities) rather than generic filler?
