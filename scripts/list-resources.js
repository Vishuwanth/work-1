#!/usr/bin/env node
'use strict';

/**
 * list-resources.js — READ-ONLY, cheap. Fetches title/slug/category/tags for
 * every published resource — no `content` (the expensive rich-text body) — so
 * the Resources tab can show a browsable/selectable list without paying the
 * cost of fetching every article's full body up front. Content only gets
 * fetched (by run-resource-check.js) for the resources actually selected to
 * Run or Write.
 *
 * Self-contained — uses this app's own lib/resources/ modules and its own
 * encrypted credentials store (Resources tab → Credentials). No dependency
 * on any sibling repo.
 *
 * Usage: node scripts/list-resources.js
 */

const { fetchResourceList } = require('../lib/resources/shared');

async function main() {
  const resources = await fetchResourceList();
  const rows = resources.map((r) => ({
    slug: r.slug,
    title: r.title || '',
    category: r.resource_category?.slug || '',
    tags: (r.resource_tags || []).map((t) => t.slug).join(';'),
  }));

  process.stdout.write(JSON.stringify({ resources: rows }));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err.message || String(err) }));
  process.exitCode = 1;
});
