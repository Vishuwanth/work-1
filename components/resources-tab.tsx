"use client";

import * as React from "react";
import {
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { toast } from "sonner";

import { CredentialsPanel } from "@/components/resources-credentials";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  SHARED_HEADER,
  TAXONOMY_HEADER,
  mergeResourceRows,
  tagList,
  toCsv,
  toCsvFromCells,
  toSharedRows,
  toTaxonomyRows,
  type ResourceCheck,
  type ResourceListItem,
  type ResourceTableRow,
  type TaxonomyCategory,
  type TaxonomyTag,
} from "@/lib/resource-reports";

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename: string, text: string) {
  downloadBlob(filename, new Blob([text], { type: "text/csv;charset=utf-8" }));
}

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type StatusFilter = "all" | "checked" | "not-checked" | "needs-review";
type DuplicateFilter = "all" | "yes" | "no";
type WriteFilter = "all" | "applied" | "failed" | "skipped" | "pending" | "never";
const ALL = "__all__";

const WRITE_FILTER_LABELS: { value: WriteFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "applied", label: "Applied" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
  { value: "pending", label: "Classified, not written" },
  { value: "never", label: "Never run" },
];

function matchesWriteFilter(writeStatus: string, filter: WriteFilter): boolean {
  switch (filter) {
    case "applied":
      return writeStatus === "applied";
    case "failed":
      return writeStatus.startsWith("failed");
    case "skipped":
      return writeStatus.startsWith("skipped");
    case "pending":
      return writeStatus === "dry-run";
    case "never":
      return writeStatus === "";
    default:
      return true;
  }
}

/** Colour a write_status by outcome, so a wall of grey badges becomes scannable. */
function writeStatusVariant(writeStatus: string): "success" | "warning" | "secondary" {
  if (writeStatus === "applied") return "success";
  if (writeStatus.startsWith("failed")) return "warning";
  return "secondary";
}

// How often to poll batch progress. A write moves once every 5–10 minutes, so
// this only needs to feel responsive, not be precise.
const POLL_MS = 5_000;

const PAGE_SIZES = [10, 50, 100, 200, 500];

const DEFAULT_GAP_MINUTES = 8;
const MIN_GAP_MINUTES = 0.5;
const MAX_GAP_MINUTES = 60;

/**
 * Measured median time to classify one resource (n=52, from consecutive
 * checkedAt values in a real batch). Classification runs for every selected
 * row before any write, so it dominates a fast batch — leaving it out of the
 * estimate would report fast mode as instant.
 */
const CLASSIFY_MS_PER_RESOURCE = 9_000;
/** Roughly one update + publish round trip, including the pause between them. */
const WRITE_MS_PER_RESOURCE = 3_000;

