'use strict';

/**
 * shared.js — corpus fetch + flatten helpers for the Relations tab, the
 * relations analogue of lib/resources/shared.js. Content-type-agnostic:
 * every function takes the `typeConfig` discovery.js produces from the
 * schema registry (`{ apiId, plural, titleField, lastNameField, slugField,
 * excerptField, relationFields }`) rather than hardcoding field names per
 * type.
 *
 * The write-rate limiter is deliberately NOT duplicated here — see
 * lib/resources/shared.js's checkAndRecordWrite: it is a Strapi-wide
 * self-imposed write budget, and lib/relations/write.js imports it directly
 * from there so Resources and Relations share one counter.
 */

const { API_BASE } = require('../resources/shared');
const { strapiRequest, sleep } = require('../resources/strapi-client');
const { isRelationValue, isInternalField, SENSITIVE_FIELD_NAME_RE } = require('./discovery');

const PAGE_SIZE = 100;

/**
 * Which plain fields the cheap, list-wide fetch asks Strapi for. Every name
 * here comes straight from the schema registry (titleField/lastNameField/
 * slugField/excerptField — see generate-relation-schema.js), so it's always
 * a field this exact content type actually has: Strapi 400s on an unknown
 * `fields[]` name (`Invalid key <field>`), so a fixed candidate list guessed
 * per type (an earlier version of this file did that) is not safe — every
 * content type has different field names for these, and asking for one a
 * type doesn't have breaks the whole request, not just that field.
 */
function pickListFields(typeConfig) {
  const fields = new Set();
  if (typeConfig.titleField) fields.add(typeConfig.titleField);
  if (typeConfig.lastNameField) fields.add(typeConfig.lastNameField);
  if (typeConfig.slugField) fields.add(typeConfig.slugField);
  if (typeConfig.excerptField) fields.add(typeConfig.excerptField);
  return [...fields];
}

/** Best-effort human title for an entry, independent of which field this content type happens to use. */
function getEntryTitle(entry, typeConfig) {
  const primary = typeConfig.titleField && entry[typeConfig.titleField];
  if (primary && typeConfig.lastNameField) {
    return [primary, entry[typeConfig.lastNameField]].filter(Boolean).join(' ');
  }
  if (primary) return primary;
  return entry[typeConfig.slugField] || entry.documentId || '(untitled)';
}

/**
 * The identity used everywhere in this feature (`${contentType}/${slug}` —
 * see lib/relations/classify.js's entryKey). Most content types have a real
 * `slug` (a Strapi `uid` field); a few (`country`, `faq`, `tag` — see
 * schema-registry.json) don't, so their documentId stands in. documentId is
 * globally unique and stable, so this is safe as a routing key even though
 * it isn't a human-readable slug.
 */
function entrySlug(entry, typeConfig) {
  return (typeConfig.slugField && entry[typeConfig.slugField]) || entry.documentId;
}

/** A short (title/slug + whatever excerpt-shaped field exists) index entry — the pool of legitimate link targets shown to the model, never the full body. */
function toIndexEntry(entry, typeConfig) {
  const excerpt = (typeConfig.excerptField && entry[typeConfig.excerptField]) || '';
  return {
    contentType: typeConfig.apiId,
    documentId: entry.documentId,
    slug: entrySlug(entry, typeConfig),
    title: getEntryTitle(entry, typeConfig),
    excerpt: typeof excerpt === 'string' ? excerpt.slice(0, 300) : '',
  };
}

/**
 * Every entry of one content type, list-shaped (title/slug/excerpt only, no
 * relations, no components) — the two-stage fetch's cheap stage, mirroring
 * fetchResourceList(). Used to build the corpus index every run and to
 * populate the Relations tab's browsable table.
 */
async function fetchEntryList(typeConfig) {
  const fields = pickListFields(typeConfig);
  const fieldsQuery = fields.map((f, i) => `fields[${i}]=${f}`).join('&');
  const all = [];
  let page = 1;
  while (true) {
    const url =
      `${API_BASE}/${typeConfig.plural}?pagination[page]=${page}&pagination[pageSize]=${PAGE_SIZE}` +
      (fieldsQuery ? `&${fieldsQuery}` : '');
    const res = await strapiRequest(url);
    all.push(...(res.data || []));
    const meta = res.meta?.pagination;
    if (!meta || page >= meta.pageCount) break;
    page++;
    await sleep(100);
  }
  return all.map((entry) => toIndexEntry(entry, typeConfig));
}

