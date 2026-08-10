import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface RunScriptResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

function parseResult(stdout: string): RunScriptResult {
  const lastLine = stdout.trim().split("\n").pop() ?? "{}";
  try {
    const data = JSON.parse(lastLine) as Record<string, unknown>;
    if (data && typeof data === "object" && typeof data.error === "string") {
      return { ok: false, error: data.error };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: `Could not parse script output: ${lastLine.slice(0, 300)}` };
  }
}

/**
 * Spawns `node <scriptPath> ...args>`, expecting exactly one JSON line on
 * stdout — either the successful payload, or `{ error: "..." }`.
 *
 * Our scripts always write that JSON line to stdout before setting a non-zero
 * exitCode on failure (see scripts/run-resource-check.js etc.) — but
 * execFile's promise still REJECTS on that non-zero exit, and Node's
 * rejection error only carries stdout/stderr as separate properties. A naive
 * `catch { error: e.stderr || e.message }` therefore surfaces a generic
 * "Command failed: node ..." instead of the actual reason, because the real
 * error is sitting in `e.stdout`. This checks stdout on both the success AND
 * failure path so the real error always makes it back to the client.
 */
export async function runJsonScript(
  scriptPath: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number; cwd?: string } = {},
): Promise<RunScriptResult> {
  try {
    const { stdout } = await execFileP("node", [scriptPath, ...args], {
      timeout: opts.timeout ?? 60_000,
      maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
      cwd: opts.cwd ?? process.cwd(),
    });
    return parseResult(stdout);
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    if (err.stdout) {
      const parsed = parseResult(err.stdout);
      if (!parsed.ok) return parsed;
    }
    return { ok: false, error: err.stderr || err.message || "script failed" };
  }
}

/**
 * Spawns `node <scriptPath> ...args` DETACHED and returns its pid immediately.
 *
 * Used for the Run/Write batch, which paces writes 5–10 minutes apart and so
 * runs for hours — far longer than any HTTP request should stay open. The
 * child outlives this request, and the caller closes the browser tab if it
 * likes; progress is reported through lib/resources/batch-store.js.
 *
 * `detached: true` puts the child in its own process group, which is what lets
 * the Stop button kill the runner AND its in-flight `claude` child together.
 * stdout+stderr go to `logPath` — with the process detached there is nobody
 * left to read a pipe, and an unread pipe fills up and blocks the writer.
 */
export function spawnDetachedScript(scriptPath: string, args: string[], logPath: string): number {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.openSync(logPath, "a");
  try {
    const child = spawn("node", [scriptPath, ...args], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    return child.pid ?? 0;
  } finally {
    fs.closeSync(log);
  }
}
