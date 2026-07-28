'use strict';

/**
 * checks-store.js — persists Run/Write results per resource slug (data/
 * resource-checks.json) so the Resources tab's checked/not-checked state and
 * duplicate-content findings survive a page reload, instead of living only
 * in React state. No secrets here — safe to commit.
 */

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.resolve(process.cwd(), 'data', 'resource-checks.json');

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
 * Merge in new classify/audit rows for a batch, replacing any prior entry per
 * slug. `auditComputed` must be true only when this batch actually ran the
 * duplicate-content check (action: "run") — a Write-only batch never
 * recomputes duplicates, so it preserves whatever was already stored instead
 * of wiping it back to "no duplicate".
 */
function upsertResults(classifyRows, auditRows, opts = {}) {
  const auditComputed = Boolean(opts.auditComputed);
  const store = readAll();

  const findingsBySlug = new Map();
  for (const a of auditRows) {
    const arr = findingsBySlug.get(a.resource_slug) ?? [];
    arr.push(a);
    findingsBySlug.set(a.resource_slug, arr);
  }

  const now = new Date().toISOString();
  for (const r of classifyRows) {
    const prev = store[r.slug];
    let dupFields;
    if (auditComputed) {
      const findings = findingsBySlug.get(r.slug) ?? [];
      dupFields = {
        hasDuplicate: findings.length > 0,
        duplicateType: findings.map((f) => f.type).join(' | '),
        duplicateSection: findings.map((f) => f.section_heading || `#${f.section_index}`).join(' | '),
        duplicateContent: findings.map((f) => f.snippet).join(' | '),
      };
    } else if (prev) {
      dupFields = {
        hasDuplicate: prev.hasDuplicate,
        duplicateType: prev.duplicateType,
        duplicateSection: prev.duplicateSection,
        duplicateContent: prev.duplicateContent,
      };
    } else {
      dupFields = { hasDuplicate: false, duplicateType: '', duplicateSection: '', duplicateContent: '' };
    }

    store[r.slug] = {
      title: r.title,
      old_category: r.old_category,
      new_category: r.new_category,
      old_tags: r.old_tags,
      new_tags: r.new_tags,
      status: r.status,
      reason: r.reason,
      write_status: r.write_status,
      ...dupFields,
      checkedAt: now,
    };
  }

  writeAll(store);
  return store;
}

function getAll() {
  return readAll();
}

module.exports = { upsertResults, getAll, STORE_PATH };
