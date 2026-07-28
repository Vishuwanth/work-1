'use strict';

/**
 * secrets-core.js — AES-256-GCM encrypt/decrypt for the Strapi credentials
 * store. Plain CommonJS (not TypeScript) so both the Next.js API routes and
 * the plain-Node runner scripts in scripts/ can require it directly.
 *
 * Security model — be clear-eyed about what this does and doesn't protect:
 *   - The ciphertext in data/strapi-credentials.enc.json is safe to commit to
 *     this PRIVATE repo: without the key below, it's unreadable.
 *   - The key comes ONLY from process.env.RESOURCES_SECRET_KEY, which must
 *     live in .env.local (already gitignored, see .gitignore) and be shared
 *     with teammates out-of-band (password manager, not Slack/email) — never
 *     committed. If the key is ever committed alongside the ciphertext, this
 *     provides no real protection against anyone with repo access; it only
 *     protects against CASUAL plaintext exposure (grep, git blame, screen
 *     shares, secret scanners) to someone who has the repo but not the key.
 *   - Anyone who has both repo access AND the key can read every secret —
 *     this is encryption at rest with UI-gated reveal, not a secrets vault
 *     with per-user access control.
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
// Fixed salt is fine here: the passphrase (RESOURCES_SECRET_KEY) is the actual
// secret and never leaves the environment variable, so the salt only needs to
// make key derivation deterministic across encrypt/decrypt calls — it isn't
// defending against a rainbow-table attack on the passphrase itself.
const SALT = 'cancerfax-resources-credentials-v1';

function getPassphrase() {
  const key = process.env.RESOURCES_SECRET_KEY;
  if (!key) {
    throw new Error(
      'RESOURCES_SECRET_KEY is not set. Add it to .env.local (never commit it) — see README-ai-resource-scripts.md.',
    );
  }
  return key;
}

function deriveKey() {
  return crypto.scryptSync(getPassphrase(), SALT, 32);
}

/** @returns {{iv: string, authTag: string, ciphertext: string}} base64-encoded parts */
function encrypt(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/** @param {{iv: string, authTag: string, ciphertext: string} | null | undefined} payload */
function decrypt(payload) {
  if (!payload) return '';
  const key = deriveKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}

/** Last-4-chars preview for the UI's default (non-revealed) display. */
function mask(plaintext) {
  const s = String(plaintext || '');
  if (s.length === 0) return '(not set)';
  if (s.length <= 4) return '••••';
  return '••••••••' + s.slice(-4);
}

module.exports = { encrypt, decrypt, mask };
