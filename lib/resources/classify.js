'use strict';

/**
 * classify.js — AI category/tag classification, ported from
 * cancerfax-strapi-backend/scripts/ai-classify-resources.js so this app is
 * self-sustaining. Every resource is classified via `claude -p` (same
 * mechanism the FAQ dashboard's lib/generate.ts uses), validated against the
 * live taxonomy before anything is ever written.
 */

const { API_BASE, checkAndRecordWrite, flattenResourceText } = require('./shared');
const { PROD_STRAPI_URL, strapiRequest, getAdminJwt, adminRequest, sleep } = require('./strapi-client');
const { callClaude: callClaudeCli, describeModelOutput: describeModelOutputGeneric } = require('../ai-cli');

const RESOURCE_ENDPOINT = `${API_BASE}/resources`;
const RESOURCE_CM_ENDPOINT = `${PROD_STRAPI_URL}/content-manager/collection-types/api::resource.resource`;
const MIN_TAGS = 3;
const MAX_TAGS = 5; // hard cap — never write more than 5 regardless of model output

// ─── Write pacing ─────────────────────────────────────────────────────────────
//
// Writes are always SEQUENTIAL — a human never edits three articles in the same
// second, which is exactly what the old concurrency-3 Promise.all did.
//
// The gap BETWEEN them is the caller's choice:
//
//   paced (gapMinutes > 0) — the default. Strapi's edit history then reads like
//     a person working through a list across a session. The gap is jittered by
//     ±20% on every draw: a dead-regular cadence has as clear a machine
//     signature as no gap at all.
//   fast (gapMinutes === 0) — no gap. For repairing a failed run, where the
//     articles were going to be edited anyway and waiting hours buys nothing.
//
// Paced is slow on purpose: at 8 minutes a 25-resource batch runs about three
// hours, which is why applyRows persists every row as it lands.

const DEFAULT_GAP_MINUTES = 8;
const GAP_JITTER = 0.2; // ±20%
const MIN_GAP_MINUTES = 0.5;
const MAX_GAP_MINUTES = 60;

// A human saves the edit, then hits publish a moment later — not in the same
// tick. This sits INSIDE one resource's write, so fast mode keeps it.
const PUBLISH_GAP_MIN_MS = 900;
const PUBLISH_GAP_MAX_MS = 4_000;

// A systemic failure — wrong password, Strapi down, taxonomy wiped — fails every
// row identically. Without this, a paced batch discovers that only after burning
// hours; it already cost one 4h17m run of 35 straight 401s.
const MAX_CONSECUTIVE_FAILURES = 3;

