import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import { loadAll, getFixture, getReview } from "@/app/actions";
import { applyEdits, fixtureFilename } from "@/lib/fixtures";
import { buildMapping, batchDirName } from "@/lib/batch-export";
import { pageKey } from "@/lib/pages";

// Writes to output/faq/ — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Write every approved row's corrected fixture plus mapping.json into
 * output/faq/batch-<date>/. Re-running on the same date replaces the folder, so a
 * re-export after fixing one row is safe.
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
  for (const v of approved) {
    const key = pageKey(v);
    const fixture = await getFixture(key);
    if (!fixture) {
      skipped.push(key);
      continue;
    }
    const corrected = applyEdits(fixture, await getReview(key));
    writeFileSync(
      join(dir, fixtureFilename(v.slug)),
      JSON.stringify(corrected, null, 2) + "\n",
    );
    written.push({ collection: v.collection, slug: v.slug });
  }

  writeFileSync(
    join(dir, "mapping.json"),
    JSON.stringify(buildMapping(written), null, 2) + "\n",
  );

  return Response.json({ dir, count: written.length, skipped });
}
