#!/usr/bin/env node
'use strict';

/**
 * run-resource-check.js — bridges the Resources tab's Run/Write buttons to
 * the classify/audit logic in lib/resources/. Self-contained: no dependency
 * on any sibling repo.
 *
 * Two actions:
 *   --action=run    (default) classify (category + tags) AND check duplicate
 *                    content for the targeted resources. Never writes.
 *   --action=write   classify only (no duplicate-content check — nothing ever
 *                    writes duplicate-content findings, so there's no reason
 *                    to spend time computing them here) and APPLY the result:
 *                    resource_category + resource_tags, then republish.
 *
 * Target the resources to check with EITHER:
 *   --slugs=slug-a,slug-b,slug-c   (multi-select from the review app's table)
 *   --limit=N                      (first N resources — fallback/CLI use)
 *
 * Every batch's results are persisted to data/resource-checks.json so the
 * checked/not-checked state survives a page reload.
 *
 * Usage:
 *   node scripts/run-resource-check.js --slugs=a,b,c [--action=write] [--concurrency=3]
 *
 * Prints exactly ONE line of JSON to stdout; all progress goes to stderr so
 * stdout stays clean for the caller to JSON.parse.
 */

const { fetchAllResources, fetchTaxonomy, assertCliAvailable, writeRateLimitStatus } = require('../lib/resources/shared');
const { classifyAll, applyRows } = require('../lib/resources/classify');
const { computeDuplicates } = require('../lib/resources/audit');
const { upsertResults } = require('../lib/resources/checks-store');

function parseArgs(argv) {
  const args = { limit: 1, slugs: null, concurrency: 3, action: 'run' };
  for (const a of argv) {
    if (a.startsWith('--limit=')) args.limit = parseInt(a.slice('--limit='.length), 10);
    else if (a.startsWith('--slugs=')) {
      args.slugs = a
        .slice('--slugs='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a.startsWith('--concurrency=')) args.concurrency = parseInt(a.slice('--concurrency='.length), 10);
    else if (a === '--apply') args.action = 'write'; // back-compat alias
    else if (a.startsWith('--action=')) args.action = a.slice('--action='.length);
  }
  return args;
}

function log(...msg) {
  console.error(...msg); // stderr — stdout is reserved for the final JSON line
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!['run', 'write'].includes(args.action)) {
    throw new Error(`invalid --action "${args.action}" — must be run or write`);
  }
  if (!args.slugs && (!Number.isFinite(args.limit) || args.limit < 1)) {
    throw new Error(`invalid --limit "${args.limit}"`);
  }
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) args.concurrency = 3;

  assertCliAvailable(
    'claude',
    ['--version'],
    'Install/authenticate the Claude Code CLI first (`claude --version` should succeed).',
  );

  log('Loading live taxonomy + resources...');
  const [taxonomy, resources] = await Promise.all([fetchTaxonomy(), fetchAllResources()]);
  log(`  ${taxonomy.categories.length} categories, ${taxonomy.tags.length} tags, ${resources.length} resources`);

  const selector = args.slugs && args.slugs.length ? { slugs: args.slugs } : { limit: args.limit };
  const targets =
    args.slugs && args.slugs.length ? resources.filter((r) => args.slugs.includes(r.slug)) : resources.slice(0, args.limit);
  const targetSlugs = new Set(targets.map((r) => r.slug));

  log(`Classifying ${targets.length} resource(s)...`);
  const classifyRows = await classifyAll(resources, taxonomy, selector);

  let auditRows = [];
  if (args.action === 'run') {
    log('Checking for duplicate content (against the full corpus, for accurate cross-page detection)...');
    auditRows = computeDuplicates(resources).filter((r) => targetSlugs.has(r.resource_slug));
  }

  let applyResult = null;
  if (args.action === 'write') {
    log(`Writing (resource_category + resource_tags, then republish, concurrency=${args.concurrency})...`);
    applyResult = await applyRows(classifyRows, resources, taxonomy, { concurrency: args.concurrency });
  }

  upsertResults(classifyRows, auditRows, { auditComputed: args.action === 'run' });

  const result = {
    action: args.action,
    classifyRows,
    auditRows,
    applyResult,
    rateLimitStatus: writeRateLimitStatus(),
  };

  // The ONLY thing written to stdout — the caller parses this line as JSON.
  process.stdout.write(JSON.stringify(result));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err.message || String(err) }));
  process.exitCode = 1;
});
