import { execFile } from "node:child_process";
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
