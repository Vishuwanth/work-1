'use strict';

/**
 * credentials-store.js — reads/writes data/strapi-credentials.enc.json, the
 * encrypted store for Strapi API tokens + admin email/password. Every value
 * on disk is ciphertext (see secrets-core.js); nothing here ever writes
 * plaintext to disk.
 *
 * Known field paths: "prod.token", "adminEmail", "adminPassword". (Staging is
 * intentionally not offered — this app only ever targets prod.)
 */

const fs = require('fs');
const path = require('path');
const { encrypt, decrypt, mask } = require('./secrets-core');

// process.cwd(), not __dirname: Next.js's webpack bundling can relocate this
// module's compiled output (e.g. into .next/server/app/api/...), which makes
// __dirname-relative paths land in the wrong place. process.cwd() is the
// project root in every context this runs in — the Next.js server process,
// and the plain runner scripts in scripts/, which are spawned with
// `cwd: process.cwd()` from the API route for exactly this reason.
const STORE_PATH = path.resolve(process.cwd(), 'data', 'strapi-credentials.enc.json');

const FIELDS = ['prod.token', 'adminEmail', 'adminPassword'];

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + '\n');
}

function getDeep(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function setDeep(obj, dotPath, value) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = cur[parts[i]] || {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/** Decrypts one field. Returns "" if not set. Throws if RESOURCES_SECRET_KEY is missing. */
function getField(fieldPath) {
  const enc = getDeep(readStore(), fieldPath);
  return enc ? decrypt(enc) : '';
}

/** Encrypts `value` and persists it under `fieldPath`. Throws if RESOURCES_SECRET_KEY is missing. */
function setField(fieldPath, value) {
  const store = readStore();
  setDeep(store, fieldPath, encrypt(value));
  writeStore(store);
}

/**
 * Metadata for every known field — never plaintext. Used by the UI to render
 * "(not set)" / masked previews, and to know which fields it can offer a
 * Reveal button for.
 */
function listFieldStatus() {
  const store = readStore();
  return FIELDS.map((fieldPath) => {
    const enc = getDeep(store, fieldPath);
    if (!enc) return { field: fieldPath, isSet: false, masked: '(not set)' };
    try {
      return { field: fieldPath, isSet: true, masked: mask(decrypt(enc)) };
    } catch {
      // RESOURCES_SECRET_KEY missing or wrong — the value exists but can't be
      // read right now. Report it as set (so the UI doesn't offer to save
      // over it accidentally) without decrypting.
      return { field: fieldPath, isSet: true, masked: "(set — can't decrypt without RESOURCES_SECRET_KEY)" };
    }
  });
}

module.exports = { readStore, writeStore, getField, setField, listFieldStatus, FIELDS, STORE_PATH };
