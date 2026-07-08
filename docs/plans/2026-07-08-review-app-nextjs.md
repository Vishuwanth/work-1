# CancerFax Review App (Next.js) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js app that lists all Excel content rows, shows each row's generated FAQ in a detail drawer, tracks review status, generates FAQs via headless Claude Code, and moves approved fixtures from `raw/` to `done/`.

**Architecture:** Next.js 14 App Router + TypeScript. Server Actions do all disk I/O (read `.xlsx`, list/read/move fixtures, read/write `tracker.json`, spawn `claude -p`). A pure `lib/` layer (unit-tested with vitest) holds Excel reading, slug/fixture helpers, tracker, and derived row state. UI = a Bento command-center overview + a shadcn/TanStack data table + a shadcn Sheet detail drawer with an inline editor. No database, no Anthropic API.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, @tanstack/react-table, @tanstack/react-virtual, SheetJS (`xlsx`) for reading the workbook, lucide-react icons, `next/font` (Fira Sans + Fira Code), vitest for unit tests. Generation via `child_process` spawning the `claude` CLI.

## Global Constraints

- **Node/Next:** Next.js 14 App Router, React Server Components; Node ≥ 18 (present: v24).
- **No Anthropic API / no API key.** Generation only via `claude -p` (Max login) or out-of-band Claude Code batches.
- **Excel is read-only.** Never write to `CancerFax_Content_Architecture_1.xlsx`.
- **Source Excel path (after reorg):** `docs/source/CancerFax_Content_Architecture_1.xlsx`, sheet `All 300 Pages` (header row 2; columns `# | Pillar # | Pillar Name | Support Page # | Support Page Title | Status | Writer | Assigned To | Target Publish Date | Content Type`).
- **Fixture wrapper shape:** `{ pillar, contentType, runner, slug, route, section|sectionToMerge:{type:"faq",id,h2,intro,groups[]}, schemaRecommendation, medicalDisclaimer }`; each answer `a` is `<p>…</p>`; `slug`/`route` may carry a leading `⚠ VERIFY:`.
- **Folders:** generated → `output/faq/raw/`, approved → `output/faq/done/`, tracker → `output/faq/tracker.json`.
- **Design system:** read `design-system/cancerfax-review/MASTER.md` + `pages/review-dashboard.md`. Palette primary `#1E40AF`, secondary `#3B82F6`, accent/amber `#D97706`, success green, destructive `#DC2626`, light bg `#F8FAFC` + full dark tokens. Fonts **Fira Sans** (UI/reading) + **Fira Code** (tabular `#`/counts/slug). Dense 8px rhythm, subtle 200–300ms motion, light + dark, WCAG AA (badges never color-only).
- **Commits:** conventional-commit messages ending with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; commit at the end of every task.

## Adaptation note (read first)

This is a UI-heavy app, not a pure-logic library. Therefore:
- **Logic/lib tasks (3–8)** use full vitest TDD with complete code — these must be exact and are cheaply testable.
- **UI tasks (9–13)** specify the exact component contract (props/returns), the key structural code, and a **browser-driven verification** step (load `http://localhost:3000` via `claude-in-chrome`, interact, screenshot) instead of unit tests. Build them with the `shadcn-ui`, `frontend-design`, and `ui-ux-pro-max` skills loaded; the design system file is the source of truth for styling.
- No pytest anywhere; test runner is **vitest** (`npx vitest run <file>`).

## File structure

