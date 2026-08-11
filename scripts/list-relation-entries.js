#!/usr/bin/env node
'use strict';

/**
 * list-relation-entries.js — content types + every entry's title/slug/
 * excerpt across all of them (no full body, no current-relations lookup —
 * that needs a full `populate=*` fetch per entry, done only for the entries
 * actually selected to Run/Write).
 *
 * Served from lib/relations/corpus-cache.js by default: the corpus is
 * ~4,600 entries and takes ~55s to fetch live, so a tab open/reload reads
 * the cache (near-instant) rather than re-paying that every time. Pass
 * `--refresh` to force a live re-fetch and overwrite the cache — wired to
 * the Relations tab's "Refresh" button for when content has actually changed
 * in Strapi.
 *
 * Usage: node scripts/list-relation-entries.js [--refresh]
 */

const { getCorpus } = require('../lib/relations/corpus-cache');

async function main() {
  const forceRefresh = process.argv.includes('--refresh');
  const { contentTypes, corpusIndex, updatedAt, fromCache } = await getCorpus({ forceRefresh });
  process.stdout.write(JSON.stringify({ contentTypes, entries: corpusIndex, updatedAt, fromCache }));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err.message || String(err) }));
  process.exitCode = 1;
});
