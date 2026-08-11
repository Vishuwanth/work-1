#!/usr/bin/env node
'use strict';

/**
 * discover-content-types.js — the "Discover live content types" button:
 * confirms every registered type is still live, refreshes entry counts,
 * and — via lib/relations/corpus-cache.js — ALSO refreshes the cached
 * corpus index other scripts read from, so a click here is the one action
 * that guarantees everything downstream (the Relations list, a Run/Write
 * batch) sees current data. Always forces a live fetch: this button's whole
 * purpose is "I want current numbers right now", so it would defeat the
 * point to serve it from its own cache.
 *
 * No AI call, no writes.
 *
 * Usage: node scripts/discover-content-types.js
 */

const { getCorpus } = require('../lib/relations/corpus-cache');

async function main() {
  const { contentTypes, updatedAt } = await getCorpus({ forceRefresh: true });
  process.stdout.write(JSON.stringify({ contentTypes, updatedAt }));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err.message || String(err) }));
  process.exitCode = 1;
});
