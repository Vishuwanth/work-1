'use strict';
/**
 * seed-faq.js — Appends or updates ONLY the FAQ section (section-faq) on an
 * EXISTING, already-published insight / guide / treatment page.
 *
 * This is NOT a full-page seeder (unlike seed-insight.js / seed-guide.js /
 * seed-treatment.js in cancerfax-insights-seed-scripts-v2). It never touches
 * title, hero, seo, ctaSection, or any other section — it fetches the live
 * page, edits just the sections array, and PUTs only { sections } back.
 *
 * Usage:
 *   STRAPI_ENV=staging node seed-faq.js <fixture-path-or-slug> [--dry-run]
 *   STRAPI_ENV=prod    node seed-faq.js <fixture-path-or-slug> [--dry-run]
 *
 * Fixture format (compact JSON — see references/FIXTURE-SCHEMA.md):
 *   {
 *     "collection": "insights" | "guides" | "treatments",
 *     "slug": "what-is-car-t-cell-therapy",
 *     "faq": {
 *       "h2": "Frequently Asked Questions",   // optional, this is the default
 *       "intro": "...",                        // optional
 *       "groups": [
 *         { "title": "Understanding CAR-T", "items": [ { "q": "...", "a": "<p>...</p>" } ] }
 *       ]
 *       // OR, when the set is small enough that Section 6 says don't group:
 *       // "items": [ { "q": "...", "a": "<p>...</p>" } ]
 *     }
 *   }
 *
 * How it works:
 *   1. GET the live published entry (?status=published), sections fully populated
 *   2. Build the section-faq component from the fixture
 *   3. If a section-faq already exists in sections → replace it in place (same index)
 *      Otherwise → append it at the end (FAQ is always the last section — see
 *      cancerfax-insights-seed-scripts-v2 §16 sectionStyle/section-order convention)
 *   4. Strip Strapi's internal `id` fields from every section before writing —
 *      required because PUT targets the draft, whose component ids differ from
 *      the published ids we just fetched (see update-support-page-slugs.js)
 *   5. PUT only { data: { sections } } to ?status=published — goes live immediately,
 *      no separate "click Publish in admin" step needed
 */

const path = require('path');
const fs   = require('fs');
const { ENV, STRAPI_URL, NAMESPACE, assertCollection, fetchEntry, putSections } = require('./_strapi');

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const arg     = args.find(a => !a.startsWith('--'));
const DRY_RUN = args.includes('--dry-run');

if (!arg) {
  console.error('❌  Usage: node seed-faq.js <fixture-path-or-slug> [--dry-run]');
  console.error('    Examples:');
  console.error('      node seed-faq.js what-is-car-t-cell-therapy.faq.json --dry-run');
  console.error('      node seed-faq.js ./fixtures/hipec.faq.json');
  process.exit(1);
}

// ─── Resolve fixture from any path ───────────────────────────────────────────

function resolveFixture(a) {
  const name = a.endsWith('.json') ? a : `${a}.json`;
  if (path.isAbsolute(a)) return name;
  if (a.startsWith('./') || a.startsWith('../')) return path.resolve(process.cwd(), name);
  const inCwd    = path.resolve(process.cwd(), name);
  const inScript = path.resolve(__dirname, name);
  if (fs.existsSync(inCwd))    return inCwd;
  if (fs.existsSync(inScript)) return inScript;
  return inCwd;
}

const fixturePath = resolveFixture(arg);
if (!fs.existsSync(fixturePath)) {
  console.error(`❌  Fixture not found: ${fixturePath}`);
  process.exit(1);
}

let f;
try { f = JSON.parse(fs.readFileSync(fixturePath, 'utf8')); }
catch (e) { console.error(`❌  Invalid JSON in ${fixturePath}: ${e.message}`); process.exit(1); }

// ─── Validate ─────────────────────────────────────────────────────────────────

