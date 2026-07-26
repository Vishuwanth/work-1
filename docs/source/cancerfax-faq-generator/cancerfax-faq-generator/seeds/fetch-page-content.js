'use strict';
/**
 * fetch-page-content.js — READ-ONLY. Dumps an existing insight/guide/treatment
 * page's real content as plain text, so the FAQ set can be grounded in what the
 * page actually says (costs, eligibility criteria, process steps, etc.) instead
 * of generic filler. Also reports whether a section-faq already exists.
 *
 * Usage:
 *   STRAPI_ENV=staging node fetch-page-content.js <collection> <slug>
 *   STRAPI_ENV=prod    node fetch-page-content.js <collection> <slug>
 *
 * <collection> is one of: insights, guides, treatments
 *
 * Makes zero write calls — safe to run anytime.
 */

const { ENV, STRAPI_URL, fetchEntry } = require('./_strapi');

const [collection, slug] = process.argv.slice(2);

if (!collection || !slug) {
  console.error('❌  Usage: node fetch-page-content.js <insights|guides|treatments> <slug>');
  process.exit(1);
}

function dumpSection(s, i) {
  const type = (s.__component || '').split('.section-')[1] || s.__component;
  const lines = [`\n[${i + 1}] ${type}${s.sectionId ? `  (#${s.sectionId})` : ''}`];
  if (s.h2Title)   lines.push(`    H2: ${s.h2Title}`);
  if (s.introText) lines.push(`    Intro: ${s.introText}`);

  (s.cards || []).forEach(c => lines.push(`    • Card: ${c.title} — ${c.body}`));
  (s.stats || []).forEach(st => lines.push(`    • Stat: ${st.value} ${st.label}${st.description ? ' — ' + st.description : ''}`));
  (s.steps || []).forEach(st => lines.push(`    • Step: ${st.title} — ${st.description}`));
  (s.leftItems  || []).forEach(it => lines.push(`    • [Left]  ${it.title}${it.description ? ' — ' + it.description : ''}`));
  (s.rightItems || []).forEach(it => lines.push(`    • [Right] ${it.title}${it.description ? ' — ' + it.description : ''}`));
  (s.rows || []).forEach(r => lines.push(`    • Row: ${[r.col1, r.col2, r.col3, r.col4, r.col5].filter(Boolean).join(' | ')}`));
  (s.groups || []).forEach(g => {
    if (g.groupTitle) lines.push(`    Group: ${g.groupTitle}`);
    (g.bars || []).forEach(b => lines.push(`    • Bar: ${b.label} = ${b.value} (${b.percentage}%)`));
    (g.items || []).forEach(it => lines.push(`    • Q: ${it.question}\n      A: ${it.answer}`));
  });
  (s.languages || []).forEach(l => lines.push(`    • Language: ${l.flag || ''} ${l.language}`));
  (s.links || []).forEach(l => lines.push(`    • Link: ${l.title} → ${l.slug}`));

  return lines.join('\n');
}

async function main() {
  console.log(`\n📄  Fetching ${collection}/${slug}  (${ENV} → ${STRAPI_URL})\n`);
  const entry = await fetchEntry(collection, slug);
  if (!entry) {
    console.error(`❌  Not found: /${collection}/${slug} (checked published entries only)`);
    process.exit(1);
  }

  console.log(`Title: ${entry.title}`);
  console.log(`pageLabel: ${entry.pageLabel || '(none)'}`);
  console.log(`documentId: ${entry.documentId}`);

  const sections = entry.sections || [];
  console.log(`\nSections (${sections.length}):`);
  sections.forEach((s, i) => console.log(dumpSection(s, i)));

  const faqSection = sections.find(s => (s.__component || '').endsWith('.section-faq'));
  console.log('\n' + '─'.repeat(60));
  if (faqSection) {
    const count = (faqSection.groups || []).reduce((n, g) => n + (g.items || []).length, 0);
    console.log(`⚠️  FAQ section ALREADY EXISTS — ${count} question(s) across ${(faqSection.groups || []).length} group(s).`);
    console.log('    Running seed-faq.js will REPLACE this section in place, not duplicate it.');
  } else {
    console.log('✅  No FAQ section yet — seed-faq.js will APPEND a new one at the end.');
  }
  console.log('');
}

main().catch(err => { console.error('\n💥', err.message || err); process.exit(1); });