function randBetween(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

/**
 * Clamp a caller-supplied gap. Returns 0 for fast mode; anything else is held
 * inside the allowed band. Never trust the value straight off the wire.
 *
 * The guard on the FORM of the input is the important part, not the range
 * check: Number(null), Number(''), Number([]) and Number(false) are all 0, and
 * 0 here means "write to production as fast as Strapi will accept". A missing
 * or malformed value must never be able to select that. Only an explicit
 * numeric zero does; everything vague falls back to the paced default.
 */
function normalizeGapMinutes(value) {
  const looksNumeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  if (!looksNumeric) return DEFAULT_GAP_MINUTES;

  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_GAP_MINUTES;
  if (n === 0) return 0; // fast — deliberately chosen
  return Math.min(MAX_GAP_MINUTES, Math.max(MIN_GAP_MINUTES, n));
}

/** One inter-write gap: the chosen minutes ±20%, redrawn every time. 0 stays 0. */
function humanGapMs(gapMinutes = DEFAULT_GAP_MINUTES) {
  const minutes = normalizeGapMinutes(gapMinutes);
  if (minutes === 0) return 0;
  const base = minutes * 60_000;
  return randBetween(base * (1 - GAP_JITTER), base * (1 + GAP_JITTER));
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(resource, taxonomy) {
  const categoryList = taxonomy.categories.map((c) => `- ${c.slug} — ${c.name}`).join('\n');
  const tagsByGroup = new Map();
  for (const t of taxonomy.tags) {
    const group = t.groups[0] || 'Other';
    if (!tagsByGroup.has(group)) tagsByGroup.set(group, []);
    tagsByGroup.get(group).push(`${t.slug} — ${t.name}`);
  }
  const tagList = [...tagsByGroup.entries()]
    .map(([group, items]) => `${group}:\n${items.map((i) => `  - ${i}`).join('\n')}`)
    .join('\n');

  return `You are classifying a CancerFax blog article ("resource") for its CMS category and tags.

CancerFax is a specialist cancer patient-navigation and advanced-treatment-access platform — never describe it as generic medical tourism. Classify the article on its own merits.

=====================================================================
ALLOWED CATEGORIES (pick exactly ONE slug from this list — never invent one)
=====================================================================
${categoryList}

=====================================================================
ALLOWED TAGS (pick 3 to 5 slugs from this list — never invent one, never fewer than 3, never more than 5)
=====================================================================
${tagList}

=====================================================================
HOW MANY TAGS
=====================================================================
Pick the number the article earns, not the maximum. Judge it on content:

  3 tags — focused on a single treatment, a single cancer type, or a single
           destination. This is the common case.
  4 tags — a clear second dimension as well, e.g. a treatment AND a specific
           country, or a treatment AND a distinct patient-access angle.
  5 tags — only when the article genuinely covers five distinct facets.
           This should be uncommon.

Never pad to reach a higher count. A tag the article only mentions in passing,
or that merely restates another tag you already picked, is a wrong tag. Fewer
accurate tags beat more loose ones.

=====================================================================
ARTICLE
=====================================================================
${flattenResourceText(resource)}

=====================================================================
OUTPUT FORMAT
=====================================================================
Return ONLY a single JSON object, no preamble, no code fences, matching exactly:
{
  "categorySlug": "<one slug from ALLOWED CATEGORIES>",
  "tagSlugs": ["<3 to 5 slugs from ALLOWED TAGS>"],
  "rationale": "<one short sentence explaining the fit>"
}
`;
}

// callClaude/describeModelOutput's transport and brace-balancing JSON parsing
// live in lib/ai-cli.js now, shared with lib/relations/classify.js — nothing
// there is resource-specific. The wrappers below pin this module's original,
// resource-classification-shaped behavior (categorySlug/tagSlugs) so callers
// and tests here see no change.

const isClassificationShaped = (o) => typeof o.categorySlug === 'string' && Array.isArray(o.tagSlugs);

function describeModelOutput(text) {
  return describeModelOutputGeneric(text, isClassificationShaped);
}

function callClaude(prompt) {
  return callClaudeCli(prompt, { isShaped: isClassificationShaped });
}

// ─── Validation — the hard gate; nothing failing this is ever written ────────

function validateClassification(raw, taxonomy) {
  const catSlugs = new Set(taxonomy.categories.map((c) => c.slug));
  const tagSlugs = new Set(taxonomy.tags.map((t) => t.slug));

  if (!raw || typeof raw.categorySlug !== 'string' || !catSlugs.has(raw.categorySlug)) {
    return { ok: false, reason: 'unknown-category' };
  }
  if (!Array.isArray(raw.tagSlugs)) {
    return { ok: false, reason: 'tags-not-array' };
  }
  const uniqueTags = [...new Set(raw.tagSlugs)];
  if (uniqueTags.length < MIN_TAGS || uniqueTags.length > MAX_TAGS) {
    return { ok: false, reason: `tag-count:${uniqueTags.length}` };
  }
  const unknown = uniqueTags.filter((s) => !tagSlugs.has(s));
  if (unknown.length > 0) {
    return { ok: false, reason: `unknown-tag:${unknown.join('|')}` };
  }
  return { ok: true, categorySlug: raw.categorySlug, tagSlugs: uniqueTags, rationale: raw.rationale || '' };
}

// ─── Classify ─────────────────────────────────────────────────────────────────

/**
 * `selector` is either a plain number (first N resources) or
 * { limit, slugs } — slugs, when given, targets exactly those resources
 * (multi-select from the table) and takes priority over limit.
 */
function resolveTargets(resources, selector) {
  if (selector && typeof selector === 'object') {
    if (Array.isArray(selector.slugs) && selector.slugs.length > 0) {
      const wanted = new Set(selector.slugs);
      return resources.filter((r) => wanted.has(r.slug));
    }
    return selector.limit ? resources.slice(0, selector.limit) : resources;
  }
  return selector ? resources.slice(0, selector) : resources;
}

/**
 * `opts.onStart(slug)` fires BEFORE a resource is worked on and `opts.onRow(row)`
 * after it finishes, so the caller can both show what is in flight right now and
 * persist each result as it lands.
 */
async function classifyAll(resources, taxonomy, selector, opts = {}) {
  const onRow = typeof opts.onRow === 'function' ? opts.onRow : () => {};
  const onStart = typeof opts.onStart === 'function' ? opts.onStart : () => {};
  const targets = resolveTargets(resources, selector);
  const rows = [];

  for (let i = 0; i < targets.length; i++) {
    const resource = targets[i];
    const oldCategory = resource.resource_category?.slug || '';
    const oldTags = (resource.resource_tags || []).map((t) => t.slug).join(';');

    console.error(`  [${i + 1}/${targets.length}] ${resource.slug}`);
    onStart(resource.slug);

    let result;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const prompt =
          attempt === 1
            ? buildPrompt(resource, taxonomy)
            : buildPrompt(resource, taxonomy) +
              `\n\nYour previous answer was invalid (${result?.reason}). ` +
              'Re-read the ALLOWED lists and return a corrected JSON object using ONLY those slugs, with 3 to 5 tagSlugs.';
        const raw = await callClaude(prompt);
        result = validateClassification(raw, taxonomy);
        if (result.ok) break;
      } catch (e) {
        result = { ok: false, reason: `error:${e.message}` };
      }
    }

    const row = {
      slug: resource.slug,
      title: resource.title || '',
      old_category: oldCategory,
      new_category: result.ok ? result.categorySlug : '',
      old_tags: oldTags,
      new_tags: result.ok ? result.tagSlugs.join(';') : '',
      status: result.ok ? 'ok' : 'needs-manual-review',
      reason: result.ok ? result.rationale : result.reason,
      write_status: 'dry-run',
    };
    rows.push(row);
    onRow(row);

    await sleep(150);
  }

  return rows;
}

