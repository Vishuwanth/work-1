'use strict';

/**
 * write.js — applies approved relation proposals to Strapi. The relations
 * analogue of lib/resources/classify.js's writeResourceUpdate/applyRows,
 * reusing that module's transport, pacing, rate-limit, and failure-abort
 * logic directly rather than forking it — see the imports below.
 *
 * ONE simplification versus the resources writer, deliberate for this first
 * version: writes always go through the plain API token
 * (`strapiRequest`/`PROD_STRAPI_URL/api/...`), never the admin-JWT
 * content-manager path. Resources' admin path targets a UID
 * (`api::resource.resource`) already confirmed by this app for months;
 * guessing that UID for nine more content types this app has never written
 * to before (`api::clinical-trial.clinical-trial`, …) is exactly the kind
 * of assumption a first Write pass on new content types shouldn't carry.
 * The trade-off is Strapi attributes these writes to the token's creator
 * rather than a specific human admin — acceptable for a first version;
 * revisit once the UID pattern is confirmed for each type.
 */

const { API_BASE } = require('../resources/shared');
const { strapiRequest, sleep } = require('../resources/strapi-client');
const { checkAndRecordWrite } = require('../resources/shared');
const { humanGapMs, normalizeGapMinutes, MAX_CONSECUTIVE_FAILURES, DEFAULT_GAP_MINUTES } = require('../resources/classify');

/**
 * `{ field: { set: [{documentId}, ...] } }` — one entry per writable
 * relation field this row is touching. ADDITIVE: each field's set is the
 * union of what's already current (from `row.currentRelations`, resolved at
 * Run time) and the newly-approved proposals, never a replacement — a
 * relation-suggestion tool must never silently drop a relation someone else
 * already set. A field with no new proposal for this row is left untouched
 * entirely (not included in the body at all), so a write never re-sends a
 * field that isn't actually changing.
 */
function buildRelationBody(row) {
  const fieldsWithProposals = new Set((row.proposedRelations || []).filter((r) => r.writable).map((r) => r.relationType));
  if (fieldsWithProposals.size === 0) return null;

  const byField = new Map([...fieldsWithProposals].map((f) => [f, new Set()]));
  for (const cur of row.currentRelations || []) {
    if (byField.has(cur.field)) byField.get(cur.field).add(cur.documentId);
  }
  for (const rel of row.proposedRelations || []) {
    if (rel.writable && byField.has(rel.relationType)) byField.get(rel.relationType).add(rel.targetDocumentId);
  }

  const body = {};
  for (const [field, ids] of byField) {
    body[field] = { set: [...ids].map((documentId) => ({ documentId })) };
  }
  return body;
}

async function writeOneEntry(row, typeConfig) {
  const body = buildRelationBody(row);
  if (!body) throw new Error('nothing-to-write');
  await strapiRequest(`${API_BASE}/${typeConfig.plural}/${row.documentId}?status=published`, {
    method: 'PUT',
    body: JSON.stringify({ data: body }),
  });
}

/**
 * Writes every row whose write_status is `pending-write` (set by
 * scripts/run-relation-check.js's --action=write branch — see its header
 * for why it never re-classifies). Same write discipline as
 * lib/resources/classify.js's applyRows: sequential, paced, rate-limited via
 * the SAME shared counter (`checkAndRecordWrite` — a Strapi-wide budget, not
 * per-feature), and aborts after `MAX_CONSECUTIVE_FAILURES` in a row.
 *
 * `opts.contentTypes` is a `Map<apiId, typeConfig>` (from discovery). Rows
 * naming a content type discovery didn't find are failed individually
 * rather than aborting the batch — genuinely shouldn't happen (the runner
 * only builds rows from discovered types) but a stale checks-store entry
 * from a config that changed shape is not a systemic failure.
 */
async function applyRelations(rows, opts = {}) {
  const onRow = typeof opts.onRow === 'function' ? opts.onRow : () => {};
  const onGap = typeof opts.onGap === 'function' ? opts.onGap : () => {};
  const gapMinutes = normalizeGapMinutes(opts.gapMinutes ?? DEFAULT_GAP_MINUTES);
  const contentTypes = opts.contentTypes || new Map();

  const writable = [];
  for (const row of rows) {
    if (row.write_status !== 'pending-write') {
      row.write_status = row.write_status || 'skipped:not-ok';
      onRow(row);
      continue;
    }
    const typeConfig = contentTypes.get(row.contentType);
    if (!typeConfig) {
      row.write_status = 'failed:unknown-content-type';
      onRow(row);
      continue;
    }
    if (!buildRelationBody(row)) {
      row.write_status = 'skipped:nothing-to-write';
      onRow(row);
      continue;
    }
    writable.push(row);
  }

  let applied = 0;
  let failed = 0;
  let rateLimited = 0;
  let consecutiveFailures = 0;
  let abortedReason = null;

  for (let i = 0; i < writable.length; i++) {
    const row = writable[i];
    const typeConfig = contentTypes.get(row.contentType);

    const gate = checkAndRecordWrite();
    if (!gate.allowed) {
      console.error(`  ⏸ ${row.key}: write rate limit reached (100/5min) — retry in ${Math.ceil(gate.retryAfterMs / 1000)}s`);
      row.write_status = 'skipped:rate-limited';
      rateLimited++;
      onRow(row);
      continue;
    }

    try {
      await writeOneEntry(row, typeConfig);
      console.error(`  ✓ [${i + 1}/${writable.length}] ${row.key}`);
      row.write_status = 'applied';
      applied++;
      consecutiveFailures = 0;
    } catch (e) {
      console.error(`  ✗ [${i + 1}/${writable.length}] ${row.key}: ${e.message}`);
      row.write_status = `failed:${e.message}`;
      failed++;
      consecutiveFailures++;
    }
    onRow(row);

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      abortedReason = row.write_status.replace(/^failed:/, '');
      break;
    }

    if (i < writable.length - 1 && gapMinutes > 0) {
      const gap = humanGapMs(gapMinutes);
      // Floor the minutes first, THEN take the remainder in seconds —
      // rounding each independently (as an earlier version of this line did)
      // can round e.g. a 33s gap up to "1m 33s" instead of down to "0m 33s",
      // since 33s/60 = 0.55 rounds up to 1 on its own.
      const totalSec = Math.round(gap / 1000);
      console.error(`    …next write in ${Math.floor(totalSec / 60)}m ${totalSec % 60}s`);
      onGap(gap);
      await sleep(gap);
    }
  }

  if (abortedReason) {
    console.error(`\n⛔ Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures (${abortedReason}).\n`);
  }

  return { applied, failed, rateLimited, gapMinutes, abortedReason };
}

module.exports = { applyRelations, buildRelationBody };
