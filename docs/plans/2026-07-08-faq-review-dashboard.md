# FAQ Review Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single self-contained HTML Artifact that lets CancerFax reviewers QA generated FAQ fixtures — view, resolve `⚠ VERIFY` fields, approve/needs-work, inline-edit, track batch progress, and export decisions + corrected JSON.

**Architecture:** One HTML file (inline CSS/JS, no external resources — Artifact CSP forbids them). Master–detail layout. In-memory data layer fed by baked-in fixtures + in-browser file-drop; per-page review state persisted to `localStorage`; outputs via file download (aggregate) and clipboard (per page). Built incrementally as module sections of the one file.

**Tech Stack:** Vanilla HTML/CSS/JS (no framework, no build step). Browser `localStorage`, File API (drag/drop + picker), Clipboard API, Blob download. Published via the Artifact tool. Built with the `artifact-design` and `frontend-design` skills loaded.

---

## Deviations from the standard template (read first)

- **No pytest / unit tests.** The deliverable is a browser Artifact. Each task's verification is
  driven in a real browser via the `claude-in-chrome` MCP tools (load the file, interact, screenshot)
  against the spec's verification plan. "Expected" describes the observed browser behavior.
- **No git commits per step.** This folder is not a git repo. Commits are omitted. (Optional: run
  `git init` in `work-1` first if version control is wanted; if so, add a commit step after each task.)
- **One file, built in sections.** Every task edits the same file
  `/Users/vishupersonalmac/sai-sree-work/work-1/faq-review-dashboard.html`. Tasks are ordered so each
  leaves the file in a loadable, demonstrable state. Data contracts (Task 1) are fixed first because
  everything depends on them.
- **Publish at the end.** The file is developed and verified locally (opened as a `file://` URL in
  Chrome), then published with the Artifact tool in the final task. Load `artifact-design` before the
  first write and `frontend-design` for the UI tasks.

## File structure

- `faq-review-dashboard.html` — the entire deliverable. Internal sections (in `<script>`), in build order:
  `CONTRACTS` (data shapes + helpers) → `STATE` (localStorage review-state) → `DATA` (load/merge baked + dropped) → `RENDER_SIDEBAR` → `RENDER_DETAIL` → `EDITOR` → `EXPORT` → `BOOT` (wire up, empty/error states). CSS in one `<style>`; markup is a static shell that JS populates.
- Baked-in fixtures are embedded as a JS constant `BAKED = [ ... ]` (the current `output/faq/*.json` contents), replaced/appended at publish time.
- Reference mockup (approved layout): `.superpowers/brainstorm/85436-1783525865/content/layout-a-full.html`.
- Spec: `docs/superpowers/specs/2026-07-08-faq-review-dashboard-design.md`.

---

### Task 1: Data contracts + pure helpers

**Files:**
- Create: `/Users/vishupersonalmac/sai-sree-work/work-1/faq-review-dashboard.html`

Establish the exact shapes and pure functions everything else uses. No UI yet — this task produces a
page that loads and, in the browser console, exposes working helpers.

- [ ] **Step 1: Create the file skeleton** with `<!doctype html>`, a `<style>` (empty for now), a
  `<body>` containing `<div id="app"></div>`, and a `<script>` holding the `CONTRACTS` section below.

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CancerFax FAQ Review</title>
<style>/* CSS added in Task 2 */</style>
</head><body>
<div id="app"></div>
<script>
/* ===== CONTRACTS ===== */
// A "page" is one fixture wrapper as written by faq_write.py:
//   { pillar, contentType, runner, slug, route, section|sectionToMerge:{type,id,h2,intro,groups[]},
//     schemaRecommendation, medicalDisclaimer }
const VERIFY_RE = /^\s*⚠\s*VERIFY:\s*/;