// ─── Apply (writes to Strapi) ─────────────────────────────────────────────────

/** One resource's actual write — admin-JWT + content-manager when an admin identity is configured, else the API token. */
async function writeResourceUpdate(resource, categoryDocId, tagDocIds, adminJwt) {
  const relationBody = {
    resource_category: { set: [{ documentId: categoryDocId }] },
    resource_tags: { set: tagDocIds.map((documentId) => ({ documentId })) },
  };

  if (adminJwt) {
    // content-manager takes fields at the top level of the body (no `{ data }` wrapper),
    // and publish is always a separate call — no `?status=published` shortcut here.
    await adminRequest(`${RESOURCE_CM_ENDPOINT}/${resource.documentId}?locale=en`, adminJwt, {
      method: 'PUT',
      body: JSON.stringify(relationBody),
    });
    await sleep(randBetween(PUBLISH_GAP_MIN_MS, PUBLISH_GAP_MAX_MS));
    await adminRequest(`${RESOURCE_CM_ENDPOINT}/${resource.documentId}/actions/publish?locale=en`, adminJwt, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } else {
    await strapiRequest(`${RESOURCE_ENDPOINT}/${resource.documentId}?status=published`, {
      method: 'PUT',
      body: JSON.stringify({ data: relationBody }),
    });
  }
}

/**
 * Writes resource_category + resource_tags for every "ok" row, ONE AT A TIME
 * with a humanised gap between them (see the write-pacing block above), then
 * republishes each. Logs in ONCE as the configured admin (if any) and reuses
 * that JWT for the whole batch, so Strapi's history attributes every write in
 * this run to that admin user rather than the API token's creator. Falls back
 * to token writes with a console warning if no admin identity is set, or if
 * that login fails.
 *
 * Every write is gated by checkAndRecordWrite() — a self-imposed cap of 100
 * writes per rolling 5 minutes. Once hit, remaining rows are marked
 * "skipped:rate-limited" rather than queued — re-run later for the rest. Paced
 * mode can't realistically reach that cap; FAST mode can, at roughly 100 rows,
 * which is exactly why it still applies there.
 *
 * `opts.gapMinutes` sets the pace — 0 for fast, omitted for the 8-minute default.
 *
 * `opts.onRow(row)` is called as soon as each row's write_status is final, so
 * the caller can persist incrementally. A batch runs for hours, so it must
 * survive being killed part-way: anything already written to production has to
 * be on disk before the process dies.
 *
 * `opts.onGap(ms)` reports how long the next pause will be, so the UI can show
 * a countdown instead of an idle spinner.
 */
async function applyRows(rows, resources, taxonomy, opts = {}) {
  const onRow = typeof opts.onRow === 'function' ? opts.onRow : () => {};
  const onStart = typeof opts.onStart === 'function' ? opts.onStart : () => {};
  const onGap = typeof opts.onGap === 'function' ? opts.onGap : () => {};
  const gapMinutes = normalizeGapMinutes(opts.gapMinutes ?? DEFAULT_GAP_MINUTES);
  const resourceBySlug = new Map(resources.map((r) => [r.slug, r]));
  const categoryBySlug = new Map(taxonomy.categories.map((c) => [c.slug, c.documentId]));
  const tagBySlug = new Map(taxonomy.tags.map((t) => [t.slug, t.documentId]));

  let adminJwt = null;
  let writeVia = 'api-token';
  try {
    adminJwt = await getAdminJwt();
    if (adminJwt) writeVia = 'admin-jwt';
  } catch (e) {
    console.error(`Admin login failed (${e.message}) — falling back to API-token writes.`);
  }

  let applied = 0;
  let failed = 0;
  let rateLimited = 0;
  let consecutiveFailures = 0;
  let abortedReason = null;

  const writable = rows.filter((r) => r.status === 'ok');
  for (const row of rows) {
    if (row.status !== 'ok') {
      row.write_status = 'skipped:not-ok';
      onRow(row);
    }
  }

  for (let i = 0; i < writable.length; i++) {
    const row = writable[i];
    onStart(row.slug);
    const resource = resourceBySlug.get(row.slug);

    if (!resource) {
      console.error(`  ✗ ${row.slug}: no longer exists in Strapi — skipped`);
      row.write_status = 'failed:resource-not-found';
      failed++;
      consecutiveFailures++;
      onRow(row);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        abortedReason = 'resource-not-found';
        break;
      }
      continue; // nothing was written, so no gap needed before the next one
    }

    const categoryDocId = categoryBySlug.get(row.new_category);
    const tagDocIds = row.new_tags.split(';').filter(Boolean).map((s) => tagBySlug.get(s));
    if (!categoryDocId || tagDocIds.some((id) => !id)) {
      console.error(`  ✗ ${row.slug}: category/tag slug no longer exists in live taxonomy — skipped`);
      row.write_status = 'failed:stale-taxonomy-slug';
      failed++;
      consecutiveFailures++;
      onRow(row);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        abortedReason = 'stale-taxonomy-slug';
        break;
      }
      continue;
    }

    const gate = checkAndRecordWrite();
    if (!gate.allowed) {
      console.error(
        `  ⏸ ${row.slug}: write rate limit reached (100/5min) — retry in ${Math.ceil(gate.retryAfterMs / 1000)}s`,
      );
      row.write_status = 'skipped:rate-limited';
      rateLimited++;
      onRow(row);
      continue;
    }

    try {
      try {
        await writeResourceUpdate(resource, categoryDocId, tagDocIds, adminJwt);
      } catch (e) {
        // A 401 mid-batch means the admin JWT went stale — it's fetched once at
        // the start and a paced batch runs for hours. Re-login and retry this
        // row; the fresh token is kept for the rest of the run, so an expiry
        // costs one retry rather than every remaining write.
        if (adminJwt && /\[401\]/.test(e.message)) {
          console.error(`  ↻ ${row.slug}: 401 — refreshing the admin session and retrying`);
          adminJwt = await getAdminJwt();
          if (!adminJwt) throw e; // credentials gone entirely — the original error is the useful one
          await writeResourceUpdate(resource, categoryDocId, tagDocIds, adminJwt);
        } else {
          throw e;
        }
      }
      console.error(`  ✓ [${i + 1}/${writable.length}] ${row.slug} (via ${writeVia})`);
      row.write_status = 'applied';
      applied++;
      consecutiveFailures = 0;
    } catch (e) {
      console.error(`  ✗ [${i + 1}/${writable.length}] ${row.slug}: ${e.message}`);
      row.write_status = `failed:${e.message}`;
      failed++;
      consecutiveFailures++;
    }
    onRow(row);

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      abortedReason = row.write_status.replace(/^failed:/, '');
      break;
    }

    // Pace the NEXT write. Nothing to wait for after the last one, and fast
    // mode (gapMinutes 0) has nothing to wait for at all.
    if (i < writable.length - 1 && gapMinutes > 0) {
      const gap = humanGapMs(gapMinutes);
      console.error(`    …next write in ${Math.round(gap / 60_000)}m ${Math.round((gap % 60_000) / 1000)}s`);
      onGap(gap);
      await sleep(gap);
    }
  }

  if (abortedReason) {
    console.error(
      `\n⛔ Stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures (${abortedReason}).\n` +
        '   This looks systemic rather than per-resource — fix the cause and re-run.\n',
    );
  }

  return { applied, failed, rateLimited, writeVia, gapMinutes, abortedReason };
}

module.exports = {
  classifyAll,
  applyRows,
  validateClassification,
  describeModelOutput,
  buildPrompt,
  resolveTargets,
  humanGapMs,
  normalizeGapMinutes,
  MIN_TAGS,
  MAX_TAGS,
  DEFAULT_GAP_MINUTES,
  MIN_GAP_MINUTES,
  MAX_GAP_MINUTES,
  GAP_JITTER,
  MAX_CONSECUTIVE_FAILURES,
};