```
app/layout.tsx            # fonts, <html> theme class, globals
app/globals.css           # Tailwind + design tokens (light/dark CSS vars)
app/page.tsx              # server component: loads rows+overview, renders client shell
app/actions.ts            # 'use server' actions (the only disk-I/O surface for the client)
lib/slug.ts               # slugify (mirrors faq_write.py)
lib/fixtures.ts           # fixture helpers: cleanSlug, getSection, faqCount, verifyFlags, isFaqShape, applyEdits, load/list
lib/excel.ts              # readRows(): Row[] from the workbook
lib/tracker.ts            # readTracker/writeTracker, ReviewRecord, recordFor
lib/state.ts              # deriveRowViews(rows, rawSlugs, doneSlugs, tracker) → RowView[]; overviewStats(RowView[])
lib/generate.ts           # buildPrompt(row), runGenerate(row) spawning `claude -p`
lib/types.ts              # shared types: Row, Fixture, RowView, ReviewRecord, Toggles, OverviewStats
components/ui/*            # shadcn primitives (button, badge, sheet, input, textarea, switch, table…)
components/bento-overview.tsx
components/rows-table.tsx
components/faq-detail-drawer.tsx
components/generate-controls.tsx
components/app-shell.tsx  # client component wiring table+drawer+overview+actions
lib/__tests__/*.test.ts   # vitest unit tests
```

---

### Task 1: Folder reorganization + git baseline

**Files:**
- Move (git mv): `reference/ → docs/reference/`; `faq-generation-prompt.md → docs/prompts/faq-generation-prompt.md`; `car-t-cell-therapy-solid-tumors-faq-section.json → docs/reference/`; `CancerFax_Content_Architecture_1.xlsx → docs/source/`; `generate_faq.py`, `faq_write.py → scripts/`; `faq-review-dashboard.html → artifacts/`; `docs/superpowers/{specs,plans} → docs/{specs,plans}`.
- Move existing fixtures: `output/faq/*.json → output/faq/raw/` (create `raw/`, `done/`).
- Delete: `PLAN_faq_generator.md`.
- Modify: `scripts/generate_faq.py`, `scripts/faq_write.py` — update `DEFAULT_XLSX`/`DEFAULT_OUT` paths to the new locations (`docs/source/…xlsx`, `output/faq/raw`).

**Interfaces:**
- Produces: the on-disk layout every later task's paths assume (Global Constraints).

- [ ] **Step 1:** Create dirs: `mkdir -p docs/source docs/prompts docs/reference output/faq/raw output/faq/done scripts artifacts`.
- [ ] **Step 2:** `git mv` each file per the list above; move the two existing `output/faq/*.json` into `output/faq/raw/`; `git rm PLAN_faq_generator.md`.
- [ ] **Step 3:** In `scripts/generate_faq.py` set `DEFAULT_XLSX = HERE.parent / "docs/source/CancerFax_Content_Architecture_1.xlsx"` and `DEFAULT_OUT = HERE.parent / "output/faq/raw"`; in `scripts/faq_write.py` update its `--out` default import accordingly. Update `PROMPT_PATH` to `HERE.parent / "docs/prompts/faq-generation-prompt.md"`.
- [ ] **Step 4: Verify:** `python3 scripts/generate_faq.py --status Pending --limit 2 --dry-run` prints the 2 rows (confirms it finds the moved Excel). `ls output/faq/raw` shows the 2 fixtures.
- [ ] **Step 5: Commit:** `git add -A && git commit -m "chore: reorganize folders for the review app\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`.

---

### Task 2: Scaffold Next.js + Tailwind + shadcn + fonts + tokens

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx` (placeholder), `vitest.config.ts`, `.eslintrc`.

**Interfaces:**
- Produces: a running dev server at `http://localhost:3000`; the `@/` path alias → repo root; Tailwind design tokens as CSS vars; `npx vitest` runnable.

