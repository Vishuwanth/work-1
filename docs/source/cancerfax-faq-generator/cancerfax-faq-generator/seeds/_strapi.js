'use strict';
/**
 * _strapi.js — Locates and loads the shared root strapi-config.js (never duplicated
 * into this skill — it holds live tokens). Same upward-search convention used by
 * cancerfax-doctor-seed-scripts/seed-doctor.js, so this skill is just as portable:
 * drop these files anywhere and strapi-config.js is found automatically.
 *
 * Also exports the two API helpers every FAQ script needs:
 *   fetchEntry(collection, slug)     — GET the live published entry, sections fully populated
 *   putSections(collection, id, ..) — PUT ONLY the sections field, ?status=published
 *   stripIds(node)                   — recursively strip Strapi's internal component `id`s
 *                                       (required before writing back fetched components —
 *                                       see cancerfax-strapi-backend/scripts/update-support-page-slugs.js)
 */

const path = require('path');
const fs   = require('fs');

function findUpward(startDir, filename) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, filename);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function locateStrapiConfig() {
  const name = 'strapi-config.js';
  const inScript = path.join(__dirname, name);
  if (fs.existsSync(inScript)) return inScript;
  const inCwd = path.join(process.cwd(), name);
  if (fs.existsSync(inCwd)) return inCwd;
  const fromScript = findUpward(path.dirname(__dirname), name);
  if (fromScript) return fromScript;
  const fromCwd = findUpward(process.cwd(), name);
  if (fromCwd) return fromCwd;
  return null;
}

const configPath = locateStrapiConfig();
if (!configPath) {
  console.error('\n❌  strapi-config.js not found.');
  console.error('    Place strapi-config.js in the same folder as this script,');
  console.error('    or in any parent directory on the path from here to the root.');
  console.error(`    Searched from: ${__dirname} and ${process.cwd()}`);
  process.exit(1);
}

let cfg;
try { cfg = require(configPath); }
catch (e) {
  console.error(`\n❌  Failed to load strapi-config.js from ${configPath}`);
  console.error(`    ${e.message}`);
  process.exit(1);
}

const { ENV, STRAPI_URL, strapiRequest } = cfg;

// collection (API plural) → dynamic-zone component namespace.
// Treatments reuse the insights.* section components — see CONTENT-TYPE-MAP.md
// in cancerfax-insights-seed-scripts-v2/references for the same mapping used to CREATE pages.
const NAMESPACE = { insights: 'insights', guides: 'guides', treatments: 'insights' };
const UID       = {
  insights:   'api::insight.insight',
  guides:     'api::guide.guide',
  treatments: 'api::treatment.treatment',
};

function assertCollection(collection) {
  if (!NAMESPACE[collection]) {
    throw new Error(`Unknown collection "${collection}" — must be one of: insights, guides, treatments`);
  }
}

/**
 * Recursively strip `id` from every object/array node (Strapi component row ids),
 * AND put `__component` back as the FIRST key of any dynamic-zone item.
 *
 * The `__component` reorder is not cosmetic — it is the actual fix for the write
 * failure this skill hit repeatedly (`400 ValidationError: Invalid key __component
 * at sections`). Root cause, confirmed empirically 2026-07-20 against both staging
 * and prod: Strapi's REST write validator on this deployment (^5.49.0) rejects a
 * dynamic-zone item whose `__component` key is not first — but every GET response
 * places `__component` LAST. A plain object spread (`{...s, __component}`) or
 * `Object.keys()` iteration over a fetched section therefore reproduces the exact
 * broken order. This exact discriminator-reordering technique is what
 * `Scripts/FAQs/apply-pillar-faqs.js` (the team's proven, already-in-production
 * FAQ pipeline) already does — see its `reorderComponent` helper — and is why that
 * script's plain single-step `PUT ?status=published` has always worked. An earlier
 * version of this file worked around the symptom with a two-step draft-then-publish
 * write instead of fixing this; that workaround is gone — this is the real fix.
 */
