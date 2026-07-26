'use strict';
/**
 * list-pending.js — Reads all-pages-faq-status.csv and prints the next batch of
 * pages that still need FAQs (faq_done != Yes), so a session can work through
 * the 600+ page backlog in small, trackable batches instead of guessing.
 *
 * Usage:
 *   node list-pending.js <csv-path> [--collection=insights] [--role=PILLAR PAGE] [--limit=20]
 *
 * Examples:
 *   node list-pending.js ~/Downloads/all-pages-faq-status.csv --limit=10
 *   node list-pending.js ~/Downloads/all-pages-faq-status.csv --collection=treatments --role="PILLAR PAGE"
 */

const { readCsv } = require('./_csv');

const args    = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const opt     = (name, def) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

if (!csvPath) {
  console.error('❌  Usage: node list-pending.js <csv-path> [--collection=] [--role=] [--limit=20]');
  process.exit(1);
}

const collectionFilter = opt('collection', null);
const roleFilter        = opt('role', null);
const limit             = parseInt(opt('limit', '20'), 10);

const { records } = readCsv(csvPath);

const pending = records.filter(r => {
  if ((r.faq_done || '').trim() === 'Yes') return false;
  if (collectionFilter && r.collection.trim() !== collectionFilter) return false;
  if (roleFilter && r.role.trim() !== roleFilter) return false;
  return true;
});

console.log(`\nTotal rows:        ${records.length}`);
console.log(`Pending (faq_done != Yes): ${pending.length}`);
if (collectionFilter) console.log(`Filtered by collection: ${collectionFilter}`);
if (roleFilter)       console.log(`Filtered by role:       ${roleFilter}`);
console.log(`Showing next ${Math.min(limit, pending.length)}:\n`);

pending.slice(0, limit).forEach((r, i) => {
  const role = r.role.trim() || '(unspecified)';
  console.log(`${i + 1}. [${r.collection}] ${r.slug}`);
  console.log(`   "${r.title}"  —  ${role}${r.pillar_association ? `  (pillar: ${r.pillar_association})` : ''}`);
});
console.log('');