function cleanSlug(raw) {            // strip "⚠ VERIFY:" prefix; return {value, needsVerify}
  const s = String(raw ?? "");
  return { value: s.replace(VERIFY_RE, "").trim(), needsVerify: VERIFY_RE.test(s) };
}
function getSection(page) {           // returns the faq section regardless of key
  return page.section || page.sectionToMerge || null;
}
function sectionKey(page) {           // which key held it (preserved on output)
  return page.sectionToMerge ? "sectionToMerge" : "section";
}
function faqCount(page) {
  const s = getSection(page); if (!s) return 0;
  return (s.groups || []).reduce((n, g) => n + (g.items || []).length, 0);
}
function isFaqShape(page) {
  const s = getSection(page);
  return !!(s && s.type === "faq" && Array.isArray(s.groups));
}
function pageVerifyFlags(page) {      // count of ⚠ VERIFY fields (slug + route)
  return [page.slug, page.route].filter(v => VERIFY_RE.test(String(v ?? ""))).length;
}
function ensureP(html) {              // guarantee an answer stays <p>-wrapped for output
  const t = String(html ?? "").trim();
  return /^<p>[\s\S]*<\/p>$/.test(t) ? t : `<p>${t.replace(/^<p>|<\/p>$/g, "")}</p>`;
}
window.__contracts = { cleanSlug, getSection, sectionKey, faqCount, isFaqShape, pageVerifyFlags, ensureP };
</script>
</body></html>
```

- [ ] **Step 2: Verify in browser.** Open the file in Chrome (`file://…/faq-review-dashboard.html`)
  via `claude-in-chrome` navigate. In the console run:
  `__contracts.cleanSlug("⚠ VERIFY: abc")` → `{value:"abc", needsVerify:true}`;
  `__contracts.ensureP("hello")` → `"<p>hello</p>"`;
  `__contracts.faqCount({section:{type:"faq",groups:[{items:[{},{}]}]}})` → `2`.
  Expected: each returns the value shown, no errors.

---

### Task 2: Theme + master–detail shell

**Files:**
- Modify: `faq-review-dashboard.html` (the `<style>` and `<body>` shell)

Recreate the approved Layout-A shell (top bar, sidebar, main) as static markup + CSS. Reuse the CSS
from the reference mockup `layout-a-full.html` as the starting point (same variables and classes:
`.header/.progress/.pbar/.chip.c-*/.li/.grp/.qa/.verify/.btn`). No data yet — hard-coded placeholder
regions that JS will fill in later.

- [ ] **Step 1: Add the CSS** — copy the `:root` variables and component classes from
  `.superpowers/brainstorm/85436-1783525865/content/layout-a-full.html` into the `<style>`. Load the
  `frontend-design` skill and apply its polish (spacing, type scale, hover/active states) so it reads
  as production UI, not a wireframe.
- [ ] **Step 2: Add the shell markup** inside `#app`: `<header>` (brand + `#progress` + `#dropBtn` +
  `#exportBtn`), `<div class="layout">` with `<aside>` (`#search`, `#filters`, `#list`) and `<main id="detail">`.
- [ ] **Step 3: Verify in browser.** Reload; screenshot. Expected: the two-pane shell renders matching
  the approved mockup (top bar, empty sidebar, empty main), responsive, no console errors.

---

### Task 3: STATE — review-state + localStorage

**Files:**
- Modify: `faq-review-dashboard.html` (add `STATE` script section)

- [ ] **Step 1: Implement the store** keyed by clean slug. Schema exactly:

```js
/* ===== STATE ===== */
const LS_KEY = "cancerfax-faq-review:v1";
let REVIEW = {};                       // { "<slug>": { status, note, edits:{answers:{}, slug, route} } }
function loadReview() {
  try { REVIEW = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
  catch { REVIEW = {}; }
}
function saveReview() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(REVIEW)); return true; }
  catch { return false; }             // quota/unavailable -> caller warns, keeps in-memory REVIEW
}
function reviewFor(slug) {             // default record for an untouched page
  return REVIEW[slug] || (REVIEW[slug] = { status: "pending", note: "", edits: { answers: {}, slug: "", route: "" } });
}
```

