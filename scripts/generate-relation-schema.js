#!/usr/bin/env node
'use strict';

/**
 * generate-relation-schema.js — DEV TOOL, not part of the running app. Reads
 * Strapi's own `schema.json` files directly from a checkout of the
 * `cancerfax-strapi-backend` repo and emits `lib/relations/schema-registry.json`
 * — the ground-truth content-type + relation-field registry the Relations
 * tab's discovery.js loads.
 *
 * Why this replaced live heuristic probing: discovery.js originally guessed
 * candidate content types and inferred which fields were relations by
 * sampling live entries (populated-shape sniffing, a name-pattern check for
 * media, a second-pass existence probe for sparse fields). That worked but
 * was necessarily approximate — it could miss a field that happened to be
 * empty in every probe, and it had no way to know a relation's exact TARGET
 * content type (only a name-based guess). Strapi's own `schema.json` states
 * both exactly: `{ type: "relation", relation: "manyToMany", target:
 * "api::condition.condition" }` leaves nothing to infer. Reading it directly
 * turned up real coverage gaps in the probe-based approach (e.g.
 * `condition.recommended_doctors` was schema-real but empty on every
 * sampled row) and revealed 29 more content types entirely — including
 * `cancer-type`/`treatment-modality`, which turned out to be full topic-hub
 * pages (their own curated lists of related treatments/doctors/hospitals/
 * insights/…), not the flat taxonomy tags their names suggest.
 *
 * This script is NOT run automatically and the deployed app does not depend
 * on the sibling repo existing — it's a one-time (or re-run-when-the-schema-
 * changes) generation step. The output is a plain JSON file, committed to
 * this repo, and that's what discovery.js actually reads at runtime.
 *
 * Usage:
 *   node scripts/generate-relation-schema.js --backend="/path/to/cancerfax-strapi-backend"
 *   node scripts/generate-relation-schema.js   # falls back to the sibling checkout
 *                                               # this app was developed against
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_BACKEND_PATH = path.join(
  process.env.HOME || '',
  'Documents/Cancerfax/vscode/Cancerfax/Cancerfax Main/cancerfax-strapi-backend',
);

const OUTPUT_PATH = path.resolve(process.cwd(), 'lib/relations/schema-registry.json');

/**
 * Whole content types that never participate in the Relations tab, neither
 * as a mappable source nor as a link target — not a judgement call made per
 * field (like the media/internal/sensitive checks elsewhere in this
 * feature), because these types carry patient PII or are pure site
 * plumbing, not content:
 *
 *  - contact-submission, cost-calculator-lead, patient-intake,
 *    clinical-trial-intake, subscriber — prospective-patient PII (contact
 *    details, medical intake forms, mailing-list signups). Never a
 *    candidate for the model to see or link to, regardless of what
 *    relations they happen to declare.
 *  - crm-sync-log — an operational audit log, not content.
 *  - menu-item, redirection — site navigation/routing structure, not
 *    content with its own meaning to a patient.
 *  - cancerfax-help-config, global, resource-tag-config — Strapi
 *    `singleType`s (one global config record, not a corpus of entries) —
 *    excluded generically below, listed here only for documentation.
 *  - location — no `uid` slug field and no plain string field either (just
 *    `seo`/`isActive`/`contact`/`address` components): no synthesizable
 *    title, zero relations declared, and never referenced as a relation
 *    target by anything else. There's no content identity here to map.
 */
const EXCLUDED_API_IDS = new Set([
  'contact-submission',
  'cost-calculator-lead',
  'patient-intake',
  'clinical-trial-intake',
  'subscriber',
  'crm-sync-log',
  'menu-item',
  'redirection',
  'location',
]);

/**
 * Relation fields excluded on every content type regardless of target —
 * editorial metadata, not a "this page is about that page" content relation
 * a patient would ever follow. `author` — who wrote it — is a factual
 * editorial assignment, not a relevance judgement; nothing about "is this
 * treatment page relevant to that condition" tells you who should have
 * authored it, and there's no principled way for the model to guess
 * correctly. Kept visible under "current relations" (so a byline still
 * shows), just never a proposal target.
 *
 * (Strapi's i18n `localizations` link needs no entry here — it's injected at
 * runtime by the i18n plugin, never a declared `schema.json` attribute, so
 * it's simply never seen by the loop below. lib/relations/shared.js's
 * TEXT_SKIP_KEYS still excludes it explicitly for the separate, live-fetched
 * text-flattening path.)
 */
const NON_CONTENT_RELATION_FIELDS = new Set(['author']);

/** manyToOne/oneToOne → "one" (a single related entry); oneToMany/manyToMany → "many". */
function cardinalityOf(strapiRelation) {
  return strapiRelation === 'manyToOne' || strapiRelation === 'oneToOne' ? 'one' : 'many';
}

/** `api::condition.condition` → `condition` — Strapi's uid always repeats the singular name after the `::`. */
function apiIdFromUid(uid) {
  return uid.split('::')[1].split('.')[0];
}