- [ ] **Step 1:** `npx create-next-app@14 . --ts --tailwind --app --eslint --src-dir=false --import-alias "@/*" --no-git` (repo already has git). Accept prompts for App Router.
- [ ] **Step 2:** Add deps: `npm i @tanstack/react-table @tanstack/react-virtual xlsx lucide-react && npm i -D vitest @vitejs/plugin-react vite-tsconfig-paths`.
- [ ] **Step 3:** `npx shadcn@latest init` (choose defaults; New York style, CSS variables yes). Then add primitives used later: `npx shadcn@latest add button badge sheet input textarea switch table sonner tooltip select`.
- [ ] **Step 4:** Configure fonts in `app/layout.tsx` with `next/font/google`:
```tsx
import { Fira_Sans, Fira_Code } from "next/font/google";
const sans = Fira_Sans({ subsets:["latin"], weight:["300","400","500","600","700"], variable:"--font-sans" });
const mono = Fira_Code({ subsets:["latin"], weight:["400","500","600"], variable:"--font-mono" });
// <html className={`${sans.variable} ${mono.variable}`}> ; body uses font-sans
```
- [ ] **Step 5:** In `app/globals.css`, set the shadcn CSS-variable palette from the design system (light `:root` + `.dark`): map `--primary` to `221 83% 40%` (#1E40AF), `--accent`/warning to amber `#D97706`, `--destructive` `#DC2626`, `--background` light `#F8FAFC`, plus dark tokens from `design-system/cancerfax-review/MASTER.md`. Add `--font-mono` usage utility for tabular columns (`.tabular { font-family:var(--font-mono); font-variant-numeric:tabular-nums }`).
- [ ] **Step 6:** `vitest.config.ts` uses `vite-tsconfig-paths` so `@/lib/*` resolves in tests.
- [ ] **Step 7: Verify:** `npm run dev` → open `http://localhost:3000` in Chrome (claude-in-chrome), screenshot: default page renders with Fira font and the light background token. `npx vitest run` exits 0 (no tests yet).
- [ ] **Step 8: Commit:** `feat: scaffold Next.js app with Tailwind, shadcn, Fira fonts, design tokens`.

---

### Task 3: `lib/types.ts` + `lib/slug.ts`

**Files:**
- Create: `lib/types.ts`, `lib/slug.ts`, `lib/__tests__/slug.test.ts`

**Interfaces:**
- Produces: `slugify(title: string): string` (mirrors `scripts/faq_write.py` `slugify`: NFKD ASCII, lowercase, non-alnum → `-`, collapse/trim `-`). Types: `Row`, `Fixture`, `FaqSection`, `RowView`, `ReviewRecord`, `Toggles`, `OverviewStats`, `ContentState = "not-generated"|"raw"|"done"`, `ReviewStatus = "pending"|"approved"|"needs-work"`.

- [ ] **Step 1: Write failing test** `lib/__tests__/slug.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { slugify } from "@/lib/slug";
describe("slugify", () => {
  it("matches the Python slugify output", () => {
    expect(slugify("What is the difference between leukemia, lymphoma, and myeloma?"))
      .toBe("what-is-the-difference-between-leukemia-lymphoma-and-myeloma");
    expect(slugify("AML treatment guide: induction, consolidation, and when is transplant needed?"))
      .toBe("aml-treatment-guide-induction-consolidation-and-when-is-transplant-needed");
    expect(slugify("  Héllo — World  ")).toBe("hello-world");
  });
});
```
- [ ] **Step 2: Run** `npx vitest run lib/__tests__/slug.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `lib/slug.ts`:
```ts
export function slugify(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}
```
Add the type declarations in `lib/types.ts` (see Interfaces).
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit** `feat(lib): slugify + shared types`.

---

### Task 4: `lib/fixtures.ts` (fixture helpers + applyEdits)

**Files:**
- Create: `lib/fixtures.ts`, `lib/__tests__/fixtures.test.ts`

**Interfaces:**
- Consumes: types from `lib/types.ts`.
- Produces: `cleanSlug(raw): {value,needsVerify}`, `getSection(fx): FaqSection|null`, `sectionKey(fx): "section"|"sectionToMerge"`, `faqCount(fx): number`, `verifyFlags(fx): number`, `isFaqShape(fx): boolean`, `ensureP(html): string`, `applyEdits(fx, rec: ReviewRecord): Fixture` (deep clone; apply answer edits via `ensureP`, replace slug/route with resolved values). Pure functions, no fs.

- [ ] **Step 1: Write failing test** using a small inline fixture: assert `faqCount` = number of items, `verifyFlags` counts `⚠ VERIFY:` in slug+route (0/1/2), `isFaqShape` true for `{section:{type:"faq",groups:[]}}`, `applyEdits` wraps a plain-text answer edit in `<p>`, resolves slug (`⚠ VERIFY: x` → `x`), and does not mutate the input.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `lib/fixtures.ts` — port the logic from `scripts/generate_faq.py` (`cleanSlug`, `getSection`, `sectionKey`, `faqCount`, `pageVerifyFlags`, `ensureP`) and the Node `applyEdits` from `faq-review-dashboard.html` into TS, typed against `lib/types.ts`. `VERIFY_RE = /^\s*⚠\s*VERIFY:\s*/`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(lib): fixture helpers and applyEdits`.

---

### Task 5: `lib/excel.ts` (read all rows)

**Files:**
- Create: `lib/excel.ts`, `lib/__tests__/excel.test.ts`

**Interfaces:**
- Consumes: `slugify` (Task 3), `Row` type.
- Produces: `readRows(xlsxPath?: string): Row[]` — reads sheet `All 300 Pages`, header at row 2, returns rows where Support Page Title is non-empty. Each `Row = { rowNum, pillarName, title, excelStatus, contentType, slug }` (slug = slugify(title)).

- [ ] **Step 1: Write failing test** against the real workbook `docs/source/CancerFax_Content_Architecture_1.xlsx`:
```ts
const rows = readRows();
expect(rows.length).toBe(759);
const r = rows.find(x => x.rowNum === 463)!;
expect(r.title).toContain("difference between leukemia");
expect(r.slug).toBe("what-is-the-difference-between-leukemia-lymphoma-and-myeloma");
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with SheetJS: `XLSX.readFile(path)`, `sheet_to_json(ws, { header:1, range: 1 })` (skip title row; row index 1 = header), map columns by position (Pillar Name=col 2, Title=col 4, Status=col 5, Content Type=col 9), filter empty titles, attach `slug`. Default path = `docs/source/CancerFax_Content_Architecture_1.xlsx` resolved from `process.cwd()`.
- [ ] **Step 4: Run** → PASS (759 rows, row 463 correct).
- [ ] **Step 5: Commit** `feat(lib): read content rows from the workbook`.

---

### Task 6: `lib/tracker.ts` (review state persistence)

**Files:**
- Create: `lib/tracker.ts`, `lib/__tests__/tracker.test.ts`

**Interfaces:**
- Produces: `readTracker(dir?): Record<string,ReviewRecord>`, `writeTracker(data, dir?)`, `recordFor(data, slug): ReviewRecord` (returns existing or a default `{reviewStatus:"pending", note:"", edits:{answers:{},slug:"",route:""}}`). Tracker file = `output/faq/tracker.json`.

- [ ] **Step 1: Write failing test** in a temp dir: write a record, read it back, assert round-trip; `recordFor` returns a pending default for an unknown slug; corrupt JSON → `readTracker` returns `{}`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with `node:fs` (read/parse with try/catch → `{}`; write pretty JSON, `mkdir -p` the dir).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(lib): tracker.json read/write`.

---

### Task 7: `lib/state.ts` (derive row views + overview stats)

**Files:**
- Create: `lib/state.ts`, `lib/__tests__/state.test.ts`

**Interfaces:**
- Consumes: `Row`, `Fixture`, `ReviewRecord`, `verifyFlags`, `getSection`, `faqCount`.
- Produces: `deriveRowViews(rows: Row[], rawBySlug: Map<string,Fixture>, doneBySlug: Map<string,Fixture>, tracker): RowView[]` where `RowView = Row & { contentState, reviewStatus, verifyCount, faqCount|null }`; `overviewStats(views): OverviewStats` = counts of generated/approved/needs-work/pending/withVerify + perPillar map.

- [ ] **Step 1: Write failing test:** given 3 rows (one with a raw fixture + tracker pending+2 verify, one with a done fixture approved, one with no fixture), assert `contentState` = raw/done/not-generated, `verifyCount` reflects the fixture (0 once tracker.edits resolves both), and `overviewStats` totals are correct.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** pure functions; `verifyCount` = `verifyFlags(fixture)` minus fields resolved in `tracker[slug].edits` (edited slug/route count as resolved).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(lib): derive row views and overview stats`.

---

### Task 8: `lib/generate.ts` (headless Claude Code generation)

**Files:**
- Create: `lib/generate.ts`, `lib/__tests__/generate.test.ts`

**Interfaces:**
- Consumes: `Row`, `readRows`; the master prompt at `docs/prompts/faq-generation-prompt.md`; the page-type target logic (port `page_targets` from `scripts/generate_faq.py`).
- Produces: `buildPrompt(row: Row): string` (topic + pillar + page-type targets + the master prompt + "return ONLY the section JSON"); `runGenerate(row, opts): Promise<{ok:true,fixturePath}|{ok:false,error}>` — spawns `claude -p <prompt>` via `child_process.execFile`, parses the JSON section from stdout, wraps it with `faq_write` semantics (status-aware `section`/`sectionToMerge`, `⚠ VERIFY` slug/route, schema+disclaimer), validates with `isFaqShape`, writes to `output/faq/raw/<slug>.json`.

- [ ] **Step 1: Write failing test** for the pure parts only (spawning the CLI is not unit-tested): `buildPrompt(row)` includes the title, "18 FAQs" for blank content type, and the master-prompt header; a helper `wrapSection(row, section)` produces the correct wrapper (keys, `⚠ VERIFY:` slug/route, disclaimer) and `parseSectionFromOutput("...preamble...{json}")` extracts the JSON object.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `runGenerate` uses `execFile("claude", ["-p", prompt], {timeout, maxBuffer})`; on non-zero exit or parse failure return `{ok:false,error:stderr}`. Keep the spawn thin; put `buildPrompt`/`wrapSection`/`parseSectionFromOutput`/`pageTargets` as separately-exported pure functions (the tested surface).
- [ ] **Step 4: Run** → PASS (pure functions). Manually smoke `runGenerate` in Task 14's browser verification.
- [ ] **Step 5: Commit** `feat(lib): claude -p generation runner + prompt builder`.

---

### Task 9: `app/actions.ts` (server actions) + `app/page.tsx` data load

**Files:**
- Create: `app/actions.ts`; Modify: `app/page.tsx`
- Test: manual (server actions verified via the UI in Task 14); optionally a vitest for `loadAll()` pure assembly.

**Interfaces:**
- Consumes: all of `lib/*`.
- Produces (all `"use server"`): `loadAll(): {views: RowView[], stats: OverviewStats, toggles: Toggles}`; `getFixture(slug): Fixture|null` (raw first, else done); `saveReview(slug, patch: Partial<ReviewRecord>): void`; `approveRow(slug, autoMove: boolean): void` (set approved, applyEdits, if autoMove move raw→done); `moveToDone(slug): void`; `moveBack(slug): void`; `generateRow(slug): Promise<Result>`; `setToggles(t: Toggles): void` (persist toggles in `output/faq/toggles.json`).

- [ ] **Step 1:** Implement `app/actions.ts` composing lib functions; `loadAll` reads rows + lists `raw/`+`done/` (parse each into maps) + tracker → `deriveRowViews`/`overviewStats`. `approveRow`/`moveToDone` do atomic move: write `applyEdits(fx,rec)` to `done/<slug>.json`, then `unlink raw/<slug>.json`, stamp tracker `reviewedAt`/`movedAt`, `revalidatePath("/")`.
- [ ] **Step 2:** `app/page.tsx` (server component) calls `loadAll()` and renders `<AppShell initial={...} />`.
- [ ] **Step 3: Verify:** temporary — add a server log in `loadAll`; `npm run dev`, load `/`, confirm no server errors and (via a temporary `<pre>{JSON.stringify(stats)}</pre>`) that stats show `generated: 2`. Remove the temp `<pre>`.
- [ ] **Step 4: Commit** `feat(app): server actions + page data load`.

---

### Task 10: `components/bento-overview.tsx`

**Files:**
- Create: `components/bento-overview.tsx`

**Interfaces:**
- Consumes: `OverviewStats`, `Toggles`, `setToggles` action.
- Produces: `<BentoOverview stats toggles onToggle />` — responsive grid (4→2→1) of rounded-2xl cards: Generated (`n/759`), Approved, ⚠ VERIFY to resolve, weekly throughput (small bar chart — follow the `dataviz` skill for the mark/colors), By-pillar breakdown, and two toggle tiles (Auto-generate, Auto-move on approve) using shadcn `Switch`.

- [ ] **Step 1:** Build the component per the design system (rounded-2xl, soft shadow, Fira Code tabular numbers, amber accent for the VERIFY tile). Toggle tiles call `onToggle`.
- [ ] **Step 2: Verify (browser):** render on `/` (wire temporarily), screenshot: tiles show correct numbers, toggles flip and persist (reload keeps state via `toggles.json`), responsive at 1440/768/375.
- [ ] **Step 3: Commit** `feat(ui): bento command-center overview`.

---

### Task 11: `components/rows-table.tsx`

**Files:**
- Create: `components/rows-table.tsx`

**Interfaces:**
- Consumes: `RowView[]`; callbacks `onOpen(slug)`, `onGenerate(slug)`.
- Produces: `<RowsTable views onOpen onGenerate />` — TanStack Table + shadcn `Table`, **virtualized** (`@tanstack/react-virtual`) for 759 rows. Columns: `# (mono) · Title · Pillar · Type · Excel (muted) · Content badge · Review badge · Action`. Global search (title/pillar), filter selects (pillar, content-state, review-state), sortable headers with `aria-sort`. Status badges are glyph+label (`● Raw` / `● Done` / `✓ Approved` / `Needs work` / `⚠ n`), colors from tokens, never color-only.

- [ ] **Step 1:** Implement column defs + virtualization + filters/search. Row click (or "Review →") → `onOpen(slug)`; "Generate" on not-generated rows → `onGenerate(slug)`.
- [ ] **Step 2: Verify (browser):** table shows all 759 rows (scroll perf ok), the 2 raw rows show `● Raw` + correct verify badge; search/filter/sort work; keyboard nav + focus rings present. Screenshot.
- [ ] **Step 3: Commit** `feat(ui): virtualized rows data table`.

---

### Task 12: `components/faq-detail-drawer.tsx` (viewer + editor)

**Files:**
- Create: `components/faq-detail-drawer.tsx`

**Interfaces:**
- Consumes: `getFixture`, `saveReview`, `approveRow`, `moveToDone` actions; `ReviewRecord`.
- Produces: `<FaqDetailDrawer slug open onOpenChange toggles onChanged />` — shadcn `Sheet` (right, focus-trapped, scrim). Loads the fixture via `getFixture(slug)`; renders group headings (blue), bold `q`, `a` via `dangerouslySetInnerHTML` (trusted fixture HTML); amber `⚠ VERIFY` slug/route chips (cleaned value). **Edit toggle** swaps answers→`Textarea` and slug/route→`Input`, writing to a local edit buffer saved via `saveReview(slug,{edits})`. Sticky footer: **Approve** (→ `approveRow(slug, toggles.autoMove)`), **Move to done** (shown when approved & auto-move off), **Needs work**, **Copy corrected JSON** (`applyEdits` client-side or via action → clipboard), reviewer note (`saveReview`). Calls `onChanged()` after mutations to refresh table/overview.

- [ ] **Step 1:** Implement the Sheet, viewer, editor buffer, and footer actions.
- [ ] **Step 2: Verify (browser):** open row 463 → 18 FAQs/5 groups render with `<p>` answers + 2 amber VERIFY chips; edit an answer + resolve the slug → Copy yields valid corrected JSON (no `⚠`); Needs-work sets the badge; Approve with auto-move on triggers Task-9 move. Screenshot.
- [ ] **Step 3: Commit** `feat(ui): FAQ detail drawer with inline editor`.

---

### Task 13: `components/app-shell.tsx` + `components/generate-controls.tsx` (assembly + generation UI)

**Files:**
- Create: `components/app-shell.tsx`, `components/generate-controls.tsx`; Modify: `app/page.tsx`

**Interfaces:**
- Consumes: all components + actions.
- Produces: `<AppShell initial={{views,stats,toggles}} />` (client) holding selected-slug + drawer state, wiring `BentoOverview`, `RowsTable`, `FaqDetailDrawer`; refreshes via `router.refresh()` after `onChanged`. `generate-controls`: per-row generate calls `generateRow(slug)` with a pending spinner + `sonner` toast on success/error; the **Auto-generate** toggle runs a throttled client queue over `not-generated` rows (one at a time, pausable) calling `generateRow`, respecting failures (stop on auth error with a toast).

- [ ] **Step 1:** Implement `AppShell` (state + wiring) and `generate-controls` (single + queued generation with toasts). Point `app/page.tsx` at `AppShell`.
- [ ] **Step 2: Verify (browser):** full page renders (overview + table + drawer); click Generate on an ungenerated row → `claude -p` runs, new fixture appears in `raw/`, row flips to Raw/Pending (or, if `claude` not logged in, a clear error toast). Auto-generate on a 2-row filtered set generates both then stops; pause works. Screenshot.
- [ ] **Step 3: Commit** `feat(ui): app shell assembly + generation controls`.

---

### Task 14: End-to-end verification + error/empty states + README

**Files:**
- Create: `README.md`; Modify: components for empty/error/loading states as needed.

- [ ] **Step 1:** Add empty states (no filter matches; nothing generated), loading skeletons for the drawer, and error surfaces (missing Excel path message; invalid fixture badge; generate auth-error toast text "run `claude` once to log in").
- [ ] **Step 2:** `README.md`: prerequisites (Node, `claude` logged in via Max), `npm install`, `npm run dev`, the folder model (raw/done/tracker), and the two generation paths.
- [ ] **Step 3: Full run-through in Chrome** (spec verification plan §1–7): 759 rows listed; 2 raw fixtures with VERIFY; edit+resolve+Copy valid; approve+auto-move raw→done and persists on reload; needs-work stays in raw; Generate runs `claude -p`; auto-generate queue + pause; Bento tiles/throughput/pillars correct; light+dark both legible. Screenshot each key state.
- [ ] **Step 4:** `npx vitest run` → all unit tests pass; `npm run build` → succeeds (types clean).
- [ ] **Step 5: Commit** `feat: empty/error states, README, end-to-end verification`.

---

## Self-review

**Spec coverage:** table of all rows (T11), click→generated FAQ drawer (T12), tracker (T6), approve→move raw/done with manual+auto (T9 actions + T12/T10 toggles), inline edit answers+slug/route (T12), generation both in-app `claude -p` (T8/T13) + Claude Code batches (out-of-band; app reflects `raw/` on refresh via T9 `loadAll`), Bento command-center (T10), folder reorg (T1), Excel read-only (T5 reads only), design system (T2 tokens + all UI tasks), verification (T14). All spec sections map to a task.

**Placeholder scan:** logic tasks (3–8) carry complete code + concrete vitest assertions; UI tasks carry exact component contracts + key structural code + browser verification (deliberate, per the adaptation note) rather than full JSX duplication. No "TBD/handle edge cases" left; error/empty states are their own task (T14).

**Type consistency:** `slugify`, `cleanSlug/getSection/faqCount/verifyFlags/isFaqShape/ensureP/applyEdits`, `readRows→Row`, `readTracker/recordFor→ReviewRecord`, `deriveRowViews→RowView`/`overviewStats→OverviewStats`, and the `app/actions.ts` names (`loadAll/getFixture/saveReview/approveRow/moveToDone/moveBack/generateRow/setToggles`) are used consistently across the tasks that consume them (Interfaces blocks).
