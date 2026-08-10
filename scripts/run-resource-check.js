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
 * Results are persisted to data/resource-checks.json AS EACH ROW COMPLETES,
 * not once at the end. Writes are deliberately paced (see lib/resources/
 * classify.js), so a batch runs for tens of minutes and can be killed
 * part-way — by the API route's timeout, or a Ctrl-C. Anything already
 * written to production must be on disk before that happens.
 *
 * Usage:
 *   node scripts/run-resource-check.js --slugs=a,b,c [--action=write] [--gap-minutes=8]
 *
 * --gap-minutes controls the pace of writes: 0 writes them back-to-back (for
 * repairing a failed run), anything else spaces them by that many minutes ±20%.
 *
 * Prints exactly ONE line of JSON to stdout; all progress goes to stderr so
 * stdout stays clean for the caller to JSON.parse. When spawned detached by
 * the API route nobody reads stdout — progress is reported through
 * lib/resources/batch-store.js instead, and stderr goes to data/.batch.log.
 */

const { fetchAllResources, fetchTaxonomy, assertCliAvailable, writeRateLimitStatus } = require('../lib/resources/shared');
const { classifyAll, applyRows, normalizeGapMinutes, DEFAULT_GAP_MINUTES } = require('../lib/resources/classify');
const { computeDuplicates } = require('../lib/resources/audit');
const { upsertResults } = require('../lib/resources/checks-store');
const batch = require('../lib/resources/batch-store');

function parseArgs(argv) {
  const args = { limit: 1, slugs: null, action: 'run' };
  for (const a of argv) {
    if (a.startsWith('--limit=')) args.limit = parseInt(a.slice('--limit='.length), 10);
    else if (a.startsWith('--slugs=')) {
      args.slugs = a
        .slice('--slugs='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === '--apply') args.action = 'write'; // back-compat alias
    else if (a.startsWith('--action=')) args.action = a.slice('--action='.length);
    else if (a.startsWith('--batch-id=')) args.batchId = a.slice('--batch-id='.length);
    // Minutes between writes. 0 = fast (no gap). Omitted = the 8-minute default.
    else if (a.startsWith('--gap-minutes=')) args.gapMinutes = Number(a.slice('--gap-minutes='.length));
  }
  return args;
}

function log(...msg) {
  console.error(...msg); // stderr — stdout is reserved for the final JSON line
}

const now = () => new Date().toISOString();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!['run', 'write'].includes(args.action)) {
    throw new Error(`invalid --action "${args.action}" — must be run or write`);
  }
  if (!args.slugs && (!Number.isFinite(args.limit) || args.limit < 1)) {
    throw new Error(`invalid --limit "${args.limit}"`);
  }

  // The API route has already written the initial state (including this pid).
  // Running straight from a terminal, it hasn't — seed it here so the UI can
  // still see a CLI batch in progress.
  if (!batch.read() || batch.read().batchId !== args.batchId) {
    batch.write({
      batchId: args.batchId || `cli-${process.pid}`,
      action: args.action,
      pid: process.pid,
      status: 'running',
      startedAt: now(),
    });
  }
  batch.patch({ phase: 'loading', current: '', error: null });

  // A Stop click SIGTERMs this process group. Record why it ended, otherwise
  // the state file says "running" against a pid that no longer exists.
  process.on('SIGTERM', () => {
    batch.patch({ status: 'stopped', phase: 'stopped', finishedAt: now() });
    process.exit(143);
  });

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

  // Persist each row the moment it's final. auditComputed:false here so a
  // single-row upsert preserves whatever duplicate findings that slug already
  // had — the audit below fills them in properly once it has run.
  const persistRow = (row) => upsertResults([row], [], { auditComputed: false });

  // `current` is what's in flight RIGHT NOW and clears when idle; `lastDone` is
  // the most recent finish. Keeping them apart is what lets the table mark one
  // row as running rather than mislabelling the last finished row as active
  // during a 5-10 minute gap.
  const onStart = (slug) => batch.patch({ current: slug });

  const onClassified = (row) => {
    persistRow(row);
    batch.patch({ classified: (batch.read()?.classified || 0) + 1, current: '', lastDone: row.slug });
  };

  const onWritten = (row) => {
    persistRow(row);
    const s = batch.read() || {};
    const next = { current: '', lastDone: row.slug };
    if (row.write_status === 'applied') next.applied = (s.applied || 0) + 1;
    else if (row.write_status === 'skipped:rate-limited') next.rateLimited = (s.rateLimited || 0) + 1;
    else if (row.write_status.startsWith('failed')) next.failed = (s.failed || 0) + 1;
    // skipped:not-ok rows never enter the write loop, so they don't move the counter.
    if (row.write_status !== 'skipped:not-ok') next.written = (s.written || 0) + 1;
    batch.patch(next);
  };

  batch.patch({ phase: 'classifying', total: targets.length, classified: 0, nextWriteAt: null });
  log(`Classifying ${targets.length} resource(s)...`);
  const classifyRows = await classifyAll(resources, taxonomy, selector, { onRow: onClassified, onStart });

  let auditRows = [];
  if (args.action === 'run') {
    batch.patch({ phase: 'auditing', current: '' });
    log('Checking for duplicate content (against the full corpus, for accurate cross-page detection)...');
    auditRows = computeDuplicates(resources).filter((r) => targetSlugs.has(r.resource_slug));
    upsertResults(classifyRows, auditRows, { auditComputed: true });
  }

  let applyResult = null;
  if (args.action === 'write') {
    const writeTotal = classifyRows.filter((r) => r.status === 'ok').length;
    const gapMinutes = normalizeGapMinutes(args.gapMinutes ?? DEFAULT_GAP_MINUTES);
    batch.patch({
      phase: 'writing',
      current: '',
      writeTotal,
      written: 0,
      applied: 0,
      failed: 0,
      rateLimited: 0,
      gapMinutes,
      gapMode: gapMinutes === 0 ? 'fast' : 'paced',
    });
    log(
      gapMinutes === 0
        ? `Writing ${writeTotal} resource(s) — FAST, no gap between writes...`
        : `Writing ${writeTotal} resource(s) — one at a time, ~${gapMinutes} min apart...`,
    );
    applyResult = await applyRows(classifyRows, resources, taxonomy, {
      onRow: onWritten,
      onStart,
      gapMinutes,
      onGap: (ms) => batch.patch({ nextWriteAt: new Date(Date.now() + ms).toISOString() }),
    });
    if (applyResult.abortedReason) {
      batch.patch({ abortedReason: applyResult.abortedReason });
    }
  }

  const result = {
    action: args.action,
    classifyRows,
    auditRows,
    applyResult,
    rateLimitStatus: writeRateLimitStatus(),
  };

  batch.patch({
    status: 'done',
    phase: 'done',
    current: '',
    nextWriteAt: null,
    finishedAt: now(),
    applyResult,
    rateLimitStatus: result.rateLimitStatus,
  });

  // The ONLY thing written to stdout — the caller parses this line as JSON.
  // Nothing reads it when the runner is detached; it's for CLI use.
  process.stdout.write(JSON.stringify(result));
}

main().catch((err) => {
  const message = err.message || String(err);
  batch.patch({ status: 'failed', phase: 'failed', error: message, finishedAt: now(), nextWriteAt: null });
  process.stdout.write(JSON.stringify({ error: message }));
  process.exitCode = 1;
});
