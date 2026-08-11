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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RelationsContentTypesPanel } from "@/components/relations-content-types-panel";
import {
  mergeRelationRows,
  type ContentTypeInfo,
  type RelationCheck,
  type RelationEntryListItem,
  type RelationTableRow,
} from "@/lib/relation-reports";

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

const ALL = "__all__";
const POLL_MS = 5_000;
const DEFAULT_GAP_MINUTES = 8;
const MIN_GAP_MINUTES = 0.5;
const MAX_GAP_MINUTES = 60;

type StatusFilter = "all" | "checked" | "not-checked" | "needs-review";

const PHASE_LABEL: Record<string, string> = {
  starting: "Starting…",
  mapping: "Mapping relations (Claude + WebSearch)",
  writing: "Writing to production",
  done: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

/** Progress of the detached batch process — see lib/relations/batch-store.js. */
interface BatchState {
  batchId: string;
  action: "run" | "write";
  status: "running" | "done" | "failed" | "stopped" | "interrupted";
  phase: string;
  keys: string[];
  current: string;
  total: number;
  mapped: number;
  applied: number;
  failed: number;
  rateLimited: number;
  gapMinutes: number;
  gapMode: "fast" | "paced";
  abortedReason: string | null;
  nextWriteAt: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
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

/** "3 minutes ago" style, so the cached corpus's staleness is visible rather than invisible — the whole cache has no automatic expiry (see lib/relations/cache-store.js), so this is the only signal a reviewer gets. */
function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Same batch-progress shape as ResourcesTab's BatchProgress, adapted to a "mapped" count instead of "classified" + a separate write-only field set. */
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
  const done = batch.mapped;
  const total = batch.total;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const nextWriteMs = batch.nextWriteAt && nowTs ? new Date(batch.nextWriteAt).getTime() - nowTs : null;

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
        {batch.action === "write" ? (
          <Badge variant={batch.gapMode === "fast" ? "warning" : "outline"}>
            {batch.gapMode === "fast" ? "fast — no gap" : `paced ~${batch.gapMinutes} min`}
          </Badge>
        ) : null}

        {total > 0 ? (
          <span className="text-sm font-semibold tabular-nums">
            {done} / {total} <span className="font-normal text-muted-foreground">({pct}%)</span>
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
          aria-label={`${done} of ${total}`}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      {batch.action === "write" ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="text-success-foreground/80">Applied {batch.applied}</span>
          <span className={batch.failed > 0 ? "text-destructive" : "text-muted-foreground"}>Failed {batch.failed}</span>
          <span className="text-muted-foreground">Rate-limited {batch.rateLimited}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {batch.current ? (
          <span>
            Now: <span className="font-mono text-foreground">{batch.current}</span>
          </span>
        ) : null}
        {running && nextWriteMs !== null && nextWriteMs > 0 ? (
          <span className="tabular-nums">
            Next {batch.action === "write" ? "write" : "entry"} in {formatDuration(nextWriteMs)}
          </span>
        ) : null}
        {running ? <span>Runs in the background — safe to close this tab.</span> : null}
      </div>

      {batch.abortedReason ? (
        <p className="text-xs font-medium text-destructive">
          Stopped after 3 consecutive failures ({batch.abortedReason}). This looks systemic rather than per-entry — fix
          the cause, then re-run the remaining rows.
        </p>
      ) : null}

      {batch.error ? <p className="text-xs text-destructive">{batch.error}</p> : null}
    </div>
  );
}

function RelationBadges({ relations, empty }: { relations: { relationType: string; targetTitle: string; targetContentType: string; rationale?: string; writable?: boolean }[]; empty: string }) {
  if (relations.length === 0) {
    return <span className="text-xs text-muted-foreground">{empty}</span>;
  }
  return (
    <div className="flex max-w-md flex-wrap gap-1">
      {relations.map((r, i) => (
        <Badge
          key={`${r.relationType}-${r.targetTitle}-${i}`}
          variant={r.writable === false ? "outline" : "secondary"}
          title={r.rationale ? `${r.relationType} → ${r.targetTitle}\n\n${r.rationale}` : `${r.relationType} → ${r.targetTitle}`}
          className="max-w-[220px] truncate font-normal"
        >
          {r.relationType} → [{r.targetContentType}] {r.targetTitle}
        </Badge>
      ))}
    </div>
  );
}

function RelationsListPanel() {
  const [list, setList] = React.useState<RelationEntryListItem[]>([]);
  const [contentTypes, setContentTypes] = React.useState<ContentTypeInfo[]>([]);
  const [checks, setChecks] = React.useState<Record<string, RelationCheck>>({});
  const [loadingList, setLoadingList] = React.useState(true);
  const [listError, setListError] = React.useState<string | null>(null);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = React.useState<string>(ALL);
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [confirmWrite, setConfirmWrite] = React.useState(false);
  const [gapMinutes, setGapMinutes] = React.useState(DEFAULT_GAP_MINUTES);
  const [batch, setBatch] = React.useState<BatchState | null>(null);
  const [starting, setStarting] = React.useState<"run" | "write" | null>(null);
  const [stopping, setStopping] = React.useState(false);
  const [nowTs, setNowTs] = React.useState(0);
  const [listUpdatedAt, setListUpdatedAt] = React.useState<string | null>(null);
  const [listFromCache, setListFromCache] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  // Served from lib/relations/corpus-cache.js — a normal load reads the
  // cache (near-instant); `refresh: true` forces a live re-fetch of the
  // ~3,400-entry corpus (~55s) and overwrites it. See the "Refresh" button.
  const loadList = React.useCallback(async (refresh = false) => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch(refresh ? "/api/relations/list?refresh=true" : "/api/relations/list");
      const data = (await res.json()) as {
        contentTypes?: ContentTypeInfo[];
        entries?: RelationEntryListItem[];
        updatedAt?: string;
        fromCache?: boolean;
        error?: string;
      };
      if (!res.ok || data.error) {
        setListError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setContentTypes(data.contentTypes ?? []);
      setList(data.entries ?? []);
      setListUpdatedAt(data.updatedAt ?? null);
      setListFromCache(Boolean(data.fromCache));
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadChecks = React.useCallback(async () => {
    try {
      const res = await fetch("/api/relations/checks");
      const data = (await res.json()) as { checks?: Record<string, RelationCheck> };
      setChecks(data.checks ?? {});
    } catch {
      // Non-fatal — the list still renders, just without prior check state.
    }
  }, []);

  const loadBatch = React.useCallback(async (): Promise<BatchState | null> => {
    try {
      const res = await fetch("/api/relations/batch");
      const data = (await res.json()) as { batch?: BatchState | null };
      const next = data.batch ?? null;
      setBatch(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  React.useEffect(() => {
    void loadList();
    void loadChecks();
    void loadBatch();
  }, [loadList, loadChecks, loadBatch]);

  const batchRunning = batch?.status === "running";

  React.useEffect(() => {
    if (!batchRunning) return;
    const id = setInterval(() => {
      void loadBatch();
      void loadChecks();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [batchRunning, loadBatch, loadChecks]);

  React.useEffect(() => {
    if (!batchRunning) return;
    setNowTs(Date.now());
    const id = setInterval(() => setNowTs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [batchRunning]);

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
            : `${batch?.mapped ?? 0} entr${(batch?.mapped ?? 0) === 1 ? "y" : "ies"} mapped`;
        toast.success(`${verb} finished`, { description: detail });
      } else if (status === "failed") {
        toast.error(`${verb} failed`, { description: batch?.error ?? "see data/.relations-batch.log" });
      } else if (status === "stopped") {
        toast(`${verb} stopped`, { description: "Rows already written stay written." });
      } else if (status === "interrupted") {
        toast.error(`${verb} interrupted`, { description: batch?.error ?? "the batch process is gone" });
      }
    }
    prevStatus.current = status;
  }, [batch, loadChecks]);

  const merged = React.useMemo(() => mergeRelationRows(list, checks), [list, checks]);

  // The review step between Run and Write — see lib/relation-workbook.ts.
  // Sends ALL loaded rows, not the filtered view: filters change what's on
  // screen, never what belongs in the review document. Nothing here writes
  // to Strapi; Write is a separate, explicit, confirmation-gated action.
  const exportWorkbook = async () => {
    if (merged.length === 0) return;
    setExporting(true);
    try {
      const res = await fetch("/api/relations/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: merged }),
      });
      if (!res.ok || res.headers.get("Content-Type")?.includes("application/json")) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error("Could not export the workbook", { description: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const blob = await res.blob();
      const filename =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "relations-mapping.xlsx";
      downloadBlob(filename, blob);
      const outPath = res.headers.get("X-Workbook-Path") ?? "output/relations/relations-mapping.xlsx";
      toast.success(`Workbook exported — ${res.headers.get("X-Workbook-Rows") ?? merged.length} rows`, {
        description: `Review it before writing anything to Strapi. Saved to ${outPath} and downloaded as ${filename}.`,
      });
    } catch (e) {
      toast.error("Request failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(false);
    }
  };

  const typeOptions = React.useMemo(() => {
    const set = new Set(list.map((e) => e.contentType));
    return [...set].sort();
  }, [list]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return merged.filter((r) => {
      if (q && !r.title.toLowerCase().includes(q) && !r.slug.toLowerCase().includes(q)) return false;
      if (statusFilter === "checked" && !r.checked) return false;
      if (statusFilter === "not-checked" && r.checked) return false;
      if (statusFilter === "needs-review" && r.status !== "needs-manual-review") return false;
      if (typeFilter !== ALL && r.contentType !== typeFilter) return false;
      return true;
    });
  }, [merged, query, statusFilter, typeFilter]);

  React.useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [query, statusFilter, typeFilter]);

  const columns = React.useMemo<ColumnDef<RelationTableRow>[]>(
    () => [
      { accessorKey: "contentType", header: "Type" },
      { accessorKey: "title", header: "Entry" },
      { accessorKey: "currentRelations", header: "Current relations" },
      { accessorKey: "proposedRelations", header: "Proposed relations" },
      { accessorKey: "writeStatus", header: "Write status" },
    ],
    [],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    getRowId: (row) => row.key,
    enableRowSelection: true,
    state: { rowSelection, pagination },
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const rows = table.getRowModel().rows;
  const selectedKeys = Object.keys(rowSelection).filter((k) => rowSelection[k]);

  const startBatch = async (action: "run" | "write", pace: "fast" | "paced" = "paced") => {
    if (selectedKeys.length === 0 || batchRunning) return;
    if (action === "write" && !confirmWrite) return;
    const gap = action === "write" && pace === "fast" ? 0 : gapMinutes;
    setStarting(action);
    try {
      const res = await fetch("/api/relations/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: selectedKeys, action, confirmWrite, gapMinutes: gap }),
      });
      const data = (await res.json()) as BatchState & { error?: string };
      if (!res.ok || data.error) {
        toast.error(`Could not start the ${action}`, { description: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setBatch(data);
      const n = selectedKeys.length;
      toast.success(action === "run" ? `Run started — ${n} entr${n === 1 ? "y" : "ies"}` : `Write started — ${n} entr${n === 1 ? "y" : "ies"}`, {
        description:
          n > 1
            ? `Paced ~${gap} min ±20% between each entry — won't map or write everything back-to-back. Runs in the background; you can close this tab.`
            : "Runs in the background. You can close this tab.",
      });
    } catch (e) {
      toast.error("Request failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setStarting(null);
    }
  };

  const stopBatch = async () => {
    setStopping(true);
    try {
      const res = await fetch("/api/relations/batch", { method: "DELETE" });
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

  // Only rows whose proposed relations include at least one writable one (a
  // real, discovered Strapi field) are worth a Write click — a selection of
  // only see_also-only rows would start a batch that writes nothing.
  const writableSelectedCount = React.useMemo(() => {
    const bySlug = new Map(filtered.map((r) => [r.key, r]));
    return selectedKeys.filter((k) => bySlug.get(k)?.proposedRelations.some((p) => p.writable)).length;
  }, [selectedKeys, filtered]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <Button onClick={() => startBatch("run")} disabled={selectedKeys.length === 0 || batchRunning || starting !== null}>
          {starting === "run" ? "Starting…" : `Run (${selectedKeys.length} selected)`}
        </Button>

        <Button
          variant="outline"
          onClick={() => void exportWorkbook()}
          disabled={merged.length === 0 || exporting}
          title="Export every mapped entry + proposed relation to Excel for review — nothing is written to Strapi by this button."
        >
          {exporting ? "Exporting…" : `Export for review (all ${merged.length})`}
        </Button>

        <div className="flex items-center gap-1.5" title="Randomized (±20%) pause between EACH entry, for both Run and Write — a whole batch never maps or writes back-to-back in one burst.">
          <label htmlFor="rel-gap-minutes" className="text-xs font-medium text-muted-foreground">
            Gap
          </label>
          <Input
            id="rel-gap-minutes"
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
          disabled={writableSelectedCount === 0 || !confirmWrite || batchRunning || starting !== null}
          title={writableSelectedCount === 0 ? "None of the selected rows have a writable proposal yet — Run them first" : undefined}
        >
          {starting === "write" ? "Starting…" : `Write paced (${writableSelectedCount})`}
        </Button>
        <Button
          variant="destructive"
          onClick={() => startBatch("write", "fast")}
          disabled={writableSelectedCount === 0 || !confirmWrite || batchRunning || starting !== null}
        >
          {starting === "write" ? "Starting…" : `Write fast (${writableSelectedCount})`}
        </Button>

        {selectedKeys.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setRowSelection({})}>
            Clear selection ({selectedKeys.length})
          </Button>
        ) : null}

        {listUpdatedAt ? (
          <span className="text-xs text-muted-foreground" title={new Date(listUpdatedAt).toLocaleString()}>
            {listFromCache ? "Cached" : "Fetched fresh"} · {formatAgo(listUpdatedAt)}
          </span>
        ) : null}

        <Button
          size="sm"
          variant="outline"
          className={listUpdatedAt ? undefined : "ml-auto"}
          onClick={() => void loadList(true)}
          disabled={loadingList}
          title="Re-fetches every entry from Strapi (~3,400 entries, ~55s) and overwrites the cache — use after adding or editing content."
        >
          {loadingList ? "Refreshing…" : "Refresh (re-fetch from Strapi)"}
        </Button>
      </div>

      {batch ? <BatchProgress batch={batch} nowTs={nowTs} stopping={stopping} onStop={stopBatch} onDismiss={() => setBatch(null)} /> : null}

      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <label className="flex items-center gap-2 font-medium">
          <Checkbox checked={confirmWrite} onChange={(e) => setConfirmWrite(e.target.checked)} />I understand Write
          modifies PRODUCTION — it adds the proposed relation to the field&apos;s existing values (never removes
          what&apos;s already set), and only for fields Strapi&apos;s own schema already has (see the Content types
          tab). Proposals with no such field (&quot;see_also&quot;) are report-only and never written.
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
          <Input placeholder="Title or slug…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-56" />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="checked">Run</SelectItem>
              <SelectItem value="not-checked">Not run yet</SelectItem>
              <SelectItem value="needs-review">Needs review</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Content type</label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              {typeOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto">
          <span className="text-xs text-muted-foreground">
            {loadingList ? "Loading…" : `${filtered.length} of ${list.length} entries across ${contentTypes.length} content types`}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={rows.length > 0 && rows.every((r) => r.getIsSelected())}
                  onChange={(e) => rows.forEach((r) => r.toggleSelected(e.target.checked))}
                />
              </TableHead>
              {columns.map((c) => (
                <TableHead key={String(c.header)}>{String(c.header)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="py-10 text-center text-sm text-muted-foreground">
                  {loadingList ? "Loading…" : "No entries match this filter."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const r = row.original;
                return (
                  <TableRow key={r.key} data-state={row.getIsSelected() ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox checked={row.getIsSelected()} onChange={(e) => row.toggleSelected(e.target.checked)} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.contentType}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <div className="truncate font-medium">{r.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.slug}</div>
                    </TableCell>
                    <TableCell>
                      <RelationBadges relations={r.currentRelations.map((c) => ({ relationType: c.field, targetTitle: c.title, targetContentType: c.contentType ?? "?" }))} empty="(none yet)" />
                    </TableCell>
                    <TableCell>
                      <RelationBadges relations={r.proposedRelations} empty={r.checked ? "(nothing proposed)" : "not run yet"} />
                    </TableCell>
                    <TableCell>
                      {r.writeStatus ? (
                        <Badge variant={r.writeStatus === "applied" ? "success" : r.writeStatus.startsWith("failed") ? "warning" : "secondary"}>
                          {r.writeStatus}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function RelationsTab() {
  return (
    <Tabs defaultValue="relations">
      <TabsList>
        <TabsTrigger value="relations">Relations</TabsTrigger>
        <TabsTrigger value="content-types">Content types</TabsTrigger>
      </TabsList>
      <TabsContent value="relations">
        <RelationsListPanel />
      </TabsContent>
      <TabsContent value="content-types">
        <RelationsContentTypesPanel />
      </TabsContent>
    </Tabs>
  );
}
