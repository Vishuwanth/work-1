'use strict';

/**
 * classify.js — AI category/tag classification, ported from
 * cancerfax-strapi-backend/scripts/ai-classify-resources.js so this app is
 * self-sustaining. Every resource is classified via `claude -p` (same
 * mechanism the FAQ dashboard's lib/generate.ts uses), validated against the
 * live taxonomy before anything is ever written.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const { API_BASE, checkAndRecordWrite, flattenResourceText } = require('./shared');
const { PROD_STRAPI_URL, strapiRequest, getAdminJwt, adminRequest, sleep } = require('./strapi-client');

const execFileP = promisify(execFile);

const RESOURCE_ENDPOINT = `${API_BASE}/resources`;
const RESOURCE_CM_ENDPOINT = `${PROD_STRAPI_URL}/content-manager/collection-types/api::resource.resource`;
const MIN_TAGS = 3;
const MAX_TAGS = 5; // hard cap — never write more than 5 regardless of model output

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

function parseJsonFromOutput(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON object found in model output');
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function callClaude(prompt) {
  const res = await execFileP('claude', ['-p', prompt], {
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseJsonFromOutput(res.stdout);
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

async function classifyAll(resources, taxonomy, selector) {
  const targets = resolveTargets(resources, selector);
  const rows = [];

  for (let i = 0; i < targets.length; i++) {
    const resource = targets[i];
    const oldCategory = resource.resource_category?.slug || '';
    const oldTags = (resource.resource_tags || []).map((t) => t.slug).join(';');

    console.error(`  [${i + 1}/${targets.length}] ${resource.slug}`);

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

    rows.push({
      slug: resource.slug,
      title: resource.title || '',
      old_category: oldCategory,
      new_category: result.ok ? result.categorySlug : '',
      old_tags: oldTags,
      new_tags: result.ok ? result.tagSlugs.join(';') : '',
      status: result.ok ? 'ok' : 'needs-manual-review',
      reason: result.ok ? result.rationale : result.reason,
      write_status: 'dry-run',
    });

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
 * Writes resource_category + resource_tags for every "ok" row, `concurrency`
 * at a time (default 3), then republishes each. Logs in ONCE as the
 * configured admin (if any) and reuses that JWT for the whole batch, so
 * Strapi's history attributes every write in this run to that admin user
 * rather than the API token's creator. Falls back to token writes with a
 * console warning if no admin identity is set, or if that login fails.
 *
 * Every write is gated by checkAndRecordWrite() — a self-imposed cap of 100
 * writes per rolling 5 minutes. Once hit, remaining rows are marked
 * "skipped:rate-limited" rather than queued — re-run later for the rest.
 */
async function applyRows(rows, resources, taxonomy, opts = {}) {
  const concurrency = Math.max(1, opts.concurrency || 3);
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

  const writable = rows.filter((r) => r.status === 'ok');
  for (const row of rows) {
    if (row.status !== 'ok') row.write_status = 'skipped:not-ok';
  }

  for (let i = 0; i < writable.length; i += concurrency) {
    const chunk = writable.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (row) => {
        const resource = resourceBySlug.get(row.slug);
        if (!resource) {
          console.error(`  ✗ ${row.slug}: no longer exists in Strapi — skipped`);
          row.write_status = 'failed:resource-not-found';
          failed++;
          return;
        }
        const categoryDocId = categoryBySlug.get(row.new_category);
        const tagDocIds = row.new_tags.split(';').filter(Boolean).map((s) => tagBySlug.get(s));
        if (!categoryDocId || tagDocIds.some((id) => !id)) {
          console.error(`  ✗ ${row.slug}: category/tag slug no longer exists in live taxonomy — skipped`);
          row.write_status = 'failed:stale-taxonomy-slug';
          failed++;
          return;
        }

        const gate = checkAndRecordWrite();
        if (!gate.allowed) {
          console.error(
            `  ⏸ ${row.slug}: write rate limit reached (100/5min) — retry in ${Math.ceil(gate.retryAfterMs / 1000)}s`,
          );
          row.write_status = 'skipped:rate-limited';
          rateLimited++;
          return;
        }

        try {
          await writeResourceUpdate(resource, categoryDocId, tagDocIds, adminJwt);
          console.error(`  ✓ ${row.slug} (via ${writeVia})`);
          row.write_status = 'applied';
          applied++;
        } catch (e) {
          console.error(`  ✗ ${row.slug}: ${e.message}`);
          row.write_status = `failed:${e.message}`;
          failed++;
        }
      }),
    );
    await sleep(150);
  }

  return { applied, failed, rateLimited, writeVia };
}

module.exports = {
  classifyAll,
  applyRows,
  validateClassification,
  buildPrompt,
  resolveTargets,
  MIN_TAGS,
  MAX_TAGS,
};
