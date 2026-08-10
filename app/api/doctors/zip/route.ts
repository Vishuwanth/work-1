import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// Spawns /usr/bin/zip — must run on Node, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_DIR = path.resolve(process.cwd(), "public/doctors");
const ARCHIVE_NAME = "sysucc-doctor-photos.zip";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Zips public/doctors and streams it back.
 *
 * Built into a temp dir rather than the repo: the archive is a pure function of
 * public/doctors, so a copy on disk is one more thing to go stale. `zip` will
 * not overwrite in place either, so a repo-local path would need unlinking first.
 *
 * Entries keep the slug filenames the fetch script wrote, so what you unzip is
 * named the same as what the cards show.
 */
export async function GET(): Promise<Response> {
  let files: string[];
  try {
    files = fs.readdirSync(IMAGE_DIR).filter((n) => /\.(jpg|jpeg|png)$/i.test(n));
  } catch {
    return json(
      { error: "No portraits on disk — run `node scripts/fetch-doctor-photos.js` first." },
      404,
    );
  }
  if (!files.length) return json({ error: "public/doctors is empty — nothing to zip." }, 404);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-photos-"));
  const zipPath = path.join(tmpDir, ARCHIVE_NAME);
  try {
    // -j drops the directory prefix so entries are bare `dr-<name>.jpg`.
    await execFileP("/usr/bin/zip", ["-j", "-q", zipPath, ...files.map((f) => path.join(IMAGE_DIR, f))]);
    const bytes = fs.readFileSync(zipPath);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${ARCHIVE_NAME}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return json({ error: `Could not build the archive — ${(e as Error).message}` }, 500);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
