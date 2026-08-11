'use strict';

/**
 * classify.js — the relations analogue of lib/resources/classify.js: builds
 * the per-entry prompt, calls `claude -p` (with WebSearch allowed), validates
 * the reply, and runs the whole selection serially, one entry at a time.
 *
 * The relation-type vocabulary is NOT a hand-invented taxonomy (an earlier
 * draft of this design used one — "treats", "performed_by", "see_also", …).
 * Live discovery (lib/relations/discovery.js) showed CancerFax's own Strapi
 * schema already defines the real vocabulary: every content type carries
 * specific, precisely-named relation fields (`treatment.conditions`,
 * `condition.recommended_doctors`, `drug.related_guides`, …), most of them
 * populated on only a few entries so far. Using the discovered field NAME
 * itself as `relationType` means a proposal is automatically the same shape
 * as a "current relation" and, for fields discovery confirmed exist, is
 * directly writable — no separate mapping layer to keep in sync. `see_also`
 * is the one addition: a generic, always-report-only bucket for a genuinely
 * useful link that doesn't fit any existing field.
 */

const { callClaude } = require('../ai-cli');
const { flattenEntryText, getEntryTitle, entrySlug, currentRelations } = require('./shared');

const SEE_ALSO = 'see_also';

// A bounded per-type slice of the corpus is shown to the model as candidate
// targets — not the whole corpus (~3,400 entries across 37 content types,
// which would blow prompt size and cost for little benefit on an unrelated
// entry). Small content types are shown in full; large ones are ranked by
// simple keyword overlap with the entry being mapped. This is a plain
// heuristic, not semantic search — a known simplification, not a hidden one.
const MAX_CANDIDATES_PER_TYPE = 60;

function tokenize(text) {
  return new Set((String(text).toLowerCase().match(/[a-z0-9]{4,}/g) || []));
}

function overlapScore(entryTokens, candidate) {
  const candidateTokens = tokenize(`${candidate.title} ${candidate.excerpt}`);
  let score = 0;
  for (const t of candidateTokens) if (entryTokens.has(t)) score++;
  return score;
}