function stripIds(node) {
  if (Array.isArray(node)) return node.map(stripIds);
  if (node && typeof node === 'object') {
    const out = {};
    if (node.__component) out.__component = node.__component; // must be inserted first
    for (const k of Object.keys(node)) {
      if (k === 'id' || k === '__component') continue;
      out[k] = stripIds(node[k]);
    }
    return out;
  }
  return node;
}

/**
 * Build the populate query for the sections dynamic zone.
 *
 * IMPORTANT: `populate[sections][populate]=*` (the shallow form used elsewhere in this
 * codebase, e.g. restore-support-page-links.js) only reaches ONE level of nesting.
 * That is enough for sections whose repeatable component is scalar-only (cards, steps,
 * table rows, comparison items, support-page links, languages) — but section-faq
 * (groups -> items) and section-bar-chart (groups -> bars) nest a repeatable component
 * INSIDE another repeatable component, and the shallow form silently returns those
 * groups with EMPTY items/bars arrays (no error — same populate-depth failure class
 * documented in project memory: i18n nested-component bugs, media+relation populate bug).
 * Verified empirically 2026-07-20 against staging before relying on it here.
 *
 * Fix: use the typed `on` populate per component type, with an extra [populate][x]
 * level for the two double-nested types.
 */
function buildSectionsPopulate(ns) {
  const parts = [];
  for (const t of ['text', 'table', 'stats', 'support-pages', 'comparison', 'steps', 'languages']) {
    parts.push(`populate[sections][on][${ns}.section-${t}][populate]=*`);
  }
  parts.push(`populate[sections][on][${ns}.section-faq][populate][groups][populate][items][populate]=*`);
  parts.push(`populate[sections][on][${ns}.section-bar-chart][populate][groups][populate][bars][populate]=*`);
  return parts.join('&');
}

/** GET the live published entry with the full sections dynamic zone populated (all depths). */
async function fetchEntry(collection, slug) {
  assertCollection(collection);
  const ns = NAMESPACE[collection];
  const url =
    `${STRAPI_URL}/api/${collection}` +
    `?filters[slug][$eq]=${encodeURIComponent(slug)}` +
    `&fields[0]=slug&fields[1]=title&fields[2]=pageLabel` +
    `&${buildSectionsPopulate(ns)}` +
    `&status=published`;
  const res = await strapiRequest(url);
  return res?.data?.[0] || null;
}

/**
 * PUT only the sections field back, live, in a single write.
 *
 * History (see chat session 2026-07-20 for the full diagnostic): a single
 * `PUT ?status=published` with `sections` in the body first appeared to fail on this
 * Strapi deployment (^5.49.0) with `400 ValidationError: Invalid key __component at
 * sections`, reproduced on both staging and prod, on existing entries AND on a
 * freshly-created disposable test entry. That symptom was worked around here for a
 * while with a two-step draft-then-publish write. The actual root cause turned out to
 * be simpler and unrelated to draft/publish state: Strapi's write validator on this
 * deployment rejects a dynamic-zone item unless `__component` is the FIRST key of that
 * object — but every GET response places `__component` LAST, so any fetch-then-PUT
 * round trip (via spread or plain `Object.keys()` iteration) reproduces the broken
 * order. `stripIds()` above now reorders `__component` first as part of stripping ids,
 * which is all that was ever needed — confirmed against `Scripts/FAQs/apply-pillar-
 * faqs.js`, the team's proven production FAQ pipeline, which has done this exact
 * reorder from the start and has always written with a plain single-step PUT.
 */
async function putSections(collection, documentId, sections) {
  assertCollection(collection);
  const url = `${STRAPI_URL}/api/${collection}/${documentId}?status=published`;
  return strapiRequest(url, {
    method: 'PUT',
    body: JSON.stringify({ data: { sections: stripIds(sections) } }),
  });
}

module.exports = {
  ENV, STRAPI_URL, strapiRequest,
  NAMESPACE, UID,
  assertCollection, stripIds, fetchEntry, putSections,
  configPath,
};
