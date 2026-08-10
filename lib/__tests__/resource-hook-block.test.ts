import { describe, expect, it } from "vitest";

import { describeModelOutput } from "@/lib/resources/classify";

/**
 * The reply the `claude` CLI returns when a UserPromptSubmit hook refuses the
 * prompt. Copied verbatim from a real failure on
 * `development-and-future-potential-of-the-bite-bispecific-t-cell-engager-platform`,
 * whose text contains "cytokine release syndrome" — `release` is one of
 * simplify-gate's shipping verbs.
 *
 * The CLI reports this with is_error:false and subtype:"success", so nothing
 * upstream flags it. The trap is the FIRST `{` in the message sitting inside
 * `${CLAUDE_PLUGIN_ROOT}`, which is what made JSON.parse report a position-1
 * syntax error and sent 102 rows to needs-manual-review as if the MODEL had
 * misbehaved.
 */
const HOOK_BLOCK_REPLY = `UserPromptSubmit operation blocked by hook:
[bash "\${CLAUDE_PLUGIN_ROOT}/hooks/node-hook-runner.sh" "\${CLAUDE_PLUGIN_ROOT}/hooks/simplify-gate.cjs"]: BLOCKED: 13005 lines changed exceeds 800 LOC shipping threshold. Simplify before shipping. Use AR_DISABLE_SIMPLIFY_GATE=1 to override.

Original prompt: You are classifying a CancerFax blog article`;

const GOOD_REPLY = `{"categorySlug":"cancer-research","tagSlugs":["leukemia","immunotherapy","blood-cancer"],"rationale":"Covers BiTE research."}`;

describe("describeModelOutput", () => {
  it("names a hook block instead of blaming the model's JSON", () => {
    const result = describeModelOutput(HOOK_BLOCK_REPLY);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("blocked by a Claude Code hook");
    expect(result.error).toContain("simplify-gate");
    // The old failure mode: a position-1 parse error that reads like the model
    // returned malformed JSON. It must never surface for a blocked prompt.
    expect(result.error).not.toContain("position 1");
  });

  it("still parses a normal reply", () => {
    const result = describeModelOutput(GOOD_REPLY);

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      categorySlug: "cancer-research",
      tagSlugs: ["leukemia", "immunotherapy", "blood-cancer"],
      rationale: "Covers BiTE research.",
    });
  });

  it("parses a reply wrapped in prose or a code fence", () => {
    expect(describeModelOutput("Here you go:\n```json\n" + GOOD_REPLY + "\n```").ok).toBe(true);
  });

  it("reports genuinely malformed model JSON as a parse failure", () => {
    const result = describeModelOutput(`{'categorySlug':'cancer-research'}`);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("could not be parsed");
    expect(result.error).not.toContain("hook");
  });

  it("reports an empty reply rather than throwing", () => {
    const result = describeModelOutput("");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("no JSON object");
  });
});

/**
 * The model sometimes drafts an answer, notices its own mistake, and writes a
 * second one. Verbatim shape of a real reply for
 * `more-than-12-of-newly-diagnosed-lung-cancer-patients-newer-smoked-cigarettes-study-suggests`.
 *
 * Spanning first `{` to last `}` swallows BOTH objects and the prose between
 * them, so a reply whose final answer is perfectly good was filed as unparseable.
 */
const SELF_CORRECTED_REPLY = `{
  "categorySlug": "screening-and-prevention",
  "tagSlugs": ["lung-cancer", "research-update", "awareness-and-education"],
  "rationale": "Placeholder"
}

Wait — that draft is wrong. Correct output:

{
  "categorySlug": "screening-and-prevention",
  "tagSlugs": ["lung-cancer", "research-update", "newly-diagnosed"],
  "rationale": "A US registry study on lung cancer risk in never-smokers."
}`;

describe("describeModelOutput with more than one JSON object", () => {
  it("takes the model's corrected answer, not its discarded draft", () => {
    const result = describeModelOutput(SELF_CORRECTED_REPLY);

    expect(result.ok).toBe(true);
    expect(result.value.tagSlugs).toEqual(["lung-cancer", "research-update", "newly-diagnosed"]);
    expect(result.value.rationale).not.toBe("Placeholder");
  });

  it("ignores a leading object that is not a classification", () => {
    const reply =
      `{"note": "scratch"}\nFinal:\n` +
      `{"categorySlug":"awareness","tagSlugs":["lung-cancer","news","patient-guide"],"rationale":"r"}`;

    expect(describeModelOutput(reply).value.categorySlug).toBe("awareness");
  });

  it("ignores braces in prose that surround the real answer", () => {
    const reply =
      `The set {a, b} is irrelevant.\n` +
      `{"categorySlug":"approvals","tagSlugs":["lung-cancer","news","patient-guide"],"rationale":"r"}\n` +
      `Footnote: see {ref}.`;

    expect(describeModelOutput(reply).value.categorySlug).toBe("approvals");
  });
});