function loadSchema(backendPath, apiFolderName) {
  const dir = path.join(backendPath, 'src/api', apiFolderName, 'content-types');
  const typeFolder = fs.readdirSync(dir)[0]; // one content-type per api/<name>/content-types/<name>/
  const schemaPath = path.join(dir, typeFolder, 'schema.json');
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

// When a content type has no `uid` slug field (country, faq, tag — a
// handful of the 39), there's no schema-declared title either. Rather than
// hardcode each type's field name, prefer a short list of names this
// codebase's own content types are already known to use, then fall back to
// the first plain string field in schema-declaration order — still ground
// truth (a real field that exists), just a heuristic about WHICH one reads
// best as a title.
const TITLE_FIELD_FALLBACK_CANDIDATES = ['title', 'name', 'question', 'country', 'condition_name', 'patient_name'];

// A short blurb field, if this type has one — shown alongside title/slug in
// the cheap, corpus-wide entry list (lib/relations/shared.js's
// fetchEntryList) so the model gets a little more than a bare title when
// judging a candidate target. Best-effort and optional: `excerptField` is
// null when none of these exist, and the list query simply omits it —
// unlike titleField, there's no schema-mandated field to fall back to here.
const EXCERPT_FIELD_CANDIDATES = [
  'excerpt',
  'short_quote',
  'story_excerpt',
  'featuredSnippetText',
  'tagline',
  'mechanism_summary',
];

function extractContentType(apiFolderName, schema) {
  if (schema.kind !== 'collectionType') return null; // singleType configs excluded generically, not just by name

  const info = schema.info || {};
  const apiId = info.singularName || apiFolderName;
  if (EXCLUDED_API_IDS.has(apiId)) return null;

  let slugField = null;
  let titleField = null;
  const stringFields = [];
  const relationFields = [];

  for (const [field, attr] of Object.entries(schema.attributes || {})) {
    if (attr.type === 'string' || attr.type === 'text') {
      stringFields.push(field);
    }
    if (attr.type === 'uid') {
      slugField = field;
      // Strapi's `uid` field slugifies FROM another field — that source
      // field is, by construction, the entry's human title. Ground truth,
      // not a guess: no more TITLE_FIELD_CANDIDATES heuristic needed for
      // any type that has a slug.
      titleField = attr.targetField || titleField;
    } else if (attr.type === 'relation' && typeof attr.target === 'string' && attr.target.startsWith('api::')) {
      const targetApiId = apiIdFromUid(attr.target);
      if (EXCLUDED_API_IDS.has(targetApiId)) continue; // never a candidate if the target itself is excluded
      relationFields.push({
        field,
        cardinality: cardinalityOf(attr.relation),
        targetApiId,
        private: Boolean(attr.private),
        nonContent: NON_CONTENT_RELATION_FIELDS.has(field),
      });
    }
  }

  if (!titleField) {
    titleField =
      TITLE_FIELD_FALLBACK_CANDIDATES.find((f) => stringFields.includes(f)) ?? stringFields[0] ?? null;
  }
  // `doctor` has no single name field — it falls back to `first_name` above,
  // dropping the surname. When that fallback field is literally `first_name`
  // and the schema also has a `last_name`, record it so getEntryTitle() can
  // join both instead of silently showing half a name.
  const lastNameField = titleField === 'first_name' && stringFields.includes('last_name') ? 'last_name' : null;
  const excerptField = EXCERPT_FIELD_CANDIDATES.find((f) => stringFields.includes(f)) ?? null;

  return {
    apiId,
    plural: info.pluralName,
    displayName: info.displayName || apiId,
    lastNameField,
    excerptField,
    titleField,
    slugField,
    relationFields,
  };
}

function main() {
  const backendArg = process.argv.find((a) => a.startsWith('--backend='));
  const backendPath = backendArg ? backendArg.slice('--backend='.length) : DEFAULT_BACKEND_PATH;

  if (!fs.existsSync(path.join(backendPath, 'src/api'))) {
    console.error(`No Strapi backend found at ${backendPath} (expected a src/api directory).`);
    console.error('Pass --backend="/path/to/cancerfax-strapi-backend" if it lives somewhere else.');
    process.exitCode = 1;
    return;
  }

  const apiFolders = fs.readdirSync(path.join(backendPath, 'src/api'));
  const contentTypes = [];
  for (const folder of apiFolders) {
    let schema;
    try {
      schema = loadSchema(backendPath, folder);
    } catch (e) {
      console.error(`Skipping ${folder}: ${e.message}`);
      continue;
    }
    const ct = extractContentType(folder, schema);
    if (ct) contentTypes.push(ct);
  }
  contentTypes.sort((a, b) => a.apiId.localeCompare(b.apiId));

  const registry = {
    generatedAt: new Date().toISOString(),
    sourceBackendPath: backendPath,
    contentTypes,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(registry, null, 2) + '\n');
  console.error(`Wrote ${contentTypes.length} content types to ${OUTPUT_PATH}`);
}

main();