- [ ] **Step 2: Verify in browser.** Console: `loadReview(); reviewFor("x").status = "approved"; saveReview();`
  then reload the page and run `loadReview(); REVIEW.x.status`. Expected: `"approved"` (persisted). Then
  `localStorage.removeItem(LS_KEY)` to reset.

---

### Task 4: DATA — load + merge baked + dropped fixtures

**Files:**
- Modify: `faq-review-dashboard.html` (add `DATA` script section)

- [ ] **Step 1: Implement the data layer**, keyed by clean slug; newest add wins:

```js
/* ===== DATA ===== */
const BAKED = [];                      // replaced at publish time with output/faq/*.json contents
let PAGES = {};                        // { "<cleanSlug>": pageObject }
const loadErrors = [];                 // [{name, reason}]
function addPage(page, sourceName) {
  if (!page || !isFaqShape(page)) { loadErrors.push({ name: sourceName, reason: "not a FAQ fixture" }); return false; }
  const key = cleanSlug(page.slug).value || (getSection(page).h2 || sourceName);
  PAGES[key] = page; return true;
}
function loadBaked() { BAKED.forEach((p, i) => addPage(p, `baked[${i}]`)); }
async function ingestFiles(fileList) {
  for (const f of fileList) {
    try { addPage(JSON.parse(await f.text()), f.name); }
    catch { loadErrors.push({ name: f.name, reason: "invalid JSON" }); }
  }
  renderAll();                         // defined in later tasks
}
```

- [ ] **Step 2: Verify in browser.** Console: `addPage({slug:"⚠ VERIFY: t", section:{type:"faq",groups:[{items:[{q:"a",a:"<p>b</p>"}]}]}}, "t"); Object.keys(PAGES)` → `["t"]`; `addPage({slug:"x"}, "bad"); loadErrors` → contains `{name:"bad", reason:"not a FAQ fixture"}`. Expected: as shown.

---

### Task 5: RENDER_SIDEBAR — list, filters, search

**Files:**
- Modify: `faq-review-dashboard.html` (add `RENDER_SIDEBAR` section)

- [ ] **Step 1: Implement** `renderSidebar()` that builds rows from `PAGES ⨝ REVIEW`. Each row: title
  (`getSection(page).h2`), sub-line (`page.pillar · faqCount(page) FAQs`), and a status chip — `⚠ <n>`
  (amber) when `pageVerifyFlags(page)>0` and page is still pending, else the `status` chip
  (`pending/approved/needs-work`). Clicking a row sets `SELECTED = key` and calls `renderDetail()`.
  Filter pills (`All / Pending / ⚠ VERIFY / Needs work / Approved`) and the search box filter the list;
  counts on each pill reflect current data. Track `let SELECTED = null; let FILTER = "all"; let QUERY = "";`.

```js
/* ===== RENDER_SIDEBAR ===== */
function matchesFilter(key) {
  const p = PAGES[key], r = reviewFor(key);
  if (QUERY && !getSection(p).h2.toLowerCase().includes(QUERY.toLowerCase())) return false;
  switch (FILTER) {
    case "pending": return r.status === "pending";
    case "approved": return r.status === "approved";
    case "needs-work": return r.status === "needs-work";
    case "verify": return pageVerifyFlags(p) > 0;
    default: return true;
  }
}
// renderSidebar(): clear #list, for each key in Object.keys(PAGES).filter(matchesFilter) append a row;
// wire pills to set FILTER + renderSidebar(); wire #search input to set QUERY + renderSidebar().
```

- [ ] **Step 2: Verify in browser.** Load baked test data (or drop the two real fixtures), screenshot.
  Expected: sidebar lists the pages with correct chips; clicking a pill filters; typing in search filters;
  pill counts correct.

