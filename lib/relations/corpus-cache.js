'use strict';

/**
 * corpus-cache.js — the ONE place that decides "do we hit Strapi for the
 * content-type list + corpus, or do we already have it". Every caller
 * (list-relation-entries.js, run-relation-check.js, discover-content-types.js)
 * goes through `getCorpus()` instead of calling discovery.js/shared.js
 * directly, so there is exactly one cache policy, not one per script.
 */

const { discoverContentTypes } = require('./discovery');
const { fetchCorpusIndex } = require('./shared');
const cacheStore = require('./cache-store');

/**
 * `{ forceRefresh: true }` always re-fetches from prod and overwrites the
 * cache — the explicit "I know something changed" escape hatch (wired to
 * the Content Types tab's "Discover" button and the Relations tab's
 * "Refresh" button). Otherwise, a cached result is used if one exists at
 * all, no matter its age; only a genuinely empty cache triggers a live
 * fetch. `fromCache` tells the caller which happened, so the UI can show it.
 */
async function getCorpus({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = cacheStore.read();
    if (cached) return { ...cached, fromCache: true };
  }
  const contentTypes = await discoverContentTypes();
  const corpusIndex = await fetchCorpusIndex(contentTypes);
  const saved = cacheStore.write(contentTypes, corpusIndex);
  return { ...saved, fromCache: false };
}

module.exports = { getCorpus };
