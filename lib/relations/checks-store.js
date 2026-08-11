'use strict';

/**
 * checks-store.js — persists Run/Write results per entry (data/
 * relation-checks.json), the relations analogue of
 * lib/resources/checks-store.js. Keyed by `${contentType}/${slug}` (see
 * lib/relations/classify.js's entryKey) rather than a bare slug, since
 * relations span multiple content types and slugs are only unique within
 * one. No secrets here — safe to commit.
 */

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.resolve(process.cwd(), 'data', 'relation-checks.json');

function readAll() {
  try {
    const obj = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(map, null, 2) + '\n');
}

/**
 * One entry's result, upserted the moment it's final — same rationale as
 * lib/resources/checks-store.js's upsertResults: a paced batch can run for
 * a long time and must survive being killed mid-way, so nothing waits until
 * the end to land on disk.
 */
function upsertResult(key, result) {
  const store = readAll();
  store[key] = { ...result, checkedAt: new Date().toISOString() };
  writeAll(store);
  return store[key];
}

function getAll() {
  return readAll();
}

module.exports = { upsertResult, getAll, STORE_PATH };
