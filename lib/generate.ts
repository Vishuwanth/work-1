import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Row, Fixture, FaqSection } from "@/lib/types";
import { slugify } from "@/lib/slug";
import { isFaqShape } from "@/lib/fixtures";

const execFileP = promisify(execFile);

const PROMPT_PATH = "docs/prompts/faq-generation-prompt.md";
const RAW_DIR = "output/faq/raw";

const MEDICAL_DISCLAIMER =
  "This information is for educational purposes only and should not be considered " +
  "medical advice. Cancer diagnosis and treatment decisions should always be made by " +
  "a qualified oncology team after reviewing the patient's medical history, reports, " +
  "imaging, pathology, biomarkers, previous treatments, and overall health condition.";

interface ContentInfo {
  runner: string;
  routeBase: string;
  schema: string;
}

/** The FAQPage + MedicalWebPage + BreadcrumbList recommendation, parameterized by parent page label. */
function faqSchemaRec(parent?: string): string {
  return (
    "Use FAQPage schema for this section, combined with MedicalWebPage and " +
    `BreadcrumbList schema for the parent ${parent ? parent + " " : ""}page.`
  );
}

const CONTENT_TYPE_MAP: Record<string, ContentInfo> = {
  treatment: {
    runner: "seed-treatment.js",
    routeBase: "/treatments",
    schema:
      "Use FAQPage schema for this section, combined with MedicalTherapy " +
      "(and MedicalProcedure where relevant), MedicalWebPage, and BreadcrumbList " +
      "schema for the parent Treatment page.",
  },
  guide: {
    runner: "seed-guide.js",
    routeBase: "/guides",
    schema: faqSchemaRec("Guide"),
  },
  insight: {
    runner: "seed-insight.js",
    routeBase: "/insights",
    schema: faqSchemaRec("Insight"),
  },
};

/** The five recognized page kinds (plus "unknown"), derived from the free-text Content Type. */
export type ContentTypeKind = "treatment" | "guide" | "insight" | "trial" | "pillar" | "unknown";

/** Normalize the sheet's free-text Content Type into one canonical kind (substring match). */
export function normalizeContentType(raw: string): ContentTypeKind {
  const ct = (raw || "").toLowerCase();
  if (ct.includes("trial")) return "trial";
  if (ct.includes("treatment") || ct.includes("condition")) return "treatment";
  if (ct.includes("guide")) return "guide";
  if (ct.includes("insight") || ct.includes("support")) return "insight";
  if (ct.includes("pillar")) return "pillar";
  return "unknown";
}

const PILLAR_GROUPS =
  "5 thematic groups (Understanding / Eligibility, Process & Safety / " +
  "Cost, Access & Countries / Advanced Options & Clinical Trials / " +
  "Practical Questions for International Patients)";

export interface PageTargets {
  count: number;
  min: number;
  max: number;
  groups: number;
  groupHint: string;
}

/** FAQ count + group targets by page type. Blank/unknown -> Pillar default (18/5). */
export function pageTargets(contentType: string): PageTargets {
  switch (normalizeContentType(contentType)) {
    case "trial":
      return { count: 6, min: 5, max: 8, groups: 2, groupHint: "2 thematic groups (or one flowing list if the topic is narrow)" };
    case "treatment":
      return { count: 10, min: 8, max: 12, groups: 4, groupHint: "3-4 thematic groups" };
    case "guide":
    case "insight":
      return { count: 8, min: 6, max: 10, groups: 3, groupHint: "2-3 thematic groups (or one flowing list if the topic is narrow)" };
    case "pillar":
    case "unknown":
    default:
      return { count: 18, min: 15, max: 20, groups: 5, groupHint: PILLAR_GROUPS };
  }
}

function contentTypeInfo(contentType: string): ContentInfo | null {
  switch (normalizeContentType(contentType)) {
    case "treatment":
      return CONTENT_TYPE_MAP.treatment;
    case "guide":
      return CONTENT_TYPE_MAP.guide;
    case "insight":
      return CONTENT_TYPE_MAP.insight;
    default:
      return null;
  }
}

