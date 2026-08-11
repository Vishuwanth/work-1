#!/usr/bin/env node
'use strict';

/**
 * run-relation-check.js — bridges the Relations tab's Run/Write buttons to
 * lib/relations/{discovery,shared,classify,write}. Mirrors
 * scripts/run-resource-check.js's shape and CLI contract.
 *
 * Two actions:
 *   --action=run    (default) maps relations for the targeted entries via
 *                    Claude (WebSearch allowed). Never writes to Strapi.
 *                    Paced the same way Write is: a randomized (±20%) gap
 *                    between each entry, so a multi-entry selection doesn't
 *                    map back-to-back just because nothing here touches
 *                    production — see the pacing block in the main loop.
 *   --action=write   Applies the relations from the MOST RECENT Run for the
 *                    targeted entries — it does NOT call Claude again. This
 *                    is deliberate: lib/resources/classify.js's own design
 *                    doc records that re-classifying on Write let a
 *                    non-deterministic `claude -p` output silently diverge
 *                    from the value a reviewer actually approved. A Write
 *                    with no prior Run for a given entry fails that entry
 *                    with `failed:not-yet-run` rather than mapping it fresh.
 *
 * Target the entries to check with EITHER:
 *   --keys=<contentType>:<slug>,...   multi-select from the review app's table
 *   --limit=N                         first N entries across all discovered
 *                                      content types (fallback/CLI use)
 * `--types=<apiId>,...` restricts either of the above to specific content
 * types.
 *
 * Results are persisted to data/relation-checks.json AS EACH ROW COMPLETES.
 * Prints exactly ONE line of JSON to stdout; all progress goes to stderr —
 * same contract as run-resource-check.js.
 *
 * Content types + the corpus index come from lib/relations/corpus-cache.js
 * (cached — see its header) rather than being fetched fresh on every call.
 * A batch that only maps one or two entries used to pay the full ~55s,
 * ~4,600-row corpus fetch anyway; now it's a cache read unless `--refresh`
 * is passed or nothing has ever been cached yet. Only the entry actually
 * being mapped is still fetched live and in full (`fetchEntryByDocumentId`,
 * `populate=*`) — the model always reasons over current content, even when
 * the candidate-target list is a cached snapshot.
 *
 * Usage:
 *   node scripts/run-relation-check.js --keys=treatment:car-t-therapy [--action=write] [--gap-minutes=8] [--refresh]
 */

const { getCorpus } = require('../lib/relations/corpus-cache');
const { fetchEntryByDocumentId, buildCorpusLookup, currentRelations } = require('../lib/relations/shared');
const { mapEntry, entryKey } = require('../lib/relations/classify');
const { applyRelations } = require('../lib/relations/write');
const { normalizeGapMinutes, DEFAULT_GAP_MINUTES, humanGapMs } = require('../lib/resources/classify');
const { sleep } = require('../lib/resources/strapi-client');
const checksStore = require('../lib/relations/checks-store');
const batch = require('../lib/relations/batch-store');