/** Every discovered content type's index entries, in one flat array — the full corpus a proposed relation's target must belong to. */
async function fetchCorpusIndex(typeConfigs) {
  const corpus = [];
  for (const typeConfig of typeConfigs) {
    const entries = await fetchEntryList(typeConfig);
    corpus.push(...entries);
  }
  return corpus;
}

/** One entry, fully populated (`populate=*`) — the expensive stage, fetched only for entries actually being mapped in a Run/Write batch. */
async function fetchEntryByDocumentId(typeConfig, documentId) {
  const res = await strapiRequest(`${API_BASE}/${typeConfig.plural}/${documentId}?populate=*`);
  return res.data;
}

const TEXT_SKIP_KEYS = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'locale',
  'localizations',
  'url',
  'mime',
  'ext',
  'hash',
  'provider',
  'width',
  'height',
  'size',
  'alternativeText',
  'caption',
  'seo',
]);

/** Never fed to a prompt: admin-only `_internal` fields, or a name pattern (leads, contact forms, …) discovery.js also excludes from relationFields — same policy, applied here to the text side too. */
function isInternalKey(key) {
  return isInternalField(key) || SENSITIVE_FIELD_NAME_RE.test(key);
}

/**
 * Deep-walks an entry collecting every string leaf, skipping relation- and
 * media-shaped subtrees (not prose) and internal/admin-only fields (never
 * meant to leave this app, let alone be fed to a prompt). Generic on purpose
 * — CancerFax's 37 registered content types each shape their dynamic
 * zones/components differently, and a per-type flattener (the way
 * lib/resources/shared.js's flattenContentSections is specific to
 * `resource.content`) would mean hand-writing and maintaining 38 of them.
 */
function collectText(value, out) {
  if (value == null) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    if (isRelationValue(value)) return;
    for (const v of value) collectText(v, out);
    return;
  }
  if (typeof value === 'object') {
    if (isRelationValue(value)) return;
    for (const [key, v] of Object.entries(value)) {
      if (TEXT_SKIP_KEYS.has(key) || isInternalKey(key)) continue;
      collectText(v, out);
    }
  }
}

const MAX_ENTRY_TEXT = 12_000; // same cap as lib/resources/shared.js's flattenResourceText

/** Everything worth showing the model for one fully-populated entry, bounded in length. */
function flattenEntryText(entry, typeConfig) {
  const title = getEntryTitle(entry, typeConfig);
  const out = [];
  for (const [key, value] of Object.entries(entry)) {
    if (TEXT_SKIP_KEYS.has(key) || isInternalKey(key)) continue;
    if (key === typeConfig.titleField || key === typeConfig.lastNameField || key === typeConfig.slugField) continue;
    collectText(value, out);
  }
  const body = out.join('\n').replace(/\n{3,}/g, '\n\n');
  return `TITLE: ${title}\n\n${body}`.slice(0, MAX_ENTRY_TEXT);
}

/** `Map<documentId, indexEntry>` over a corpus index — a relation's populated value only ever carries `documentId`, never which content type it belongs to or that type's own title field, so resolving a display title requires this global lookup rather than guessing per-item. */
function buildCorpusLookup(corpusIndex) {
  return new Map(corpusIndex.map((e) => [e.documentId, e]));
}

/**
 * The current, already-populated relations on one fully-populated entry —
 * for "current relations" display, never inferred, always what Strapi
 * actually has. `corpusLookup` (see buildCorpusLookup) resolves each
 * related documentId's title/contentType; a documentId absent from it (a
 * draft, or a related entry of a content type that failed discovery) still
 * renders, just without a friendly title.
 */
function currentRelations(entry, typeConfig, corpusLookup) {
  const out = [];
  for (const rf of typeConfig.relationFields || []) {
    const value = entry[rf.field];
    if (value == null) continue;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      const resolved = corpusLookup?.get(item.documentId);
      out.push({
        field: rf.field,
        documentId: item.documentId,
        contentType: resolved?.contentType ?? null,
        title: resolved?.title ?? item.documentId,
      });
    }
  }
  return out;
}

module.exports = {
  fetchEntryList,
  fetchCorpusIndex,
  fetchEntryByDocumentId,
  flattenEntryText,
  getEntryTitle,
  entrySlug,
  currentRelations,
  buildCorpusLookup,
  toIndexEntry,
  pickListFields,
  MAX_ENTRY_TEXT,
};