function buildOverride(t: PageTargets): string {
  return `
=====================================================================
FIXTURE OUTPUT OVERRIDE (this run only — overrides the OUTPUT FORMAT section above)
=====================================================================
Return ONLY the FAQ section as a JSON object matching this exact shape (compact keys):

{
  "type": "faq",
  "id": "faq",
  "h2": "Frequently Asked Questions About <Topic>",
  "intro": "<1-2 sentence plain-text intro>",
  "groups": [
    { "title": "<H3 group heading>",
      "items": [ { "q": "<question>", "a": "<p>...single paragraph...</p>" } ] }
  ]
}

Hard rules for the fixture:
- Produce about ${t.count} FAQs total (never fewer than ${t.min} or more than ${t.max}),
  organized into ${t.groupHint}.
- Item keys are exactly "q" and "a"; group heading key is exactly "title". No "style" field anywhere.
- Each "a" value is a SINGLE HTML paragraph wrapped in <p>...</p> (no other HTML, no markdown, no lists).
- Each answer is ~65-75 words, opens with a direct quotable sentence, hedges eligibility/cost/
  trial/international-access claims, and never promises cures or guaranteed outcomes.
- Mention CancerFax exactly ONCE, in the final FAQ ("How does CancerFax help patients with <topic>?"),
  using the approved non-promotional phrasing that defers to the treating oncology team.
- Do not include the schema recommendation or the medical disclaimer inside the section — those are
  added by the pipeline as top-level fields.
`;
}

/** Build the single-shot prompt for `claude -p`. */
export function buildPrompt(row: Row, promptPath?: string): string {
  const master = readFileSync(promptPath ?? resolve(process.cwd(), PROMPT_PATH), "utf8");
  const t = pageTargets(row.contentType);
  return (
    master +
    buildOverride(t) +
    `\nTOPIC: ${row.title}\n` +
    `PILLAR: ${row.pillarName || "n/a"}\n` +
    `PAGE TYPE: ${row.contentType || "Support Page"}\n\n` +
    "Generate the FAQ section now as the fixture JSON described above. " +
    "Return ONLY the section JSON object, with no preamble or code fences."
  );
}

/** Wrap a generated section into the status-aware fixture wrapper (build_output port). */
export function wrapSection(row: Row, section: FaqSection): Fixture {
  const info = contentTypeInfo(row.contentType);
  const slug = slugify(row.title);
  let runner: string;
  let route: string;
  let schemaRec: string;
  if (info) {
    runner = info.runner;
    route = `⚠ VERIFY: ${info.routeBase}/${slug}`;
    schemaRec = info.schema;
  } else {
    runner = "⚠ VERIFY: unknown (Content Type not set in sheet)";
    route = `⚠ VERIFY: /<section>/${slug}`;
    schemaRec = faqSchemaRec();
  }
  const isDone = row.excelStatus.toLowerCase() === "done";
  const sectionField = isDone ? "sectionToMerge" : "section";
  return {
    pillar: row.title,
    contentType: row.contentType || "⚠ VERIFY",
    runner,
    slug: `⚠ VERIFY: ${slug}`,
    route,
    [sectionField]: section,
    schemaRecommendation: schemaRec,
    medicalDisclaimer: MEDICAL_DISCLAIMER,
  } as Fixture;
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
    const section = parseSectionFromOutput(stdout);
    fixture = wrapSection(row, section);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!isFaqShape(fixture)) {
    return { ok: false, error: "generated section is not a valid faq shape" };
  }

  const dir = opts.outDir ?? resolve(process.cwd(), RAW_DIR);
  mkdirSync(dir, { recursive: true });
  // Match the Python pipeline's naming so both generation paths produce identical filenames.
  const fixturePath = join(dir, `${slugify(row.title)}-faq-section.json`);
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
  return { ok: true, fixturePath };
}