/** What a batch of `n` will take end to end. `gapMinutes` 0 means fast. */
function estimateBatchMs(n: number, gapMinutes: number): number {
  if (n <= 0) return 0;
  const work = n * (CLASSIFY_MS_PER_RESOURCE + WRITE_MS_PER_RESOURCE);
  return work + Math.max(0, n - 1) * gapMinutes * 60_000;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Progress of the detached batch process — see lib/resources/batch-store.js. */
interface BatchState {
  batchId: string;
  action: "run" | "write";
  status: "running" | "done" | "failed" | "stopped" | "interrupted";
  phase: string;
  slugs: string[];
  current: string; // in flight right now; "" while idle between paced writes
  lastDone: string;
  total: number;
  classified: number;
  writeTotal: number;
  gapMinutes: number;
  gapMode: "fast" | "paced";
  abortedReason: string | null;
  written: number;
  applied: number;
  failed: number;
  rateLimited: number;
  nextWriteAt: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const PHASE_LABEL: Record<string, string> = {
  starting: "Starting…",
  loading: "Loading taxonomy + resources…",
  classifying: "Classifying",
  auditing: "Checking for duplicate content…",
  writing: "Writing to production",
  done: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

/**
 * Live progress of the detached batch. A write can run for hours, so this has
 * to answer "is it still going, how far in, and when does the next write land"
 * without the user watching a spinner.
 */
function BatchProgress({
  batch,
  nowTs,
  stopping,
  onStop,
  onDismiss,
}: {
  batch: BatchState;
  nowTs: number;
  stopping: boolean;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const running = batch.status === "running";
  const writing = batch.phase === "writing";
  const done = writing ? batch.written : batch.classified;
  const total = writing ? batch.writeTotal : batch.total;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const unit = writing ? "written" : "classified";

  const nextWriteMs = batch.nextWriteAt && nowTs ? new Date(batch.nextWriteAt).getTime() - nowTs : null;
  const remainingMs =
    writing && total > done
      ? estimateBatchMs(total - done - 1, batch.gapMinutes ?? 0) + Math.max(nextWriteMs ?? 0, 0)
      : null;

  const tone = running
    ? "border-primary/40 bg-primary/5"
    : batch.status === "done"
      ? "border-success/40 bg-success/10"
      : "border-destructive/40 bg-destructive/10";

  return (
    <div className={`space-y-2 rounded-lg border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium">
          {batch.action === "write" ? "Write" : "Run"} · {PHASE_LABEL[batch.phase] ?? batch.phase}
        </span>
        <Badge variant={running ? "secondary" : batch.status === "done" ? "success" : "warning"}>{batch.status}</Badge>
        {batch.action === "write" && batch.gapMode ? (
          <Badge variant={batch.gapMode === "fast" ? "warning" : "outline"}>
            {batch.gapMode === "fast" ? "fast — no gap" : `paced ~${batch.gapMinutes} min`}
          </Badge>
        ) : null}

        {/* The headline number: how many of how many. This is the question the
            panel exists to answer, so it is large and first, not a footnote. */}
        {total > 0 ? (
          <span className="text-sm font-semibold tabular-nums">
            {done} / {total}{" "}
            <span className="font-normal text-muted-foreground">
              {unit} ({pct}%)
            </span>
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <Button size="sm" variant="outline" onClick={onStop} disabled={stopping}>
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {total > 0 ? (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${done} of ${total} ${unit}`}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}

      {batch.action === "write" ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="text-success-foreground/80">Applied {batch.applied}</span>
          <span className={batch.failed > 0 ? "text-destructive" : "text-muted-foreground"}>
            Failed {batch.failed}
          </span>
          <span className="text-muted-foreground">Rate-limited {batch.rateLimited}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {batch.current ? (
          <span>
            Now: <span className="font-mono text-foreground">{batch.current}</span>
          </span>
        ) : batch.lastDone ? (
          <span>
            Last done: <span className="font-mono">{batch.lastDone}</span>
          </span>
        ) : null}
        {running && nextWriteMs !== null && nextWriteMs > 0 ? (
          <span className="tabular-nums">Next write in {formatDuration(nextWriteMs)}</span>
        ) : null}
        {running && remainingMs !== null ? (
          <span className="tabular-nums">~{formatDuration(remainingMs)} left</span>
        ) : null}
        {running ? <span>Runs in the background — safe to close this tab.</span> : null}
      </div>

      {/* A systemic failure stops the batch early — say so loudly, since the
          counters alone look like a batch that simply finished. */}
      {batch.abortedReason ? (
        <p className="text-xs font-medium text-destructive">
          Stopped after 3 consecutive failures ({batch.abortedReason}). This looks systemic rather than per-resource —
          fix the cause, then re-run the remaining rows.
        </p>
      ) : null}

      {batch.error ? <p className="text-xs text-destructive">{batch.error}</p> : null}
    </div>
  );
}

// ─── Interactive resource list — TanStack table, multi-select, Run/Write, filters ─

function ResourceListPanel() {
  const [list, setList] = React.useState<ResourceListItem[]>([]);
  const [checks, setChecks] = React.useState<Record<string, ResourceCheck>>({});
  const [loadingList, setLoadingList] = React.useState(true);
  const [listError, setListError] = React.useState<string | null>(null);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [duplicateFilter, setDuplicateFilter] = React.useState<DuplicateFilter>("all");
  const [writeFilter, setWriteFilter] = React.useState<WriteFilter>("all");
  const [categoryFilter, setCategoryFilter] = React.useState<string>(ALL);
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [confirmWrite, setConfirmWrite] = React.useState(false);
  const [gapMinutes, setGapMinutes] = React.useState(DEFAULT_GAP_MINUTES);
  const [batch, setBatch] = React.useState<BatchState | null>(null);
  const [starting, setStarting] = React.useState<"run" | "write" | null>(null);
  const [stopping, setStopping] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [nowTs, setNowTs] = React.useState(0); // 0 until the countdown starts ticking

  const loadList = React.useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch("/api/resources/list");
      const data = (await res.json()) as { resources?: ResourceListItem[]; error?: string };
      if (!res.ok || data.error) {
        setListError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setList(data.resources ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadChecks = React.useCallback(async () => {
    try {
      const res = await fetch("/api/resources/checks");
      const data = (await res.json()) as { checks?: Record<string, ResourceCheck> };
      setChecks(data.checks ?? {});
    } catch {
      // Non-fatal — the list still renders, just without prior check state.
    }
  }, []);

  const loadBatch = React.useCallback(async (): Promise<BatchState | null> => {
    try {
      const res = await fetch("/api/resources/batch");
      const data = (await res.json()) as { batch?: BatchState | null };
      const next = data.batch ?? null;
      setBatch(next);
      return next;
    } catch {
      return null; // a failed poll is not worth a toast; the next one will retry
    }
  }, []);

  React.useEffect(() => {
    void loadList();
    void loadChecks();
    // A batch outlives the page — it may already have been running before this
    // tab was opened, or still be running after a reload.
    void loadBatch();
  }, [loadList, loadChecks, loadBatch]);

  const batchRunning = batch?.status === "running";

  // Poll progress, and re-read the persisted results so rows flip to their new
  // category/tags as each one lands rather than only at the end.
  React.useEffect(() => {
    if (!batchRunning) return;
    const id = setInterval(() => {
      void loadBatch();
      void loadChecks();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [batchRunning, loadBatch, loadChecks]);

  // Drives the "next write in …" countdown between paced writes.
  React.useEffect(() => {
    if (!batchRunning) return;
    setNowTs(Date.now());
    const id = setInterval(() => setNowTs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [batchRunning]);

  // Announce the outcome once, on the running → finished transition.
  const prevStatus = React.useRef<string | null>(null);
  React.useEffect(() => {
    const status = batch?.status ?? null;
    if (prevStatus.current === "running" && status && status !== "running") {
      void loadChecks();
      const verb = batch?.action === "write" ? "Write" : "Run";
      if (status === "done") {
        const detail =
          batch?.action === "write"
            ? `applied ${batch.applied}, failed ${batch.failed}, rate-limited ${batch.rateLimited}`
            : `${batch?.classified ?? 0} resource(s) checked`;
        toast.success(`${verb} finished`, { description: detail });
      } else if (status === "failed") {
        toast.error(`${verb} failed`, { description: batch?.error ?? "see data/.batch.log" });
      } else if (status === "stopped") {
        toast(`${verb} stopped`, { description: "Rows already written stay written." });
      } else if (status === "interrupted") {
        toast.error(`${verb} interrupted`, { description: batch?.error ?? "the batch process is gone" });
      }
    }
    prevStatus.current = status;
  }, [batch, loadChecks]);

  const merged = React.useMemo(() => mergeResourceRows(list, checks), [list, checks]);

  const categories = React.useMemo(() => {
    const set = new Set(merged.map((r) => r.category).filter(Boolean));
    return [...set].sort();
  }, [merged]);

  // Which rows belong to the batch in flight, so the table can show each one as
  // running / done / queued rather than leaving the user to guess how far it got.
  const batchSlugs = React.useMemo(
    () => (batchRunning && batch?.slugs ? new Set(batch.slugs) : null),
    [batchRunning, batch?.slugs],
  );

  const rowBatchState = React.useCallback(
    (row: ResourceTableRow): "running" | "done" | "queued" | null => {
      if (!batchSlugs || !batch || !batchSlugs.has(row.slug)) return null;
      if (row.slug === batch.current) return "running";

      // "Done" means done with THIS phase. During a write, classification has
      // already stamped checkedAt on every row, so a timestamp check would mark
      // the whole batch finished before a single write had happened. Once
      // writing starts, only write_status tells the truth — and classify resets
      // every selected row to "dry-run" on its way through.
      if (batch.phase === "writing") return row.writeStatus === "dry-run" ? "queued" : "done";

      // ISO timestamps compare correctly as strings.
      if (row.checkedAt && row.checkedAt >= batch.startedAt) return "done";
      return "queued";
    },
    [batchSlugs, batch],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return merged.filter((r) => {
      if (q && !r.title.toLowerCase().includes(q) && !r.category.toLowerCase().includes(q) && !r.tags.toLowerCase().includes(q)) {
        return false;
      }
      if (statusFilter === "checked" && !r.checked) return false;
      if (statusFilter === "not-checked" && r.checked) return false;
      if (statusFilter === "needs-review" && r.status !== "needs-manual-review") return false;
      if (duplicateFilter === "yes" && !r.hasDuplicate) return false;
      if (duplicateFilter === "no" && r.hasDuplicate) return false;
      if (!matchesWriteFilter(r.writeStatus, writeFilter)) return false;
      if (categoryFilter !== ALL && r.category !== categoryFilter) return false;
      return true;
    });
  }, [merged, query, statusFilter, duplicateFilter, writeFilter, categoryFilter]);

  // Changing a filter can shrink the result set below the current page —
  // always land back on page 1 rather than showing an empty page.
  React.useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [query, statusFilter, duplicateFilter, writeFilter, categoryFilter]);

  const columns = React.useMemo<ColumnDef<ResourceTableRow>[]>(
    () => [
      { accessorKey: "title", header: "Resource" },
      { accessorKey: "category", header: "Category" },
      { accessorKey: "tags", header: "Tags" },
      { accessorKey: "hasDuplicate", header: "Duplicate?" },
      { accessorKey: "duplicateContent", header: "Which content" },
      { accessorKey: "writeStatus", header: "Write status" },
    ],
    [],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    getRowId: (row) => row.slug,
    enableRowSelection: true,
    state: { rowSelection, pagination },
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const rows = table.getRowModel().rows;
  const selectedSlugs = Object.keys(rowSelection).filter((k) => rowSelection[k]);

  const pacedEstimateMs = estimateBatchMs(selectedSlugs.length, gapMinutes);
  const fastEstimateMs = estimateBatchMs(selectedSlugs.length, 0);

  // Starts the batch and returns — it does NOT wait for it. A write paces
  // itself 5–10 minutes per resource, so the work outlives this request, and
  // often the browser tab too. Progress arrives via polling.
  const startBatch = async (action: "run" | "write", pace: "fast" | "paced" = "paced") => {
    if (selectedSlugs.length === 0 || batchRunning) return;
    if (action === "write" && !confirmWrite) return;
    const gap = action === "write" && pace === "fast" ? 0 : gapMinutes;
    setStarting(action);
    try {
      const res = await fetch("/api/resources/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: selectedSlugs, action, confirmWrite, gapMinutes: gap }),
      });
      const data = (await res.json()) as BatchState & { error?: string };
      if (!res.ok || data.error) {
        toast.error(`Could not start the ${action}`, { description: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setBatch(data);
      toast.success(
        action === "run"
          ? `Run started — ${selectedSlugs.length} resource(s)`
          : `${pace === "fast" ? "Fast write" : "Write"} started — ${selectedSlugs.length} resource(s), about ${formatDuration(
              estimateBatchMs(selectedSlugs.length, gap),
            )}`,
        { description: "Runs in the background. You can close this tab." },
      );
    } catch (e) {
      toast.error("Request failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(null);
    }
  };

  // Sends `merged`, NOT `filtered`. The workbook is the full record of every
  // live resource; filters decide what's on screen, never what gets written.
  const updateWorkbook = async () => {
    if (merged.length === 0) return;
    setExporting(true);
    try {
      const res = await fetch("/api/resources/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: merged }),
      });
      // Success responds with the .xlsx bytes; failure responds with JSON.
      if (!res.ok || res.headers.get("Content-Type")?.includes("application/json")) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error("Could not update the workbook", { description: data.error ?? `HTTP ${res.status}` });
        return;
      }

      const blob = await res.blob();
      const filename =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "resources-tagging.xlsx";
      downloadBlob(filename, blob);

      const path = res.headers.get("X-Workbook-Path") ?? "output/resources/resources-tagging.xlsx";
      toast.success(`Workbook updated — ${res.headers.get("X-Workbook-Rows") ?? merged.length} rows`, {
        description: `Saved to ${path} and downloaded as ${filename}`,
      });
    } catch (e) {
      toast.error("Request failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(false);
    }
  };

  const stopBatch = async () => {
    setStopping(true);
    try {
      const res = await fetch("/api/resources/batch", { method: "DELETE" });
      const data = (await res.json()) as { batch?: BatchState; error?: string };
      if (!res.ok || data.error) {
        toast.error("Could not stop the batch", { description: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setBatch(data.batch ?? null);
    } catch (e) {
      toast.error("Request failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <Button
          onClick={() => startBatch("run")}
          disabled={selectedSlugs.length === 0 || batchRunning || starting !== null}
        >
          {starting === "run" ? "Starting…" : `Run (${selectedSlugs.length} selected)`}
        </Button>

        <div className="flex items-center gap-1.5">
          <label htmlFor="gap-minutes" className="text-xs font-medium text-muted-foreground">
            Gap
          </label>
          <Input
            id="gap-minutes"
            type="number"
            min={MIN_GAP_MINUTES}
            max={MAX_GAP_MINUTES}
            step={0.5}
            value={gapMinutes}
            disabled={batchRunning}
            onChange={(e) => {
              const n = Number(e.target.value);
              setGapMinutes(Number.isFinite(n) ? Math.min(MAX_GAP_MINUTES, Math.max(MIN_GAP_MINUTES, n)) : DEFAULT_GAP_MINUTES);
            }}
            className="w-20"
          />
          <span className="text-xs text-muted-foreground">min</span>
        </div>

        <Button
          variant="destructive"
          onClick={() => startBatch("write", "paced")}
          disabled={selectedSlugs.length === 0 || !confirmWrite || batchRunning || starting !== null}
        >
          {starting === "write" ? "Starting…" : `Write paced (${selectedSlugs.length})`}
        </Button>

        {/* Same PRODUCTION checkbox gates both. A second tick beside the first
            just trains people to click through everything without reading. */}
        <Button
          variant="destructive"
          onClick={() => startBatch("write", "fast")}
          disabled={selectedSlugs.length === 0 || !confirmWrite || batchRunning || starting !== null}
        >
          {starting === "write" ? "Starting…" : `Write fast (${selectedSlugs.length})`}
        </Button>

        {/* Selection survives filter changes, so a row selected under an earlier
            filter can be off-screen. Say how many are selected and offer a way
            out, rather than letting the Run count disagree with what's visible. */}
        {selectedSlugs.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setRowSelection({})}>
            Clear selection ({selectedSlugs.length})
          </Button>
        ) : null}

        {selectedSlugs.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            paced ≈ {formatDuration(pacedEstimateMs)} · fast ≈ {formatDuration(fastEstimateMs)}
          </span>
        ) : null}
      </div>

      {batch ? (
        <BatchProgress
          batch={batch}
          nowTs={nowTs}
          stopping={stopping}
          onStop={stopBatch}
          onDismiss={() => setBatch(null)}
        />
      ) : null}

      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <label className="flex items-center gap-2 font-medium">
          <Checkbox checked={confirmWrite} onChange={(e) => setConfirmWrite(e.target.checked)} />I understand Write
          modifies PRODUCTION (category + tags only — duplicate content is never written).
        </label>
      </div>

      {listError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {listError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Search</label>
          <Input
            placeholder="Title, category, or tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-56"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="checked">Checked</SelectItem>
              <SelectItem value="not-checked">Not checked</SelectItem>
              <SelectItem value="needs-review">Needs review</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Write status</label>
          <Select value={writeFilter} onValueChange={(v) => setWriteFilter(v as WriteFilter)}>
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WRITE_FILTER_LABELS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Duplicate</label>
          <Select value={duplicateFilter} onValueChange={(v) => setDuplicateFilter(v as DuplicateFilter)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Category</label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {loadingList ? "Loading…" : `${filtered.length} of ${list.length} resources`}
          </span>

          {/* Writes all {list.length} rows regardless of the filters above — say
              so on the button, or it reads like it exports the filtered view. */}
          <Button size="sm" disabled={merged.length === 0 || exporting} onClick={updateWorkbook}>
            {exporting ? "Updating…" : `Update workbook (all ${merged.length})`}
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={filtered.length === 0}
            // Same 9 columns as the downloaded workbook, so the two shared
            // files read identically — only the row scope differs.
            onClick={() =>
              downloadCsv(
                `resources-overview-export-${todayStamp()}.csv`,
                toCsvFromCells(SHARED_HEADER, toSharedRows(filtered)),
              )
            }
          >
            Export CSV ({filtered.length})
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                {/* Page-scoped, not table-wide — selecting "all" shouldn't silently
                    pull in hundreds of resources sitting on other pages when each
                    one triggers a real `claude` call. */}
                <Checkbox
                  checked={table.getIsAllPageRowsSelected()}
                  ref={(el) => {
                    if (el) el.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected();
                  }}
                  onChange={table.getToggleAllPageRowsSelectedHandler()}
                  aria-label="Select all rows on this page"
                />
              </TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Duplicate?</TableHead>
              <TableHead>Which content</TableHead>
              <TableHead>Write status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const r = row.original;
              const inBatch = rowBatchState(r);
              return (
                <TableRow
                  key={r.slug}
                  // Highlight the row being worked on right now, so a long batch
                  // is legible at a glance instead of only in the summary panel.
                  className={inBatch === "running" ? "bg-primary/10" : undefined}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} aria-label={`Select ${r.title}`} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {r.link ? (
                        <a href={r.link} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                          {r.title}
                        </a>
                      ) : (
                        <span className="font-medium">{r.title}</span>
                      )}
                      {inBatch === "running" ? (
                        <Badge variant="secondary" className="animate-pulse whitespace-nowrap">
                          working…
                        </Badge>
                      ) : inBatch === "queued" ? (
                        <Badge variant="outline" className="whitespace-nowrap">
                          queued
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{r.slug}</div>
                    {/* The classifier's rationale is the whole basis for the
                        proposal — it was being stored and never shown. */}
                    {r.reason ? (
                      <div className="mt-0.5 line-clamp-2 max-w-[42ch] text-xs text-muted-foreground" title={r.reason}>
                        {r.reason}
                      </div>
                    ) : null}
                  </TableCell>

                  {/* Old → new, not just the outcome. Without the before value
                      there is nothing for a reviewer to actually review. */}
                  <TableCell className="whitespace-nowrap">
                    {r.changed && r.category !== r.oldCategory ? (
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground line-through">{r.oldCategory || "—"}</span>
                        <span aria-hidden className="text-muted-foreground">
                          →
                        </span>
                        <span className="font-medium">{r.category}</span>
                      </span>
                    ) : (
                      <span className="font-medium">{r.category || "—"}</span>
                    )}
                  </TableCell>

                  <TableCell className="min-w-[200px]">
                    <div className="flex flex-wrap gap-1">
                      {tagList(r.tags).map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    {r.changed && r.tags !== r.oldTags ? (
                      <div className="mt-1 text-xs text-muted-foreground">was: {r.oldTags || "none"}</div>
                    ) : null}
                  </TableCell>

                  <TableCell>
                    {r.checked ? (
                      <Badge variant={r.hasDuplicate ? "warning" : "success"}>{r.hasDuplicate ? "Yes" : "No"}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">not checked</span>
                    )}
                  </TableCell>

                  {/* Duplicate snippets are unbounded text — clamp them or a
                      single boilerplate finding blows the row height up. */}
                  <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                    {r.hasDuplicate ? (
                      <>
                        <div className="line-clamp-1 font-medium text-foreground">{r.duplicateSection}</div>
                        <div className="line-clamp-2 font-mono" title={r.duplicateContent}>
                          {r.duplicateContent}
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>

                  <TableCell className="whitespace-nowrap">
                    {r.writeStatus ? (
                      <Badge variant={writeStatusVariant(r.writeStatus)} title={r.writeStatus}>
                        {r.writeStatus.length > 22 ? `${r.writeStatus.slice(0, 22)}…` : r.writeStatus}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  {loadingList
                    ? "Loading resources…"
                    : list.length === 0
                      ? "No resources found."
                      : "No resources match the current filters."}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows per page</span>
          <Select
            // Show "All" only when the size isn't one of the fixed options —
            // i.e. it came from picking All. Comparing pageSize against
            // filtered.length instead would relabel a deliberate "10" as "All"
            // any time a filter left 10 or fewer rows.
            value={PAGE_SIZES.includes(pagination.pageSize) ? String(pagination.pageSize) : ALL}
            onValueChange={(v) => table.setPageSize(v === ALL ? Math.max(1, filtered.length) : Number(v))}
          >
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* "All" is a sentinel, not filtered.length — using the count as a
                  value collides with the fixed sizes whenever they happen to
                  match, producing two SelectItems with the same value. */}
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
              <SelectItem value={ALL}>All ({filtered.length})</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </span>
          <Button size="sm" variant="outline" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
            « First
          </Button>
          <Button size="sm" variant="outline" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            ‹ Prev
          </Button>
          <Button size="sm" variant="outline" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next ›
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            Last »
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Taxonomy — the live resource-category / resource-tag collections ─────────

function TaxonomyPanel() {
  const [categories, setCategories] = React.useState<TaxonomyCategory[]>([]);
  const [tags, setTags] = React.useState<TaxonomyTag[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [loaded, setLoaded] = React.useState(false);

  const fetchTaxonomy = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/resources/taxonomy");
      const data = (await res.json()) as {
        categories?: TaxonomyCategory[];
        tags?: TaxonomyTag[];
        error?: string;
      };
      if (!res.ok || data.error) {
        toast.error("Fetch failed", { description: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setCategories(data.categories ?? []);
      setTags(data.tags ?? []);
      setLoaded(true);
      toast.success(`Loaded ${data.categories?.length ?? 0} categories, ${data.tags?.length ?? 0} tags`);
    } catch (e) {
      toast.error("Fetch failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  const rows = React.useMemo(() => toTaxonomyRows(categories, tags), [categories, tags]);
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q) || r.group.toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <Button onClick={fetchTaxonomy} disabled={loading}>
          {loading ? "Loading…" : "Fetch live taxonomy"}
        </Button>
        {loaded ? (
          <span className="text-xs text-muted-foreground">
            {categories.length} categories, {tags.length} tags
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          placeholder="Filter by name, slug, or group…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {rows.length}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={filtered.length === 0}
            onClick={() => downloadCsv(`resources-taxonomy-export-${todayStamp()}.csv`, toCsv(TAXONOMY_HEADER, filtered))}
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={`${r.kind}-${r.slug}`}>
                <TableCell>
                  <Badge variant={r.kind === "category" ? "secondary" : "outline"}>{r.kind}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.group || "—"}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.slug}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "Nothing loaded yet — fetch the live taxonomy above." : `Nothing matches "${query}".`}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * Resources tab — a lightweight list of every prod resource (title/category/
 * tags only, no body content) that reviewers can multi-select and either Run
 * (classify + duplicate-content check, read-only) or Write (classify +
 * apply category/tags only — duplicate content is never written). Results
 * persist to data/resource-checks.json so checked/not-checked state survives
 * a reload. Full article content and the cross-page duplicate corpus are only
 * fetched server-side once a Run/Write is actually triggered.
 */
export function ResourcesTab() {
  const [view, setView] = React.useState<"resources" | "taxonomy" | "credentials">("resources");

  return (
    <div className="space-y-4">
      <Tabs value={view} onValueChange={(v) => setView(v as "resources" | "taxonomy" | "credentials")}>
        <TabsList>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="taxonomy">Taxonomy</TabsTrigger>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
        </TabsList>

        <TabsContent value="resources">
          <ResourceListPanel />
        </TabsContent>

        <TabsContent value="taxonomy">
          <TaxonomyPanel />
        </TabsContent>

        <TabsContent value="credentials">
          <CredentialsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
