import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Row, Fixture, FaqSection } from "@/lib/types";
import type { PageRole } from "@/lib/pages";
import { titleCaseCollection, routeFor, fixtureFilename } from "@/lib/fixtures";
import { validateFixture } from "@/lib/validate";

const execFileP = promisify(execFile);

const PROMPT_PATH = "docs/prompts/faq-generation-prompt.md";
const RAW_DIR = "output/faq/raw";

export interface PageTargets {
  count: number;
  groups: number;
  /** True when the section is split into titled groups (pillar pages only). */
  grouped: boolean;
}

/**
 * Fixed counts, not ranges — the team's 2026-07-20 direction supersedes the
 * ranges in FAQ-AEO-INSTRUCTIONS.md §2. A blank role is a Support Page.
 */
export function pageTargets(role: PageRole): PageTargets {
  return role === "PILLAR PAGE"
    ? { count: 20, groups: 5, grouped: true }
    : { count: 10, groups: 1, grouped: false };
}

function shapeBlock(t: PageTargets): string {
  return t.grouped
    ? `{
  "type": "faq",
  "id": "faq",
  "h2": "Frequently Asked Questions",
  "groups": [
    { "title": "<themed group heading>",
      "items": [ { "q": "<question>", "a": "<p>...paragraph...</p>" } ] }
  ]
}

Hard rules for this fixture:
- Produce exactly 20 FAQ items in total.
- Split them across 4-5 themed groups of 4-5 items each. Every group has a
  non-empty "title".`
    : `{
  "type": "faq",
  "id": "faq",
  "h2": "Frequently Asked Questions",
  "groups": [
    { "title": "",
      "items": [ { "q": "<question>", "a": "<p>...paragraph...</p>" } ] }
  ]
}

Hard rules for this fixture:
- Produce exactly 10 FAQ items in total.
- Use exactly ONE group, and its "title" must be the empty string "".`;
}

/** Build the single-shot prompt for `claude -p`. */
export function buildPrompt(row: Row, promptPath?: string): string {
  const master = readFileSync(promptPath ?? resolve(process.cwd(), PROMPT_PATH), "utf8");
  const t = pageTargets(row.role);
  return (
    master +
    `
=====================================================================
OUTPUT FORMAT (this run)
=====================================================================
Return ONLY the FAQ section as a JSON object matching this exact shape:

${shapeBlock(t)}
- Item keys are exactly "q" and "a". Group heading key is exactly "title".
- Each "a" is built from <p>...</p> blocks and no other tag. One paragraph is
  preferred; a second paragraph of supporting context is acceptable.
- Mention CancerFax in exactly 1 or 2 answers.
- Never emit the ⚠ character, a schemaRecommendation, or a medicalDisclaimer.

=====================================================================
PAGE
=====================================================================
TITLE:      ${row.title}
COLLECTION: ${row.collection}
ROUTE:      ${routeFor(row.collection, row.slug)}
ROLE:       ${row.role || "Support Page (role blank in source)"}
PILLAR:     ${row.pillarAssociation || "n/a"}

Generate the FAQ section now as the JSON object described above.
Return ONLY the section JSON object, with no preamble and no code fences.
`
  );
}

/**
 * Wrap a generated section into the canonical fixture. Every wrapper field is
 * derived from the live-site CSV, so none of them can be a VERIFY placeholder.
 */
export function buildFixture(row: Row, section: FaqSection): Fixture {
  return {
    pillar: row.pillarAssociation || row.title,
    contentType: titleCaseCollection(row.collection),
    runner: "apply-pillar-faqs.js",
    slug: row.slug,
    route: routeFor(row.collection, row.slug),
    sectionToMerge: {
      type: "faq",
      id: "faq",
      h2: section.h2 || "Frequently Asked Questions",
      ...(section.intro ? { intro: section.intro } : {}),
      groups: section.groups ?? [],
    },
  };
}

/** Extract the outermost {...} JSON object from model output (strips preamble/fences). */
export function parseSectionFromOutput(text: string): FaqSection {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON object found in output");
  }
  return JSON.parse(text.slice(start, end + 1)) as FaqSection;
}

export interface GenerateOpts {
  timeout?: number;
  maxBuffer?: number;
  outDir?: string;
}

export type GenerateResult =
  | { ok: true; fixturePath: string }
  | { ok: false; error: string };

// Re-exported for server-side callers; the definitions live in the client-safe
// lib/gen-errors.ts (no Node imports) so client components can use them too.
export { AUTH_RE, RATE_RE, classifyGenError } from "@/lib/gen-errors";

/** Spawn `claude -p <prompt>`, parse + wrap + validate + write the raw fixture. */
export async function runGenerate(row: Row, opts: GenerateOpts = {}): Promise<GenerateResult> {
  const prompt = buildPrompt(row);
  let stdout: string;
  try {
    const res = await execFileP("claude", ["-p", prompt], {
      timeout: opts.timeout ?? 300_000,
      maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return { ok: false, error: err.stderr || err.message || "claude spawn failed" };
  }

  let fixture: Fixture;
  try {
    fixture = buildFixture(row, parseSectionFromOutput(stdout));
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // The gate: a fixture that fails any check never reaches raw/.
  const issues = validateFixture(fixture, row);
  if (issues.length > 0) {
    return { ok: false, error: issues.map((i) => `${i.check}: ${i.message}`).join("; ") };
  }

  const dir = opts.outDir ?? resolve(process.cwd(), RAW_DIR);
  mkdirSync(dir, { recursive: true });
  const fixturePath = join(dir, fixtureFilename(row.slug));
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
  return { ok: true, fixturePath };
}
