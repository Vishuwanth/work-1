'use strict';

/**
 * shared.js — resource-fetching + taxonomy helpers, ported from
 * cancerfax-strapi-backend/scripts/_resource-ai-shared.js so this app is
 * self-sustaining: anyone who clones just this repo (plus sets a prod API
 * token via the Credentials tab and has the `claude` CLI) can run it, no
 * sibling "Cancerfax Main" checkout required. Prod-only.
 */

const fs = require('fs');
const path = require('path');
const { PROD_STRAPI_URL, strapiRequest, sleep } = require('./strapi-client');

const API_BASE = `${PROD_STRAPI_URL}/api`;

// content is a repeatable component (no dynamic-zone nesting), so a flat
// populate=* is enough for it.
const RESOURCE_POPULATE =
  'populate[content][populate]=*' +
  '&populate[resource_category][fields][0]=name&populate[resource_category][fields][1]=slug' +
  '&populate[resource_subcategory][fields][0]=name&populate[resource_subcategory][fields][1]=slug' +
  '&populate[resource_tags][fields][0]=name&populate[resource_tags][fields][1]=slug';

/** Every published resource, fully paginated, WITH content — for classify + duplicate-audit. */
async function fetchAllResources() {
  const all = [];
  let page = 1;
  while (true) {
    const url =
      `${API_BASE}/resources?pagination[page]=${page}&pagination[pageSize]=100` +
      `&status=published&${RESOURCE_POPULATE}`;
    const res = await strapiRequest(url);
    all.push(...(res.data || []));
    const meta = res.meta?.pagination;
    if (!meta || page >= meta.pageCount) break;
    page++;
    await sleep(150);
  }
  return all;
}

// No `content` — the expensive part. Used for the browsable/selectable list;
// fetchAllResources() (with content) only runs once resources are selected.
const RESOURCE_LIST_POPULATE =
  'fields[0]=title&fields[1]=slug&fields[2]=publishedDate' +
  '&populate[resource_category][fields][0]=name&populate[resource_category][fields][1]=slug' +
  '&populate[resource_tags][fields][0]=name&populate[resource_tags][fields][1]=slug';

/** Every published resource's title/slug/category/tags — no content, fast. */
async function fetchResourceList() {
  const all = [];
  let page = 1;
  while (true) {
    const url =
      `${API_BASE}/resources?pagination[page]=${page}&pagination[pageSize]=100` +
      `&status=published&${RESOURCE_LIST_POPULATE}`;
    const res = await strapiRequest(url);
    all.push(...(res.data || []));
    const meta = res.meta?.pagination;
    if (!meta || page >= meta.pageCount) break;
    page++;
    await sleep(150);
  }
  return all;
}

/** The closed classification vocabulary, fetched live every call — never a local snapshot. */
async function fetchTaxonomy() {
  const [catRes, tagRes] = await Promise.all([
    strapiRequest(`${API_BASE}/resource-categories?pagination[pageSize]=200&fields[0]=name&fields[1]=slug`),
    strapiRequest(
      `${API_BASE}/resource-tags?pagination[pageSize]=300&fields[0]=name&fields[1]=slug` +
        '&populate[tag_groups][fields][0]=name',
    ),
  ]);
  const categories = (catRes.data || []).map((c) => ({ documentId: c.documentId, name: c.name, slug: c.slug }));
  const tags = (tagRes.data || []).map((t) => ({
    documentId: t.documentId,
    name: t.name,
    slug: t.slug,
    groups: (t.tag_groups || []).map((g) => g.name).filter(Boolean),
  }));
  return { categories, tags };
}

/** Flatten a Strapi Blocks (rich text) value into plain text. */
function flattenBlocks(blocks) {
  if (!Array.isArray(blocks)) return '';
  const walk = (node) => {
    if (node == null) return '';
    if (typeof node.text === 'string') return node.text;
    if (Array.isArray(node.children)) return node.children.map(walk).join('');
    return '';
  };
  return blocks.map(walk).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** One resource's `content` zone, section by section, as plain text. */
function flattenContentSections(resource) {
  return (resource.content || []).map((s, i) => ({
    index: i,
    section_name: s.section_name || '',
    heading: s.heading || '',
    subHeading: s.subHeading || '',
    text: flattenBlocks(s.description_block),
  }));
}

/** Everything worth showing the model for one resource, bounded in length. */
function flattenResourceText(resource) {
  const sections = flattenContentSections(resource);
  const body = sections.map((s) => [s.heading, s.subHeading, s.text].filter(Boolean).join('\n')).join('\n\n');
  const full = [`TITLE: ${resource.title || ''}`, `EXCERPT: ${resource.excerpt || ''}`, `BODY:\n${body}`].join('\n\n');
  return full.slice(0, 12000);
}

/** Fail loudly and early if a required CLI binary isn't on PATH. */
function assertCliAvailable(bin, helpArgs, setupHint) {
  const { spawnSync } = require('child_process');
  const res = spawnSync(bin, helpArgs, { stdio: 'ignore' });
  if (res.error || res.status === null) {
    console.error(`\n❌  Required CLI "${bin}" was not found on PATH.`);
    console.error(`    ${setupHint}\n`);
    process.exit(1);
  }
}

// ─── Self-imposed write rate limit ────────────────────────────────────────────
//
// Strapi itself doesn't rate-limit authenticated REST writes (only
// /admin/login has a configured limiter). This is a self-imposed guard so a
// batch run can't hammer prod: at most 100 writes per rolling 5-minute
// window, tracked in a state file so the cap holds across separate process
// runs (each Run/Write click spawns a fresh process).

const RATE_LIMIT_STATE_PATH = path.resolve(process.cwd(), 'data', '.write-rate-limit-state.json');
const RATE_LIMIT_MAX_WRITES = 100;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

function loadWriteTimestamps() {
  try {
    const arr = JSON.parse(fs.readFileSync(RATE_LIMIT_STATE_PATH, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveWriteTimestamps(arr) {
  fs.mkdirSync(path.dirname(RATE_LIMIT_STATE_PATH), { recursive: true });
  fs.writeFileSync(RATE_LIMIT_STATE_PATH, JSON.stringify(arr));
}

/**
 * Call immediately before each write. Returns { allowed: true } and records
 * the write, or { allowed: false, retryAfterMs } if the rolling window is
 * full — the caller should stop writing, not queue/retry silently.
 */
function checkAndRecordWrite(now = Date.now()) {
  const timestamps = loadWriteTimestamps().filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX_WRITES) {
    const oldest = timestamps[0];
    saveWriteTimestamps(timestamps);
    return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - oldest) };
  }
  timestamps.push(now);
  saveWriteTimestamps(timestamps);
  return { allowed: true };
}

/** How many writes are left in the current rolling window — for UI display. */
function writeRateLimitStatus(now = Date.now()) {
  const timestamps = loadWriteTimestamps().filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  return { used: timestamps.length, max: RATE_LIMIT_MAX_WRITES, windowMs: RATE_LIMIT_WINDOW_MS };
}

module.exports = {
  API_BASE,
  fetchAllResources,
  fetchResourceList,
  fetchTaxonomy,
  flattenBlocks,
  flattenContentSections,
  flattenResourceText,
  assertCliAvailable,
  checkAndRecordWrite,
  writeRateLimitStatus,
  RATE_LIMIT_MAX_WRITES,
  RATE_LIMIT_WINDOW_MS,
};