/** The corpus, filtered to this entry's own type-mates plus a relevance-ranked slice of every other type. Never includes the entry itself. */
function selectCandidates(entry, typeConfig, entryText, corpusIndex) {
  const entryTokens = tokenize(`${getEntryTitle(entry, typeConfig)} ${entryText}`.slice(0, 2000));
  const byType = new Map();
  for (const c of corpusIndex) {
    if (c.documentId === entry.documentId) continue;
    if (!byType.has(c.contentType)) byType.set(c.contentType, []);
    byType.get(c.contentType).push(c);
  }

  const selected = [];
  for (const list of byType.values()) {
    if (list.length <= MAX_CANDIDATES_PER_TYPE) {
      selected.push(...list);
      continue;
    }
    const ranked = list
      .map((c) => ({ c, score: overlapScore(entryTokens, c) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATES_PER_TYPE);
    selected.push(...ranked.map((r) => r.c));
  }
  return selected;
}

/** The relation types this content type's entries may be mapped with — discovered fields (excluding reserved ones another feature owns and editorial metadata like `author`) plus the always-available generic fallback. `targetApiId` comes straight from the Strapi schema (see schema-registry.json) — not a guess — so `validateRelations` can enforce it, not just hint it. */
function buildVocabulary(typeConfig) {
  const fromFields = (typeConfig.relationFields || [])
    .filter((rf) => !rf.reserved && !rf.nonContent)
    .map((rf) => ({
      field: rf.field,
      writable: true,
      targetApiId: rf.targetApiId,
    }));
  return [...fromFields, { field: SEE_ALSO, writable: false, targetApiId: null }];
}

function formatCurrentRelations(rels) {
  if (rels.length === 0) return '(none yet)';
  return rels.map((r) => `- ${r.field} → [${r.contentType ?? '?'}] ${r.title}`).join('\n');
}

function formatVocabulary(vocabulary) {
  return vocabulary
    .map((v) => {
      const hint = v.targetApiId ? ` (target type: ${v.targetApiId})` : '';
      const scope = v.writable ? '' : ' [report-only — no Strapi field for this yet]';
      return `- ${v.field}${hint}${scope}`;
    })
    .join('\n');
}

function formatCandidates(candidates) {
  return candidates
    .map((c) => `- targetContentType="${c.contentType}" targetSlug="${c.slug}" — ${c.title}${c.excerpt ? ` — ${c.excerpt}` : ''}`)
    .join('\n');
}

function buildPrompt({ contentType, slug, entryText, currentRels, vocabulary, candidates }) {
  return `You are mapping content relations for CancerFax, a specialist cancer patient-navigation and advanced-treatment-access platform. Never describe it as generic medical tourism, and judge relevance the way a patient or caregiver actually reading this page would.

=====================================================================
PAGE BEING MAPPED
=====================================================================
Content type: ${contentType}
Slug: ${slug}
${entryText}

=====================================================================
CURRENT RELATIONS (already set in Strapi — never propose these again)
=====================================================================
${formatCurrentRelations(currentRels)}

=====================================================================
RELATION TYPES YOU MAY PROPOSE (the "relationType" field — pick ONLY from this list, never invent one)
=====================================================================
${formatVocabulary(vocabulary)}

=====================================================================
CANDIDATE TARGETS (pick "targetContentType"/"targetSlug" ONLY from this list — never invent a page, slug, or URL that isn't listed here, even if you find one via WebSearch)
=====================================================================
${candidates.length ? formatCandidates(candidates) : '(no other CancerFax pages are available to link to right now)'}

=====================================================================
INSTRUCTIONS
=====================================================================
1. Propose a relation only when it is clearly useful to a cancer patient or caregiver reading this page. Do not pad the list to reach any particular count — an empty "relations" array is a completely valid answer if nothing genuinely fits.
2. "relationType" is the FIELD NAME from the RELATION TYPES list above — it is never the target's content type. If the best target you found is a "guide" or "insight" (etc.) page but none of the RELATION TYPES fields is meant for that, use "see_also" rather than inventing a relationType named after the content type.
3. You may use WebSearch to verify a medical or factual claim before proposing a relation (e.g. whether a drug is actually indicated for a condition, or a treatment modality applies to a cancer type) — but every "targetSlug" you output MUST still be copied from the CANDIDATE TARGETS list above. Web search informs your judgment; it is never a source of the target itself.
4. Never repeat a relation already listed under CURRENT RELATIONS, and never relate the page to itself.

=====================================================================
OUTPUT FORMAT
=====================================================================
Return ONLY a single JSON object, no preamble, no code fences, matching exactly:
{
  "relations": [
    {
      "relationType": "<one value from RELATION TYPES>",
      "targetContentType": "<content type of the chosen candidate>",
      "targetSlug": "<slug from CANDIDATE TARGETS>",
      "rationale": "<one short sentence>"
    }
  ]
}
`;
}

const isRelationsShaped = (o) => Array.isArray(o.relations);

/**
 * `sourceKey`/`currentRelKeys`/`candidatesByKey` are all `${contentType}/${slug}`
 * strings — the one identity format used everywhere in this module, mirroring
 * lib/page-key.ts's `pageKey()` for the FAQ tool.
 */
function entryKey(contentType, slug) {
  return `${contentType}/${slug}`;
}

/**
 * The hard gate — nothing failing this is ever written or even reported as
 * "proposed". Unlike lib/resources/classify.js's validateClassification
 * (one required value, so any failure invalidates the whole reply), a
 * relations reply is a variable-length LIST: a model that gets three
 * proposals right and one wrong should not lose the three good ones, so
 * invalid individual proposals are dropped rather than failing the batch.
 * The overall result only fails validation if the reply isn't even shaped
 * like `{ relations: [...] }` at all.
 */
function validateRelations(raw, { vocabulary, candidatesByKey, currentRelKeys, sourceKey }) {
  if (!raw || !Array.isArray(raw.relations)) {
    return { ok: false, reason: 'relations-not-array' };
  }
  const validFieldNames = new Set(vocabulary.map((v) => v.field));
  const seen = new Set();
  const accepted = [];
  const rejected = [];

  for (const r of raw.relations) {
    if (!r || typeof r.relationType !== 'string' || typeof r.targetSlug !== 'string' || typeof r.targetContentType !== 'string') {
      rejected.push({ raw: r, reason: 'malformed' });
      continue;
    }
    if (!validFieldNames.has(r.relationType)) {
      rejected.push({ raw: r, reason: `unknown-relation-type:${r.relationType}` });
      continue;
    }
    // Real constraint, not a hint: `targetApiId` comes straight from the
    // Strapi schema (a `manyToMany` field can only ever point at the one
    // type it was declared against), so a mismatch here is never a
    // borderline call — it's the model naming the right field but the wrong
    // kind of page (e.g. proposing a `doctor` as a `conditions` relation).
    const field = vocabulary.find((v) => v.field === r.relationType);
    if (field?.targetApiId && r.targetContentType !== field.targetApiId) {
      rejected.push({ raw: r, reason: `target-type-mismatch:expected ${field.targetApiId}, got ${r.targetContentType}` });
      continue;
    }
    const targetKey = entryKey(r.targetContentType, r.targetSlug);
    if (!candidatesByKey.has(targetKey)) {
      rejected.push({ raw: r, reason: 'target-not-in-corpus' });
      continue;
    }
    if (targetKey === sourceKey) {
      rejected.push({ raw: r, reason: 'self-relation' });
      continue;
    }
    if (currentRelKeys.has(`${r.relationType}:${targetKey}`)) {
      rejected.push({ raw: r, reason: 'already-current' });
      continue;
    }
    const dedupeKey = `${r.relationType}:${targetKey}`;
    if (seen.has(dedupeKey)) {
      rejected.push({ raw: r, reason: 'duplicate-in-reply' });
      continue;
    }
    seen.add(dedupeKey);
    const target = candidatesByKey.get(targetKey);
    accepted.push({
      relationType: r.relationType,
      targetContentType: target.contentType,
      targetSlug: target.slug,
      targetTitle: target.title,
      // Strapi's relation-write payload needs the target's documentId, not
      // its slug — carried through here so a later Write pass (which reads
      // this persisted row back, never re-calling Claude — see
      // scripts/run-relation-check.js) has what it needs without re-fetching.
      targetDocumentId: target.documentId,
      rationale: typeof r.rationale === 'string' ? r.rationale.slice(0, 500) : '',
      writable: vocabulary.find((v) => v.field === r.relationType)?.writable ?? false,
    });
  }

  return { ok: true, relations: accepted, rejected };
}

/**
 * One entry's full mapping call: builds the prompt, calls Claude with
 * WebSearch allowed, validates. Never throws for a normal model/validation
 * failure — callers get `{ ok: false, reason }` and move on, matching
 * classifyAll's per-row resilience.
 */
async function mapEntry({ entry, typeConfig, corpusIndex, corpusLookup }) {
  const entryText = flattenEntryText(entry, typeConfig);
  const currentRels = currentRelations(entry, typeConfig, corpusLookup);
  // currentRelations() resolves each relation's title via the documentId
  // lookup; rebuild that same resolution as `${field}:${contentType}/${slug}`
  // keys so validateRelations can dedupe a proposal against it by slug — a
  // relation missing from corpusLookup (a draft, or an undiscovered type) is
  // simply dropped from this set rather than blocking validation on it.
  const currentRelKeys = new Set(
    currentRels
      .map((r) => {
        const resolved = corpusLookup.get(r.documentId);
        return resolved ? `${r.field}:${entryKey(resolved.contentType, resolved.slug)}` : null;
      })
      .filter(Boolean),
  );

  const vocabulary = buildVocabulary(typeConfig);
  const candidates = selectCandidates(entry, typeConfig, entryText, corpusIndex);
  const candidatesByKey = new Map(candidates.map((c) => [entryKey(c.contentType, c.slug), c]));
  const slug = entrySlug(entry, typeConfig);
  const sourceKey = entryKey(typeConfig.apiId, slug);

  const prompt = buildPrompt({
    contentType: typeConfig.apiId,
    slug,
    entryText,
    currentRels,
    vocabulary,
    candidates,
  });

  let raw;
  try {
    raw = await callClaude(prompt, { allowedTools: ['WebSearch'], isShaped: isRelationsShaped });
  } catch (e) {
    return { ok: false, reason: `error:${e.message}` };
  }

  return validateRelations(raw, { vocabulary, candidatesByKey, currentRelKeys, sourceKey });
}

module.exports = {
  buildPrompt,
  buildVocabulary,
  selectCandidates,
  validateRelations,
  mapEntry,
  entryKey,
  SEE_ALSO,
  MAX_CANDIDATES_PER_TYPE,
};
