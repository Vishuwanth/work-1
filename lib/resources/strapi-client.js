'use strict';

/**
 * strapi-client.js — minimal Strapi REST client, self-contained within this
 * app (no dependency on the sibling cancerfax-strapi-backend repo's
 * strapi-config.js). The token comes from this app's own encrypted
 * credentials store (Resources tab → Credentials); the URL is a fixed
 * constant since this app only ever targets prod.
 */

const { getField } = require('../credentials-store');

const PROD_STRAPI_URL = 'https://admin.cancerfax.in';

function getToken() {
  const token = getField('prod.token');
  if (!token) {
    throw new Error(
      "No prod API token configured. Set one in the Resources tab's Credentials panel before running.",
    );
  }
  return token;
}

async function strapiRequest(url, options = {}) {
  const token = getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const msg = json?.error?.message || res.statusText;
    const details = json?.error?.details ? '\n' + JSON.stringify(json.error.details, null, 2) : '';
    throw new Error(`Strapi API error [${res.status}]: ${msg}${details}`);
  }
  return json;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Logs in as the configured admin user (Credentials tab → Admin email/
 * password) to get an admin JWT. Returns null — not an error — when no admin
 * credentials are set, since that's a valid, expected state: the caller falls
 * back to API-token writes, which is why this app's write path still works
 * before anyone has set an admin identity.
 *
 * This matters for WHO a write is attributed to: Strapi's admin/content-
 * manager pipeline stamps updatedBy/createdBy from the authenticated admin
 * user (ctx.state.user); the public token-based /api/* REST layer has no
 * admin-user concept at all, so token writes always attribute to whichever
 * admin originally generated that token, never to whoever is actually
 * running the review.
 */
async function getAdminJwt() {
  const email = getField('adminEmail');
  const password = getField('adminPassword');
  if (!email || !password) return null;

  const res = await fetch(`${PROD_STRAPI_URL}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.data?.token) {
    throw new Error(`Admin login failed: ${json?.error?.message || res.statusText}`);
  }
  return json.data.token;
}

/** Authenticated call to the admin/content-manager API (distinct auth guard from strapiRequest's public /api/*). */
async function adminRequest(url, jwt, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const msg = json?.error?.message || res.statusText;
    throw new Error(`Strapi admin API error [${res.status}]: ${msg}`);
  }
  return json;
}

module.exports = { PROD_STRAPI_URL, strapiRequest, sleep, getToken, getAdminJwt, adminRequest };
