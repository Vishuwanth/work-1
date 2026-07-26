'use strict';
/**
 * mark-faq-done.js — Flips faq_done to "Yes" for one row in all-pages-faq-status.csv,
 * after seed-faq.js has successfully written that page's FAQ section live.
 * Only touches the matching row — every other row is preserved exactly as-is.
 *
 * Usage:
 *   node mark-faq-done.js <csv-path> <collection> <slug>
 *
 * Example:
 *   node mark-faq-done.js ~/Downloads/all-pages-faq-status.csv insights what-is-car-t-cell-therapy
 */

const { readCsv, writeCsv } = require('./_csv');

const [csvPath, collection, slug] = process.argv.slice(2);

if (!csvPath || !collection || !slug) {
  console.error('❌  Usage: node mark-faq-done.js <csv-path> <collection> <slug>');
  process.exit(1);
}

const { header, records } = readCsv(csvPath);

const row = records.find(r => r.collection.trim() === collection && r.slug.trim() === slug);
if (!row) {
  console.error(`❌  No row found for collection="${collection}" slug="${slug}" in ${csvPath}`);
  process.exit(1);
}

if ((row.faq_done || '').trim() === 'Yes') {
  console.log(`ℹ️   ${collection}/${slug} was already marked Yes — no change.`);
  process.exit(0);
}

row.faq_done = 'Yes';
writeCsv(csvPath, header, records);
console.log(`✅  Marked faq_done=Yes for ${collection}/${slug} in ${csvPath}`);