function validate(fixture) {
  const errors = [], warnings = [];

  if (!fixture.collection) errors.push('Missing required: collection (insights|guides|treatments)');
  else { try { assertCollection(fixture.collection); } catch (e) { errors.push(e.message); } }

  if (!fixture.slug) errors.push('Missing required: slug');
  if (!fixture.faq)  { errors.push('Missing required: faq'); return { errors, warnings, itemCount: 0, mentions: 0 }; }

  const groups = fixture.faq.groups
    ? fixture.faq.groups
    : fixture.faq.items
      ? [{ items: fixture.faq.items }]
      : [];

  if (groups.length === 0) errors.push('faq must have "groups" or "items" with at least one Q&A');

  let itemCount = 0;
  let mentions  = 0;
  groups.forEach((g, gi) => {
    (g.items || []).forEach((it, ii) => {
      const q = it.q || it.question;
      const a = it.a || it.answer;
      if (!q) errors.push(`faq groups[${gi}].items[${ii}].q is required`);
      if (!a) errors.push(`faq groups[${gi}].items[${ii}].a is required`);
      if (a && /cancerfax/i.test(a)) mentions++;
      itemCount++;
    });
  });

  if (itemCount < 3)  warnings.push(`Only ${itemCount} FAQ item(s) — most page types need at least 5-6 (see FAQ-AEO-INSTRUCTIONS.md §2)`);
  if (itemCount > 25) warnings.push(`${itemCount} FAQ items — past ~20-25, AEO value drops (answer dilution). Consider splitting.`);
  if (mentions === 0) warnings.push('No answer mentions "CancerFax" — include it in exactly 1-2 FAQs (§8)');
  if (mentions > 2)   warnings.push(`"CancerFax" appears in ${mentions} answers — keep it to 1-2 (§8, avoid sounding promotional)`);

  return { errors, warnings, itemCount, mentions };
}

// ─── Build the section-faq component ─────────────────────────────────────────

function buildFaqSection(faq, ns) {
  const groups = faq.groups
    ? faq.groups.map(g => ({
        groupTitle: g.title || undefined,
        items: (g.items || []).map(it => ({
          question: it.q || it.question || '',
          answer:   it.a || it.answer   || '',
        })),
      }))
    : faq.items
      ? [{ items: faq.items.map(it => ({ question: it.q || '', answer: it.a || '' })) }]
      : [];

  return {
    __component: `${ns}.section-faq`,
    sectionId:   'faq',
    h2Title:     faq.h2    || 'Frequently Asked Questions',
    introText:   faq.intro || undefined,
    groups,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n💡  CancerFax FAQ Seeder`);
  console.log(`    Env:        ${ENV.toUpperCase()} → ${STRAPI_URL}`);
  console.log(`    Fixture:    ${fixturePath}`);
  console.log(`    Mode:       ${DRY_RUN ? '🔍 DRY RUN' : '✍️  WRITE'}\n`);

  console.log('🔍  Validating fixture...');
  const { errors, warnings, itemCount, mentions } = validate(f);
  warnings.forEach(w => console.warn(`    ⚠  ${w}`));
  if (errors.length) {
    errors.forEach(e => console.error(`    ✖  ${e}`));
    console.error('\n❌  Fix errors before seeding.'); process.exit(1);
  }
  console.log(`    ✔  Valid (${itemCount} FAQ items, "CancerFax" mentioned ${mentions}x)\n`);

  const { collection, slug } = f;
  const ns = NAMESPACE[collection];

  console.log(`🔎  Fetching live entry: /${collection}/${slug} ...`);
  const entry = await fetchEntry(collection, slug);
  if (!entry) {
    console.error(`❌  Not found: /${collection}/${slug} — this script only ADDS to existing pages.`);
    console.error(`    (Checked published entries only — confirm the page is live in this environment.)`);
    process.exit(1);
  }
  console.log(`    ✔  Found: "${entry.title}"  (documentId: ${entry.documentId})\n`);

  const sections = entry.sections || [];
  const newFaqSection = buildFaqSection(f.faq, ns);
  const existingIdx = sections.findIndex(s => (s.__component || '').endsWith('.section-faq'));

  let updatedSections;
  let action;
  if (existingIdx >= 0) {
    updatedSections = sections.map((s, i) => (i === existingIdx ? newFaqSection : s));
    action = `REPLACE existing FAQ section at position ${existingIdx + 1}/${sections.length}`;
  } else {
    updatedSections = [...sections, newFaqSection];
    action = `APPEND new FAQ section at position ${updatedSections.length}/${updatedSections.length}`;
  }

  console.log(`📝  ${action}`);
  console.log(`    Sections before: ${sections.length}  →  after: ${updatedSections.length}`);
  console.log(`    All other sections, hero, seo, and title are left completely untouched.\n`);

  if (DRY_RUN) {
    console.log(JSON.stringify(newFaqSection, null, 2));
    console.log(`\n✅  Dry run — no changes made.`);
    return;
  }

  await putSections(collection, entry.documentId, updatedSections);

  const routes = { insights: '/insights/', guides: '/guides/', treatments: '/treatments/' };
  console.log(`✅  Live now: https://www.cancerfax.com${routes[collection]}${slug}`);
  if (ENV === 'staging') console.log(`    Staging:  https://staging-frontend.cancerfax.in${routes[collection]}${slug}`);
  console.log(`\n□  Mark this row done: node mark-faq-done.js <csv-path> ${collection} ${slug}`);
  console.log('');
}

main().catch(err => { console.error('\n💥', err.message || err); process.exit(1); });
