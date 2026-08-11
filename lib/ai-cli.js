'use strict';

/**
 * ai-cli.js — shared `claude -p` transport, extracted out of
 * lib/resources/classify.js so a second AI pipeline (lib/relations/*) does
 * not fork the brace-balancing JSON-envelope parser. That parser earned its
 * shape from real incidents (see describeModelOutput below) and is
 * content-agnostic — nothing here knows about resources, categories, or
 * relations.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileP = promisify(execFile);

/**
 * The hook that refused a prompt, e.g. "simplify-gate". The message names the
 * generic runner first, so that one is dropped — it is never the actual cause.
 */
function blockingHookName(text) {
  const names = [...text.matchAll(/hooks\/([a-z0-9-]+)\.(?:cjs|mjs|js|sh)/gi)]
    .map((m) => m[1])
    .filter((n) => n !== 'node-hook-runner');
  return names.at(-1) ?? null;
}

/**
 * Every top-level `{…}` span in `text`, brace-balanced and quote-aware.
 *
 * Replaces a first-`{`-to-last-`}` slice, which assumed the reply held exactly
 * one brace region. It does not: a hook refusal names `${CLAUDE_PLUGIN_ROOT}`,
 * prose cites sets like {a, b}, and the model sometimes writes a draft object
 * and then a corrected one. Any of those made the single span cover unrelated
 * text and fail to parse.
 */
function balancedObjects(text) {
  const spans = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString) {
        if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
          spans.push(text.slice(i, j + 1));
          i = j; // resume after this object, so nested braces are not re-scanned
          break;
        }
      }
    }
  }
  return spans;
}

/**
 * Read the model's reply, as `{ ok: true, value }` or `{ ok: false, error }`.
 *
 * A reply is not always the model's. A UserPromptSubmit hook can refuse the
 * prompt, and the CLI hands back the refusal with is_error:false and
 * subtype:"success" — indistinguishable from a real answer at the envelope
 * level. That has to be caught HERE, because the refusal text is a trap for the
 * brace scan below:
 *
 *   [bash "${CLAUDE_PLUGIN_ROOT}/hooks/simplify-gate.cjs"]: BLOCKED: …
 *            ^ first `{` in the message
 *
 * Slicing from there yields `{CLAUDE_PLUGIN_ROOT}/hooks/…`, so JSON.parse
 * reports a position-1 syntax error and the row is filed as a malformed MODEL
 * answer. 102 rows in data/resource-checks.json were mis-diagnosed that way;
 * re-running them could never help, because the model was never asked.
 *
 * `isShaped(obj)` is an optional predicate identifying the "real" answer
 * shape for the caller's use case (e.g. `o => typeof o.categorySlug ===
 * 'string'`). When given, the LAST object matching it wins over the last
 * object overall — the model sometimes drafts an answer, spots its own
 * mistake, and writes a corrected one below; the last shaped one is the one
 * it stands behind. Omitted, this just returns the last parsed object.
 */
function describeModelOutput(text, isShaped) {
  const raw = typeof text === 'string' ? text : '';

  if (/operation blocked by hook/i.test(raw)) {
    const name = blockingHookName(raw);
    const reason = raw.match(/BLOCKED:\s*([^\n]+)/);
    return {
      ok: false,
      error:
        `the prompt was blocked by a Claude Code hook${name ? ` (${name})` : ''}` +
        `${reason ? ` — ${reason[1].trim()}` : ''}`,
    };
  }

  const objects = balancedObjects(raw);
  if (objects.length === 0) {
    return { ok: false, error: 'no JSON object found in model output' };
  }

  const parsed = [];
  let lastError = null;
  for (const text of objects) {
    try {
      parsed.push(JSON.parse(text));
    } catch (e) {
      lastError = e;
    }
  }
  if (parsed.length === 0) {
    return { ok: false, error: `model output could not be parsed as JSON — ${lastError.message}` };
  }

  if (typeof isShaped !== 'function') {
    return { ok: true, value: parsed.at(-1) };
  }
  const shaped = parsed.filter((o) => o && isShaped(o));
  return { ok: true, value: (shaped.length ? shaped : parsed).at(-1) };
}

/**
 * `--output-format json` wraps the model's reply in an envelope that separates
 * CLI-level failures (rate limit, permission denial, timeout — surfaced via
 * `is_error`/`subtype`) from the model's own text (`result`). Without it, a
 * CLI-level failure and a badly-shaped model reply both just look like
 * "unparseable stdout", which is indistinguishable and unfixable after the
 * fact.
 *
 * `opts.allowedTools` (e.g. `['WebSearch']`) is forwarded as `--allowedTools`.
 * WebSearch is NOT auto-approved in `-p` mode — omitting this for a prompt
 * that expects the model to search the web leaves it unable to, not merely
 * slower. Only ever pass the exact tools a given pipeline needs; nothing here
 * defaults to a permissive set.
 *
 * Deliberately never passes `--bare`: that flag requires `ANTHROPIC_API_KEY`,
 * and every AI call in this app runs on the logged-in `claude` CLI
 * subscription instead — no API key anywhere (see README.md).
 */
async function callClaude(prompt, opts = {}) {
  const args = ['-p', prompt];
  if (Array.isArray(opts.allowedTools) && opts.allowedTools.length > 0) {
    args.push('--allowedTools', opts.allowedTools.join(','));
  }
  args.push('--output-format', 'json');

  const res = await execFileP('claude', args, {
    timeout: opts.timeout ?? 300_000,
    maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
    // The prompt often carries a whole medical article, so it trips prompt-scanning
    // hooks on words that are ordinary here: autoresearch's simplify-gate blocks
    // on "release", and "cytokine release syndrome" appears in dozens of these
    // articles. That gate exists to stop a HUMAN shipping an oversized diff; it
    // has no meaning for a batch AI call and blocked 102 rows outright the one
    // time this wasn't set.
    env: { ...process.env, AR_DISABLE_SIMPLIFY_GATE: '1', ...(opts.env || {}) },
  });
  const envelope = JSON.parse(res.stdout);
  if (envelope.is_error) {
    throw new Error(`claude CLI error (${envelope.subtype || envelope.api_error_status || 'unknown'})`);
  }
  const parsed = describeModelOutput(envelope.result, opts.isShaped);
  if (!parsed.ok) {
    console.error(`  raw model output that failed to parse:\n${envelope.result}`);
    throw new Error(parsed.error);
  }
  return parsed.value;
}

module.exports = { callClaude, describeModelOutput, balancedObjects, blockingHookName };
