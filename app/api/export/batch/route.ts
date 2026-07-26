import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import { loadAll, getFixture, getReview } from "@/app/actions";
import { applyEdits, fixtureFilename } from "@/lib/fixtures";
import { buildFixture } from "@/lib/generate";
import { validateFixture } from "@/lib/validate";
import { buildMapping, batchDirName } from "@/lib/batch-export";
import { pageKey } from "@/lib/page-key";

// Writes to output/faq/ — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Write every approved row's corrected fixture plus mapping.json into
 * output/faq/batch-<date>/. Re-running on the same date replaces the folder, so a
 * re-export after fixing one row is safe.
 *
 * The wrapper is REBUILT from the live-site row rather than copied from the file
 * on disk. The pre-migration corpus still carries "⚠ VERIFY" slugs and
 * "/<section>/" routes from the old pipeline; exporting those verbatim would hand
 * the runner a fixture pointing at no page. Only the FAQ section is taken from the
 * file — identity always comes from the CSV.
 */
export async function POST(): Promise<Response> {
  const { views, error } = await loadAll();
  if (error) return new Response(error, { status: 500 });

  const approved = views.filter(
    (v) => v.reviewStatus === "approved" && v.contentState !== "not-generated",
  );
  if (approved.length === 0) {
    return new Response("no approved rows to export", { status: 400 });
  }

  const dir = resolve(process.cwd(), "output/faq", batchDirName());
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const written: { collection: string; slug: string }[] = [];
  const skipped: string[] = [];
  /** Exported, but not conforming to the current format rules — worth a reviewer's eye. */
  const warnings: { key: string; issues: string[] }[] = [];

  for (const v of approved) {
    const key = pageKey(v);
    const onDisk = await getFixture(key);
    if (!onDisk) {
      skipped.push(key);
      continue;
    }
    const edited = applyEdits(onDisk, await getReview(key));
    const fixture = buildFixture(v, edited.sectionToMerge);

    const issues = validateFixture(fixture, v);
    if (issues.length > 0) {
      warnings.push({ key, issues: issues.map((i) => `${i.check}: ${i.message}`) });
    }

    writeFileSync(join(dir, fixtureFilename(v.slug)), JSON.stringify(fixture, null, 2) + "\n");
    written.push({ collection: v.collection, slug: v.slug });
  }

  writeFileSync(join(dir, "mapping.json"), JSON.stringify(buildMapping(written), null, 2) + "\n");

  return Response.json({
    dir,
    count: written.length,
    skipped,
    warningCount: warnings.length,
    warnings: warnings.slice(0, 20),
  });
}