---

### Task 6: RENDER_DETAIL — render selected page + VERIFY

**Files:**
- Modify: `faq-review-dashboard.html` (add `RENDER_DETAIL` section)

- [ ] **Step 1: Implement** `renderDetail()` for `PAGES[SELECTED]`: header (h2, `pillar · contentType ·
  faqCount FAQs / groups.length groups`); amber `⚠ VERIFY` chips for slug and route when flagged
  (show the cleaned value); each group as a blue `.grp` heading followed by `.qa` blocks (`q` bold, `a`
  inserted as HTML via a `<div class="a">` — answers are trusted fixture HTML `<p>…</p>`). Bottom action
  bar placeholders for Approve / Needs-work / Edit / Copy / note (wired in Tasks 7–8). Empty selection →
  "Select a page to review."

- [ ] **Step 2: Verify in browser.** Select the leukemia fixture; screenshot. Expected: all 18 FAQs
  across 5 groups render with `<p>` answers; both VERIFY chips show in amber; metadata correct.

---

### Task 7: Review actions + EDITOR + progress board

**Files:**
- Modify: `faq-review-dashboard.html` (add review wiring, `EDITOR` section, `#progress` render)

- [ ] **Step 1: Wire Approve / Needs-work / note** — set `reviewFor(SELECTED).status` / `.note`, call
  `saveReview()` (if it returns false, show a one-time "decisions won't persist" banner), then
  `renderSidebar()` + `renderProgress()`.
- [ ] **Step 2: Implement `renderProgress()`** — counts over `PAGES` via `REVIEW`: approved / needs-work
  / pending / with-VERIFY; render the segmented bar widths + stat numbers in `#progress`.
- [ ] **Step 3: Implement the editor** — an "Edit" toggle swaps each answer `.a` and the slug/route
  chips into `<textarea>` / `<input>`; on change write to `reviewFor(SELECTED).edits.answers["<gi>.<ii>"]`
  and `.edits.slug` / `.edits.route`; `saveReview()`. Editing overlays — never mutate `PAGES[...]`.
  Provide `applyEdits(page, slug)` returning a deep-cloned corrected fixture:

```js
function applyEdits(page, key) {
  const r = reviewFor(key), out = JSON.parse(JSON.stringify(page));
  const sec = out.sectionToMerge || out.section;
  (sec.groups || []).forEach((g, gi) => (g.items || []).forEach((it, ii) => {
    const e = r.edits.answers[gi + "." + ii]; if (e != null) it.a = ensureP(e);
  }));
  if (r.edits.slug)  out.slug  = r.edits.slug;   // resolved value replaces the ⚠ VERIFY string
  if (r.edits.route) out.route = r.edits.route;
  return out;
}
```

- [ ] **Step 4: Verify in browser.** Approve a page → chip + progress update and survive reload. Toggle
  Edit, change an answer and the slug, then console `applyEdits(PAGES[SELECTED], SELECTED)` → shows edited
  answer and resolved slug (no `⚠ VERIFY:`). Screenshot.

---

### Task 8: EXPORT (aggregate) + Copy (per page)

**Files:**
- Modify: `faq-review-dashboard.html` (add `EXPORT` section; wire `#exportBtn` + per-page Copy)

- [ ] **Step 1: Implement Copy** — per-page button copies `JSON.stringify(applyEdits(page, key), null, 2)`
  to the clipboard via `navigator.clipboard.writeText`; show a transient "Copied" confirmation.
- [ ] **Step 2: Implement Export** — build an array over all `PAGES`:

```js
function buildExport() {
  return Object.keys(PAGES).map(key => {
    const r = reviewFor(key);
    return { slug: key, status: r.status, note: r.note, correctedFixture: applyEdits(PAGES[key], key) };
  });
}
// #exportBtn: create a Blob([JSON.stringify(buildExport(), null, 2)], {type:"application/json"}),
// URL.createObjectURL, a temporary <a download="faq-review-decisions.json"> click, then revoke.
```

