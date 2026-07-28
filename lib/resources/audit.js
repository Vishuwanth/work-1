'use strict';

/**
 * audit.js — duplicate-content detection, ported from
 * cancerfax-strapi-backend/scripts/audit-resource-duplicate-content.js so
 * this app is self-sustaining. Pure computation, read-only — never writes.
 */

const crypto = require('crypto');
const { flattenContentSections } = require('./shared');

const DEFAULT_MIN_LENGTH = 40; // below this, short headings/CTAs are too generic to mean anything
const DEFAULT_MIN_CROSS_PAGE_COUNT = 5; // appears in at least this many DIFFERENT resources
const NEAR_DUP_THRESHOLD = 0.9;

function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sectionText(section) {
  return normalize([section.heading, section.subHeading, section.text].filter(Boolean).join(' '));
}

function hash(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
}

function snippet(text, len = 120) {
  return text.length > len ? text.slice(0, len) + '…' : text;
}

/** Word-set Jaccard similarity — cheap, deterministic, catches a paraphrased CTA without external NLP deps. */
function similarity(a, b) {
  const wa = new Set(a.split(' ').filter(Boolean));
  const wb = new Set(b.split(' ').filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  const union = wa.size + wb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function findWithinPageDuplicates(resource, sections, minLength, rows) {
  for (let i = 0; i < sections.length; i++) {
    const a = sections[i];
    const aText = sectionText(a);
    if (aText.length < minLength) continue;
    for (let j = i + 1; j < sections.length; j++) {
      const b = sections[j];
      const bText = sectionText(b);
      if (bText.length < minLength) continue;
      const exact = aText === bText;
      const near = !exact && similarity(aText, bText) >= NEAR_DUP_THRESHOLD;
      if (exact || near) {
        rows.push({
          type: exact ? 'within-page-exact' : 'within-page-near',
          resource_slug: resource.slug,
          resource_title: resource.title || '',
          section_index: a.index,
          section_heading: a.heading || a.section_name || '',
          matched_against: `section #${b.index} (${b.heading || b.section_name || ''})`,
          snippet: snippet(aText),
          full_a: snippet(aText, 4000),
          full_b: snippet(bText, 4000),
          other_section_index: b.index,
          other_section_heading: b.heading || b.section_name || '',
        });
      }
    }
  }
}

/**
 * Pure computation — no fs/console. `resources` should be the FULL corpus
 * (fetchAllResources()) even when the caller only cares about a handful,
 * because cross-page boilerplate detection needs every resource to know a
 * block is repeated elsewhere.
 */
function computeDuplicates(resources, opts = {}) {
  const minLength = opts.minLength ?? DEFAULT_MIN_LENGTH;
  const minCount = opts.minCount ?? DEFAULT_MIN_CROSS_PAGE_COUNT;
  const rows = [];

  const crossPageIndex = new Map(); // normalized-text-hash -> { text, entries: [{slug, title, section}] }
  for (const resource of resources) {
    const sections = flattenContentSections(resource);
    findWithinPageDuplicates(resource, sections, minLength, rows);

    for (const s of sections) {
      const text = sectionText(s);
      if (text.length < minLength) continue;
      const key = hash(text);
      if (!crossPageIndex.has(key)) crossPageIndex.set(key, { text, entries: [] });
      crossPageIndex.get(key).entries.push({ slug: resource.slug, title: resource.title || '', section: s });
    }
  }

  for (const { text, entries } of crossPageIndex.values()) {
    const distinctSlugs = new Set(entries.map((e) => e.slug));
    if (distinctSlugs.size < minCount) continue;
    for (const e of entries) {
      const others = [...distinctSlugs].filter((s) => s !== e.slug).slice(0, 5);
      rows.push({
        type: 'cross-page-boilerplate',
        resource_slug: e.slug,
        resource_title: e.title,
        section_index: e.section.index,
        section_heading: e.section.heading || e.section.section_name || '',
        matched_against: `${distinctSlugs.size} resources total, e.g. ${others.join(', ')}`,
        snippet: snippet(text),
        full_a: snippet(text, 4000),
        all_matches: entries.map((m) => ({ slug: m.slug, title: m.title, index: m.section.index })),
      });
    }
  }

  return rows;
}

module.exports = { computeDuplicates, DEFAULT_MIN_LENGTH, DEFAULT_MIN_CROSS_PAGE_COUNT };
