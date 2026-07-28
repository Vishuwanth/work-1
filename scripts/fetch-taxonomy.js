#!/usr/bin/env node
'use strict';

/**
 * fetch-taxonomy.js — READ-ONLY. Fetches the live resource-category and
 * resource-tag collections (categories, and tags with their groups) and
 * prints them as one JSON line. No AI call, no resource fetch, no writes.
 *
 * Self-contained — see scripts/list-resources.js.
 *
 * Usage: node scripts/fetch-taxonomy.js
 */

const { fetchTaxonomy } = require('../lib/resources/shared');

async function main() {
  const taxonomy = await fetchTaxonomy();
  process.stdout.write(JSON.stringify({ categories: taxonomy.categories, tags: taxonomy.tags }));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err.message || String(err) }));
  process.exitCode = 1;
});