- [ ] **Step 3: Verify in browser.** Copy a page → paste elsewhere → valid corrected JSON. Click Export →
  a `faq-review-decisions.json` downloads containing every page with status/note/correctedFixture.
  Verify the downloaded file parses (`python3 -m json.tool`). Expected: valid, complete.

---

### Task 9: BOOT — file-drop wiring, empty + error states

**Files:**
- Modify: `faq-review-dashboard.html` (add `BOOT` section at end of script)

- [ ] **Step 1: Wire drop + picker** — `#dropBtn` opens a hidden `<input type="file" multiple accept=".json">`
  → `ingestFiles`; whole-window `dragover`/`drop` → `ingestFiles(e.dataTransfer.files)`.
- [ ] **Step 2: Empty + error states** — `renderAll()` = `renderSidebar()+renderDetail()+renderProgress()`;
  when `Object.keys(PAGES).length===0`, show the "Drop your `output/faq/*.json` files here" placeholder;
  after each ingest, if `loadErrors` grew, show a non-blocking toast listing skipped files, then clear it.
- [ ] **Step 3: Boot sequence** — `loadReview(); loadBaked(); renderAll();`.
- [ ] **Step 4: Verify in browser.** Fresh load with empty `BAKED` → empty-state placeholder. Drop a
  non-JSON file → toast "couldn't load", board unaffected. Drop the two real fixtures → both appear.
  Screenshot each.

---

### Task 10: End-to-end verification + publish

**Files:**
- Modify: `faq-review-dashboard.html` (embed real `BAKED`)
- Publish: via the Artifact tool

- [ ] **Step 1: Embed real data** — set `BAKED` to the parsed contents of the current
  `output/faq/*.json` files (the two Blood Cancer fixtures). Keep drop-support for anything else.
- [ ] **Step 2: Full run-through in Chrome** (the spec's verification plan): both baked pages render
  (18 FAQs / 5 groups, VERIFY amber); approve one + needs-work-with-note the other → reload → persists;
  edit one answer + one slug → Copy → valid corrected JSON with resolved slug; Export → decisions file
  lists both with corrected fixtures; progress bar reflects the two decisions. Screenshot the key states.
- [ ] **Step 3: Load `artifact-design`**, confirm the page follows Artifact requirements (self-contained,
  theme-aware light/dark, responsive, no external requests, favicon set), fix any gaps.
- [ ] **Step 4: Publish** with the Artifact tool (title "CancerFax FAQ Review", a one-line description,
  a favicon emoji). Record the URL. Re-open the published URL and repeat Step 2's smoke checks in the
  hosted sandbox (confirms nothing depended on `file://`).

---

## Self-review

**Spec coverage:** view/render (T6), VERIFY surfacing (T6), approve/needs-work + note (T7), inline edit
answers+slug/route (T7), batch progress (T7), baked + drop ingestion (T4/T9), export + copy (T8), error/
empty states (T9), localStorage persistence (T3), Artifact-sandbox compliance + publish (T10). All spec
sections map to a task.

**Placeholder scan:** data contracts, state schema, edit/export/copy logic are given as concrete code;
UI-render tasks reference the approved mockup + `frontend-design` skill for exact styling rather than
duplicating hundreds of lines of HTML (deliberate — the mockup is the source of truth and lives in the
repo). No "TBD/handle edge cases/etc." left.

**Type consistency:** `getSection/sectionKey/cleanSlug/faqCount/pageVerifyFlags/isFaqShape/ensureP`
(T1) are reused verbatim in T4–T8; `reviewFor(slug)` shape (T3) matches `applyEdits`/`buildExport` usage
(T7/T8); `renderAll = renderSidebar+renderDetail+renderProgress` names are consistent across T5–T9.
```
