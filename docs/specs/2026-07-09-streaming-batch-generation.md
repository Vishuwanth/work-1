# Spec: Streaming Batch Generation + Live Progress

**Date:** 2026-07-09
**Status:** Approved (grilled 2026-07-09)
**Supersedes:** the serial client-driven `GenerateControls` loop.

## Problem

Generation is `claude -p` spawned from a Server Action (`lib/generate.ts` → `runGenerate`).
Three tangled pains:

- **P1 — slow:** each call is a full agentic run (~1–2 min). Unfixable per-call.
- **P2 — no feedback:** single-row generate (`app-shell.tsx:38`) shows nothing for 30s–3min
  until a toast fires. The Generate button has no loading state.
- **P3 — serial:** the batch (`generate-controls.tsx:58`) runs one row at a time. 719 rows ≈ 12h+.
  It also calls `router.refresh()` after *every* row → full RSC-tree re-render thrash.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| Root | Where it runs | **Local-only, single-user.** No Supabase. Tracker stays JSON. |
| Workload | On-demand vs batch | **Both** — single-row loader first, then batch runner. |
| Batch loop owner | client vs server | **Server-owned streaming Route Handler** for batch; **Server Actions** for single-row + all mutations. |
| Batch scope | what it operates on | **Checked rows if any (new checkbox column), else filtered-visible ungenerated set.** |
| 5a per-row failure | stop vs continue | **Continue-and-collect**; report failures, re-select to retry. |
| 5b auth failure | stop vs continue | **Abort immediately** ("run `claude` to log in"). |
| 5c already-generated | skip vs overwrite | **Skip** (report N skipped). Never overwrite a reviewed fixture. Regenerate = explicit single-row action. |
| rate-limit | | **Back off / pause**, don't abort the run. |
| Progress UX | | **Per-row live pills in the table + a dedicated batch panel** (bar, counts, failure list). |
| Reload behavior | | Fixtures written to disk as each completes; reload stops spawning new rows (abort on client disconnect); skip-existing lets "Generate again" resume. |
| Concurrency | | **Default 3**, exposed as a knob (env `FAQ_GEN_CONCURRENCY` + panel input). Tune empirically. |

### Explicitly rejected
- **Supabase** — no problem to solve for a local single-user tool; adds a service to run.
- **REST-everything** — Server Actions are the better primitive for short transactional mutations;
  endpoints only where streaming earns them.
- **Making one call faster** — impossible; attack *total* time (parallelism) + *perceived* time (progress).

## Architecture

### 1. Concurrency-capped batch runner (`lib/batch.ts`, new)
Pure orchestration over `runGenerate`, transport-agnostic (so it's unit-testable without HTTP).

```ts
type GenEvent =
  | { type: "start"; total: number }
  | { type: "row"; slug: string; status: "running" }
  | { type: "row"; slug: string; status: "done" }
  | { type: "row"; slug: string; status: "failed"; error: string }
  | { type: "row"; slug: string; status: "skipped" }
  | { type: "aborted"; reason: "auth" | "client-disconnect"; message: string }
  | { type: "done"; done: number; failed: number; skipped: number };

// runBatch(slugs, { concurrency, signal, isAlreadyGenerated }, emit): Promise<Summary>
```

- Worker pool of `concurrency` (default 3). Pull slugs from a shared cursor.
- Before each row: if fixture already on disk → emit `skipped`, continue.
- Run `runGenerate(row)`. On success → `done` (fixture already written to disk by runGenerate).
- On failure: classify with the existing `AUTH_RE` (lift it out of `generate-controls.tsx` into
  `lib/generate.ts` so both client and server share it).
  - **auth** → emit `aborted{reason:"auth"}`, cancel the pool, stop.
  - **rate-limit** (regex on stderr) → sleep backoff, requeue the slug once.
  - **other** → emit `failed{error}`, continue.
- Respect an `AbortSignal` (client disconnect) → stop pulling new slugs, let in-flight finish or bail.

### 2. Streaming Route Handler (`app/api/generate/route.ts`, new)
- `POST` body `{ slugs: string[], concurrency?: number }`.
- Reads rows via `readRows()`, maps slugs → rows, resolves `isAlreadyGenerated` from the raw/done dirs.
- Returns a `ReadableStream` of **SSE** (`text/event-stream`), one `data: <json GenEvent>\n\n` per event.
- `request.signal` → the runner's `AbortSignal` (abort on disconnect).
- Stamps `generatedAt` in the tracker per completed row (same as `generateRow` does today).

### 3. Client wiring
- **`components/app-shell.tsx`** — owns `genStatus: Map<slug, "queued"|"running"|"done"|"failed"|"skipped">`
  and a `batch` summary object. Single-row `onGenerate` adds the slug to the map (→ spinner), calls the
  Server Action, updates on resolve. `router.refresh()` once when a batch/last row finishes.
- **`components/batch-panel.tsx`** (new) — overall progress bar, `done/failed/skipped/total`, concurrency
  knob input, Start/Stop, and the failure list with a "Retry failed" button (re-selects those slugs).
  Consumes the SSE stream via `fetch` + `ReadableStream` reader.
- **`components/rows-table.tsx`** — (a) new checkbox selection column (TanStack `enableRowSelection`);
  (b) render the per-row live pill from `genStatus[slug]`, falling back to the existing
  `ContentBadge`/`Invalid` when idle; (c) selection state lifts to the shell so the batch button can read it.
- **`components/generate-controls.tsx`** — **removed** (replaced by batch-panel + SSE). Its `AUTH_RE`
  moves to `lib/generate.ts`.

## Verification
1. `lib/__tests__/batch.test.ts` — unit-test `runBatch` against a **fake `runGenerate`**: asserts
   concurrency cap (never > N in flight), skip-existing, continue-on-failure, abort-on-auth (stops early),
   and the emitted event sequence + final summary. No real `claude` spawned.
2. `npm run build` green (types + lint).
3. `npx vitest run` — existing 30 + new batch tests pass.
4. Manual: single-row Generate shows a spinner on that row; a small batch lights rows up live and the
   panel counts advance; logging `claude` out mid-run surfaces the auth-abort; re-running skips the
   already-generated.

## Out of scope
- Reconnecting to a running job after reload (resume via skip-existing instead).
- Persisting batch history (the panel clears on reload; disk fixtures are the record).
- Any change to the fixture shape, prompt, or approve/move flow.
