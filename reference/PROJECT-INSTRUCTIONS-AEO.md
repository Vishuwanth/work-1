# CANCERFAX FAQ GENERATION INSTRUCTIONS FOR AEO (PILLAR & SUPPORT PAGES)
Version: 1.0

> Captured from the Claude.ai project "Instructions" panel. Use alongside the main CancerFax
> Website Content Instructions file whenever generating FAQ sections for Pillar Pages or Support
> Pages. Governs FAQ count, structure, length, grouping, phrasing, compliance, and schema so every
> FAQ set is consistent and optimized for Google Featured Snippets, People Also Ask, voice search,
> and AI answer engines (ChatGPT, Perplexity, Google AI Overviews, Claude, Bing Copilot).

## 1. WHY FAQ STRUCTURE MATTERS FOR AEO
Answer engines reward: a direct, self-contained, quotable answer as the first sentence; clear
question phrasing matching how patients type/speak; concise, non-repetitive answers with no
duplicate intent; structured markup (FAQPage schema); medically hedged, trustworthy language.
Every FAQ should stand alone as a citable answer even if pulled out of context.

## 2. HOW MANY FAQs PER PAGE TYPE
- **PILLAR PAGES: 15–20 FAQs** (authority pages; capture full spread of PAA/comparison/long-tail).
- **SUPPORT PAGES / INSIGHTS: 6–10 FAQs** (tightly related to one specific patient question).
- **CONDITION / TREATMENT / HOSPITAL / DOCTOR PAGES: 8–12 FAQs** (eligibility, process, risk, cost).
- **INDIVIDUAL CLINICAL TRIAL PAGES: 5–8 FAQs** (eligibility, exclusion, process; never guarantee).
- **ANSWER PAGES (single-question): 3–5 FAQs** (tightly related follow-ups only).
- **WHY NOT MORE:** past ~20–25 FAQs, AEO value drops (answer dilution, duplicate intent). Split
  surplus into a dedicated support page or "20-question block" companion page and link them.

## 3. ANSWER LENGTH RULES
- **Definition/direct** ("What is…", "Is X suitable for…"): direct answer 40–60 words; optional
  supporting detail up to 200–400 words total for pillar FAQs (80–150 for support FAQs).
- **List/process** ("How to…", "What are the top…"): one-sentence summary + numbered/bulleted list;
  each item <20 words; 5–9 items max.
- **Comparison** ("X vs Y"): short table (3–5 rows) if allowed, else lead with the single-sentence
  distinction.
- **Voice search variants:** core answer 29–45 words; full sentences, no bullets/special chars;
  contractions + second person where it doesn't compromise clinical precision.
- Across all: the direct answer must stand alone if quoted, no pronouns referring to earlier content.

## 4. FAQ WRITING FORMULA
`Q: [patient-phrased question]` / `A: [direct quotable answer first sentence] + [supporting clinical
context] + [hedge/caution where relevant]`.
Good example — Q: Is CAR T-cell therapy suitable for all cancer patients? A: No. CAR T-cell therapy
is mainly used for selected blood cancers and is being studied in some solid tumors. Eligibility
depends on cancer type, antigen expression, previous treatment, overall health, and specialist review.
Avoid vague FAQs ("What is cancer?"). If two questions overlap >70%, merge or cut one.

## 5. QUESTION PHRASING RULES
Write questions the way patients search/ask a voice assistant. Preferred openers by intent:
"What is…" (definitions); "Is X suitable for…/Can I…/Does X work for…" (eligibility); "How does X
work/How is X done" (process); "How much does X cost/What does X cost in [country]" (cost); "Which
countries/hospitals offer X" (availability); "What are the top/best X" (value/ranking → answer with
a list); "Who is eligible for X"; "What are the risks/side effects of X"; "How do I access X abroad".
Don't force keyword phrases if they break natural patient language.

## 6. GROUPING FAQs (PILLAR & LONGER SUPPORT PAGES)
When a set exceeds ~8–10 questions, organize into **3–5 thematic groups** with short H3 titles.
Typical pillar grouping (15–20 FAQs): (1) Understanding the Treatment/Topic; (2) Eligibility,
Process, and Safety; (3) Cost, Access, and Countries; (4) Clinical Trials and Advanced Options;
(5) Practical/Logistics Questions. Support pages (6–10): 2–3 groups or none. Don't force grouping on
<8 questions.

## 7. MEDICAL SAFETY LANGUAGE INSIDE FAQs
Hedge language required for eligibility/cost/trials/international access: "may be considered", "may
be suitable for selected patients", "depends on cancer type, stage, biomarker profile, prior
treatment, and specialist review", "should be discussed with a qualified oncology team", "final
treatment decisions should be made by the treating medical team".
Never: guaranteed cure, 100% success, best treatment for everyone, no side effects, risk-free,
assured results, replaces standard medical care.
Cost → estimated ranges only, note final cost depends on hospital/diagnostics/protocol/length of
stay. Trials → never guarantee enrollment/benefit. Country/access → never guarantee hospital
acceptance, visa approval, or admission.

## 8. HOW CANCERFAX SHOULD APPEAR IN FAQ SETS
Subtle and useful, never promotional. Not in every FAQ — typically 1 (sometimes 2) FAQs per set,
usually the final "How does CancerFax help with X" question. Approved phrasing e.g.: "CancerFax
helps patients organize medical reports, identify relevant specialists or trials, estimate costs,
and coordinate travel, visa, and follow-up support alongside the treating oncology team." Never imply
it replaces the oncologist, guarantees outcomes, or makes treatment decisions.

## 9. SCHEMA APPLICATION FOR FAQ SECTIONS
Every FAQ section gets **FAQPage** schema. Combine by parent page type: Pillar → MedicalWebPage +
BreadcrumbList; Condition → MedicalCondition + MedicalWebPage + BreadcrumbList; Treatment →
MedicalTherapy (+ MedicalProcedure) + MedicalWebPage + BreadcrumbList; Doctor → Physician + Person +
BreadcrumbList; Hospital → Hospital + MedicalOrganization + BreadcrumbList; Clinical trial →
MedicalTrial/ClinicalTrial + MedicalWebPage + BreadcrumbList; Country → MedicalWebPage +
BreadcrumbList (+ Place if supported). State the recommendation at the end; don't embed raw JSON-LD
unless asked.

## 10. OUTPUT FORMAT FOR FAQ DELIVERY
Unless asked otherwise: plain prose only, no HTML markup, ready for CMS paste; label each item
"FAQ [number]" then "Q:"/"A:" on separate lines; use plain-text H3 group titles when grouping;
close with a Schema suggestion line + the appropriate Medical Disclaimer (main instruction file
Section 33). Don't create a downloadable file unless specifically asked; default to delivering in
chat.

## 11. FINAL QUALITY CHECK BEFORE DELIVERING
Confirm: FAQ count appropriate for page type; every answer opens with a direct quotable sentence;
every question phrased as a patient would ask; no two FAQs answer the same question; hedge language
present on eligibility/cost/trial/access; CancerFax in only 1–2 FAQs with approved phrasing; FAQPage
(+ companion) schema recommended; medical disclaimer included; each answer makes sense quoted alone.
