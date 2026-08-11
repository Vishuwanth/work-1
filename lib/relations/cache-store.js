'use strict';

/**
 * cache-store.js — persists the discovered content types + full corpus
 * index (data/.relations-cache.json) so it's fetched from prod ONCE and
 * reused, instead of every Run/Write/list-load re-paying the ~55s,
 * ~4,600-row corpus fetch (§ "why cache" below).
 *
 * Deliberately gitignored and unbounded in age — there is no TTL. This app
 * runs for one operator; staleness is something they choose to fix (a
 * "Refresh" click), not something the system silently decides for them.
 * What DOES stay live no matter what: `lib/relations/shared.js`'s
 * `fetchEntryByDocumentId` (full `populate=*` body) for the specific entry
 * actually being mapped — only the "which other entries exist to link to"
 * list is cached, never the content the model reasons about.
 */

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.resolve(process.cwd(), 'data', '.relations-cache.json');

function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (raw && Array.isArray(raw.contentTypes) && Array.isArray(raw.corpusIndex)) return raw;
    return null;
  } catch {
    return null;
  }
}

function write(contentTypes, corpusIndex) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const data = { contentTypes, corpusIndex, updatedAt: new Date().toISOString() };
  fs.writeFileSync(STORE_PATH, JSON.stringify(data));
  return data;
}

function clear() {
  try {
    fs.unlinkSync(STORE_PATH);
  } catch {
    // Already gone — clearing a clear cache is a no-op, not an error.
  }
}

module.exports = { read, write, clear, STORE_PATH };
