#!/usr/bin/env node
'use strict';

/**
 * fetch-doctor-photos.js — downloads the SYSUCC portrait for every doctor in
 * `sun yat sen doctors/extracted/`, and prints a JSON summary line.
 *
 * Self-contained — see scripts/list-resources.js.
 *
 * Why crawl rather than hard-code 51 URLs: the hospital re-uploads portraits
 * under a fresh dated path (2017/03, 2022/05, 2022/06 all appear today), so a
 * baked-in URL list goes stale silently. Re-crawling re-derives them.
 *
 * The join is by NAME, because the two sides share no id. Name order differs
 * between them and hyphenation is inconsistent, so both sides collapse to an
 * unordered set of lowercase letter-runs:
 *
 *   "Bin-Kui Li"    -> {binkui, li}   <- extracted/dr-bin-kui-li.json
 *   "Li Binkui"     -> {binkui, li}   <- english.sysucc.org.cn
 *
 * Usage: node scripts/fetch-doctor-photos.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = 'https://english.sysucc.org.cn';
const INDEX_URL = `${ORIGIN}/index_26.aspx`;
const CN_ORIGIN = 'https://www.sysucc.org.cn';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const DOCTORS_DIR = path.resolve(process.cwd(), 'sun yat sen doctors/extracted');
const IMAGE_DIR = path.resolve(process.cwd(), 'public/doctors');
const MAPPING_PATH = path.resolve(process.cwd(), 'data/doctor-photos.json');
const CN_PROFILES_PATH = path.resolve(process.cwd(), 'data/doctor-cn-profiles.json');

// Politeness: 4 in flight, 400ms between starts. Proven against this host.
const CONCURRENCY = 4;
const GAP_MS = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * An unordered set of a name's lowercase words, as a sorted string.
 *
 * Hyphens are DROPPED rather than treated as separators — the two sides disagree
 * on where they go, so splitting on them breaks the join:
 *
 *   "An-Kui Yang" -> drop  -> {ankui, yang} == "Ankui Yang"   ✅
 *   "An-Kui Yang" -> split -> {an, kui, yang} != "Ankui Yang" ❌
 */
function nameKey(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** host → "k=v; k=v". Per-host, so one site's session never leaks to the other. */
const cookieJars = new Map();

function absorbCookies(host, res) {
  const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (!set.length) return;
  const jar = new Map(
    (cookieJars.get(host) ?? '')
      .split('; ')
      .filter(Boolean)
      .map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]),
  );
  for (const raw of set) {
    const pair = raw.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  cookieJars.set(
    host,
    [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  );
}

/**
 * GET with cookies carried across redirects.
 *
 * sysucc.org.cn sits behind an openresty challenge: the first hit answers 302 to
 * the SAME url with Set-Cookie CT6T/CT6TS, and only the retry carrying those
 * cookies gets a 200. Node's fetch follows redirects but does not persist
 * cookies, so the automatic mode loops until it times out — 20s and no bytes.
 * Redirects are therefore followed by hand, with the jar applied each hop.
 */
async function request(url, referer, depth = 0) {
  if (depth > 5) throw new Error(`Too many redirects: ${url}`);
  const host = new URL(url).host;
  const headers = { 'User-Agent': UA };
  const jar = cookieJars.get(host);
  if (jar) headers.Cookie = jar;
  if (referer) headers.Referer = referer;

  const res = await fetch(url, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  absorbCookies(host, res);

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) throw new Error(`Redirect without Location: ${url}`);
    return request(new URL(location, url).href, referer, depth + 1);
  }
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res;
}

async function getText(url) {
  return (await request(url)).text();
}

async function getBytes(url, referer) {
  return Buffer.from(await (await request(url, referer)).arrayBuffer());
}

/**
 * Pixel dimensions read straight from the file header — PNG's IHDR, or JPEG's
 * first SOF marker. Needed because the two sources are picked between by size,
 * and nothing else in the repo can measure an image.
 */