function parseArgs(argv) {
  const args = { limit: 5, keys: null, types: null, action: 'run', refresh: false };
  for (const a of argv) {
    if (a.startsWith('--limit=')) args.limit = parseInt(a.slice('--limit='.length), 10);
    else if (a.startsWith('--keys=')) {
      args.keys = a
        .slice('--keys='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a.startsWith('--types=')) {
      args.types = a
        .slice('--types='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a.startsWith('--action=')) args.action = a.slice('--action='.length);
    else if (a.startsWith('--batch-id=')) args.batchId = a.slice('--batch-id='.length);
    else if (a.startsWith('--gap-minutes=')) args.gapMinutes = Number(a.slice('--gap-minutes='.length));
    else if (a === '--refresh') args.refresh = true;
  }
  return args;
}

function toKey(indexEntry) {
  return entryKey(indexEntry.contentType, indexEntry.slug);
}

/** `--keys` takes priority over `--limit`, same precedence as resolveTargets() in lib/resources/classify.js. */
function resolveTargets(corpusIndex, args) {
  let pool = corpusIndex;
  if (Array.isArray(args.types) && args.types.length > 0) {
    const wanted = new Set(args.types);
    pool = pool.filter((e) => wanted.has(e.contentType));
  }
  if (Array.isArray(args.keys) && args.keys.length > 0) {
    const wanted = new Set(args.keys);
    return pool.filter((e) => wanted.has(toKey(e)));
  }
  return args.limit ? pool.slice(0, args.limit) : pool;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gapMinutes = normalizeGapMinutes(args.gapMinutes ?? DEFAULT_GAP_MINUTES);

  console.error('Loading content types + corpus…');
  const { contentTypes, corpusIndex, fromCache } = await getCorpus({ forceRefresh: args.refresh });
  console.error(fromCache ? '  using cached corpus (data/.relations-cache.json)' : '  fetched fresh from prod and cached it');
  const typeByApiId = new Map(contentTypes.map((t) => [t.apiId, t]));
  const corpusLookup = buildCorpusLookup(corpusIndex);

  const targets = resolveTargets(corpusIndex, args);
  if (targets.length === 0) {
    process.stdout.write(JSON.stringify({ error: 'no matching entries for the given --keys/--types/--limit' }));
    process.exitCode = 1;
    return;
  }

  batch.patch({ phase: args.action === 'write' ? 'writing' : 'mapping', current: '', total: targets.length, mapped: 0 });

  const rows = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const key = toKey(target);
    const typeConfig = typeByApiId.get(target.contentType);
    console.error(`  [${i + 1}/${targets.length}] ${key}`);
    batch.patch({ current: key });

    let row;
    if (args.action === 'write') {
      // Deliberately does NOT call Claude again — see the file header. Reads
      // exactly what the last Run proposed and approved for this key.
      const prior = checksStore.getAll()[key];
      if (!prior || !Array.isArray(prior.proposedRelations)) {
        row = { key, contentType: target.contentType, slug: target.slug, title: target.title, status: 'failed', reason: 'not-yet-run', proposedRelations: [], write_status: 'failed:not-yet-run' };
      } else {
        row = { ...prior, write_status: 'pending-write' };
      }
    } else {
      const entry = await fetchEntryByDocumentId(typeConfig, target.documentId);
      const result = await mapEntry({ entry, typeConfig, corpusIndex, corpusLookup });
      const currentRels = currentRelations(entry, typeConfig, corpusLookup);
      row = {
        key,
        contentType: target.contentType,
        slug: target.slug,
        title: target.title,
        // The SOURCE entry's own documentId — not any target's. Needed by a
        // later Write pass to know which Strapi row to PUT to, without
        // re-fetching (write.js never re-derives this from slug+contentType).
        documentId: target.documentId,
        currentRelations: currentRels,
        proposedRelations: result.ok ? result.relations : [],
        rejected: result.ok ? result.rejected : [],
        status: result.ok ? 'ok' : 'needs-manual-review',
        reason: result.ok ? '' : result.reason,
        write_status: 'dry-run',
      };
    }

    checksStore.upsertResult(key, row);
    rows.push(row);
    batch.patch({ mapped: i + 1 });

    // Paced, same principle as Write's pacing below: a multi-entry Run must
    // not map everything back-to-back just because nothing here writes to
    // Strapi. A dead-regular "one claude call the instant the last one
    // finishes" cadence is as obvious a mechanical signature as no gap at
    // all — see humanGapMs's own rationale in lib/resources/classify.js.
    // Skipped on the last entry (nothing left to wait for) and for `write`,
    // whose own pacing lives inside applyRelations() at §7 of the design doc.
    if (args.action !== 'write' && i < targets.length - 1 && gapMinutes > 0) {
      const gap = humanGapMs(gapMinutes);
      // Floor-then-remainder, not two independent Math.round calls — see
      // lib/relations/write.js's identical fix for why that misrenders a
      // short gap (e.g. 33s displaying as "1m 33s").
      const totalSec = Math.round(gap / 1000);
      console.error(`    …next entry in ${Math.floor(totalSec / 60)}m ${totalSec % 60}s`);
      batch.patch({ nextWriteAt: Date.now() + gap });
      await sleep(gap);
      batch.patch({ nextWriteAt: null });
    }
  }

  let writeSummary = null;
  if (args.action === 'write') {
    writeSummary = await applyRelations(rows, { contentTypes: typeByApiId, gapMinutes, onRow: (r) => checksStore.upsertResult(r.key, r), onGap: (ms) => batch.patch({ nextWriteAt: Date.now() + ms }) });
  }

  batch.patch({ status: 'done', finishedAt: new Date().toISOString() });
  process.stdout.write(JSON.stringify({ rows, writeSummary }));
}

main().catch((err) => {
  batch.patch({ status: 'error', error: err.message, finishedAt: new Date().toISOString() });
  process.stdout.write(JSON.stringify({ error: err.message || String(err) }));
  process.exitCode = 1;
});
