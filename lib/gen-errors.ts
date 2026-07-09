// Pure generation-error classifiers. No Node imports, so this is safe to import
// from client components (unlike lib/generate.ts, which spawns `claude -p`).

/** Claude CLI is not logged in — every row will fail, so a batch should abort immediately. */
export const AUTH_RE = /log ?in|logged in|authenticat|credential|invalid api|not.*authoriz|unauthor/i;
/** Transient throttling — a batch should back off and retry rather than abort or fail the row. */
export const RATE_RE = /rate.?limit|429|too many requests|overloaded|quota|try again later/i;

/** Classify a generation error so the batch runner can decide: abort / retry / fail-and-continue. */
export function classifyGenError(error: string): "auth" | "rate-limit" | "other" {
  if (AUTH_RE.test(error)) return "auth";
  if (RATE_RE.test(error)) return "rate-limit";
  return "other";
}