function imageSize(buf) {
  if (buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  for (let i = 2; i < buf.length - 9; ) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0/1/2 carry the frame dimensions; the rest are skipped by their length.
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) i += 2;
    else i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/** Run `task` over `items`, `CONCURRENCY` at a time, `GAP_MS` between starts. */
async function pooled(items, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await sleep(GAP_MS);
      results[i] = await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

/** Every `list_26.aspx?lcid=N` department linked from the specialists index. */
function parseDepartments(html) {
  const out = new Map();
  const re = /href="\/list_26\.aspx\?lcid=(\d+)"[^>]*>([^<]+)</g;
  for (const m of html.matchAll(re)) out.set(m[1], m[2].trim());
  return [...out].map(([lcid, name]) => ({ lcid, name }));
}

/**
 * The doctors on one department page. The portrait is a CSS background on the
 * <figure>, not an <img src>, so it has to be read out of the style attribute.
 */
function parseDoctors(html, department) {
  const re =
    /<a href='(\/info_26\.aspx\?itemid=(\d+))'>[\s\S]*?background-image:url\(([^)]+)\)[\s\S]*?<h5[^>]*>([^<]+)<\/h5>/g;
  return [...html.matchAll(re)].map((m) => ({
    profile: ORIGIN + m[1],
    itemid: m[2],
    image: ORIGIN + m[3].trim(),
    siteName: m[4].trim(),
    department,
  }));
}

const pixels = (buf) => {
  const s = imageSize(buf);
  return s ? s.width * s.height : 0;
};

/**
 * Slug → Chinese profile, verified once by converting the Chinese directory's 541
 * names to pinyin and matching them against the fixtures. That join needs a pinyin
 * table Node has no equivalent of, and a person's Chinese name does not change, so
 * the result is committed rather than recomputed. The image URL is NOT stored — it
 * is re-read from the profile below, so a re-uploaded portrait is still picked up.
 */
function readCnProfiles() {
  try {
    return JSON.parse(fs.readFileSync(CN_PROFILES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * The unresized upload behind a Chinese profile page.
 *
 * Drupal serves portraits through a derivative it calls `media_2_3_400_600`, and
 * keeps the untouched upload at the same path minus that prefix. Nothing is
 * resized here or anywhere else — the larger file already exists on their server:
 *
 *   /files/styles/media_2_3_400_600/public/2023-03/yangankui-tjk-202303.jpg?itok=…
 *   /files/2023-03/yangankui-tjk-202303.jpg                        <- 288x432
 *
 * The gain varies a lot: 41 of 47 are 288x432, one is 3648x5472, and one is
 * 120x174 — smaller than the English copy, which is why the caller compares.
 */
async function cnOriginalUrl(node) {
  const html = await getText(CN_ORIGIN + node);
  const m = html.match(/src="([^"]*styles\/media_2_3_400_600[^"]*)"/);
  if (!m) return null;
  const original = m[1].replace('/styles/media_2_3_400_600/public', '').split('?')[0];
  return original.startsWith('http') ? original : CN_ORIGIN + original;
}

/** Every doctor fixture, as `{ slug, name }`. */
function readExtractedDoctors() {
  const files = fs.readdirSync(DOCTORS_DIR).filter((n) => n.endsWith('.json'));
  return files.map((file) => {
    const d = JSON.parse(fs.readFileSync(path.join(DOCTORS_DIR, file), 'utf8'));
    return { slug: d.slug, name: `${d.first_name} ${d.last_name}`.trim() };
  });
}

async function main() {
  const ours = readExtractedDoctors();

  const departments = parseDepartments(await getText(INDEX_URL));
  if (!departments.length) throw new Error('No departments found — the specialists index changed shape.');

  const pages = await pooled(departments, (d) =>
    getText(`${ORIGIN}/list_26.aspx?lcid=${d.lcid}`).then((html) => parseDoctors(html, d.name)),
  );

  // itemid is the site's own key, so it dedupes doctors listed under two departments.
  const byItemId = new Map();
  for (const doc of pages.flat()) if (!byItemId.has(doc.itemid)) byItemId.set(doc.itemid, doc);

  const byName = new Map();
  for (const doc of byItemId.values()) {
    const k = nameKey(doc.siteName);
    if (!byName.has(k)) byName.set(k, doc);
  }

  const matched = [];
  const missing = [];
  for (const o of ours) {
    const hit = byName.get(nameKey(o.name));
    if (hit) matched.push({ ...o, ...hit });
    else missing.push(o.slug);
  }

  // Fail loudly rather than half-write: a partial mapping silently drops doctors
  // from the UI, and a stale complete mapping is easier to notice than a short one.
  if (missing.length) {
    throw new Error(
      `Matched ${matched.length}/${ours.length}. No portrait for: ${missing.join(', ')}`,
    );
  }

  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(MAPPING_PATH), { recursive: true });

  const cnProfiles = readCnProfiles();

  // Named by the fixture slug, not by the hospital's dated upload filename, so the
  // file on disk, the download and the ZIP entry all read as the doctor.
  const saved = await pooled(matched, async (m) => {
    const en = await getBytes(m.image);
    let best = { buf: en, url: m.image, origin: 'english' };

    // The Chinese site usually holds a larger original of the same doctor — 288x432
    // where the English site has 200x297, and occasionally far more. Not always:
    // one doctor's is 120x174, and 4 fixtures have no Chinese profile at all. So
    // both are measured and the bigger one wins, rather than assuming.
    const cn = cnProfiles[m.slug];
    if (cn) {
      try {
        const url = await cnOriginalUrl(cn.node);
        if (url) {
          const buf = await getBytes(url, CN_ORIGIN + cn.node);
          if (pixels(buf) > pixels(en)) best = { buf, url, origin: 'chinese' };
        }
      } catch {
        // A missing or moved Chinese original is not fatal — the English one stands.
      }
    }

    const ext = path.extname(new URL(best.url).pathname).toLowerCase() || '.jpg';
    const file = `${m.slug}${ext}`;
    fs.writeFileSync(path.join(IMAGE_DIR, file), best.buf);
    const size = imageSize(best.buf);
    return {
      ...m,
      file,
      bytes: best.buf.length,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
      origin: best.origin,
      image: best.url,
      cnName: cn?.name ?? '',
    };
  });

  // A doctor whose winning source flips .jpg → .png would otherwise leave the old
  // file behind, and it would still be swept into the ZIP.
  const keep = new Set(saved.map((s) => s.file));
  for (const stale of fs.readdirSync(IMAGE_DIR).filter((n) => !keep.has(n))) {
    fs.unlinkSync(path.join(IMAGE_DIR, stale));
  }

  const mapping = {};
  for (const s of saved.sort((a, b) => a.slug.localeCompare(b.slug))) {
    mapping[s.slug] = {
      name: s.name,
      siteName: s.siteName,
      cnName: s.cnName,
      department: s.department,
      file: s.file,
      bytes: s.bytes,
      width: s.width,
      height: s.height,
      origin: s.origin,
      source: s.image,
      profile: s.profile,
    };
  }
  fs.writeFileSync(MAPPING_PATH, `${JSON.stringify(mapping, null, 2)}\n`);

  const fromChinese = saved.filter((s) => s.origin === 'chinese').length;
  process.stdout.write(
    JSON.stringify({
      departments: departments.length,
      siteDoctors: byItemId.size,
      matched: matched.length,
      of: ours.length,
      downloaded: saved.length,
      fromChinese,
      fromEnglish: saved.length - fromChinese,
      smallest: saved.reduce((m, s) => Math.min(m, s.width || Infinity), Infinity),
      largest: saved.reduce((m, s) => Math.max(m, s.width), 0),
      bytes: saved.reduce((n, s) => n + s.bytes, 0),
      imageDir: 'public/doctors',
      mapping: 'data/doctor-photos.json',
    }),
  );
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: err.message || String(err) }));
  process.exitCode = 1;
});
