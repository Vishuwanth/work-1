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
  RESOURCE_EXPORT_HEADER,
  TAXONOMY_HEADER,
  mergeResourceRows,
  tagList,
  toCsv,
  toResourceExportRows,
  toTaxonomyRows,
  type ResourceCheck,
  type ResourceListItem,
  type ResourceTableRow,
  type TaxonomyCategory,
  type TaxonomyTag,
} from "@/lib/resource-reports";

function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type StatusFilter = "all" | "checked" | "not-checked" | "needs-review";
type DuplicateFilter = "all" | "yes" | "no";
const ALL = "__all__";

// ─── Interactive resource list — TanStack table, multi-select, Run/Write, filters ─

interface RunResponse {
  applyResult?: { applied: number; failed: number; rateLimited: number; writeVia: string } | null;
  rateLimitStatus?: { used: number; max: number; windowMs: number };
  error?: string;
}

function ResourceListPanel() {
  const [list, setList] = React.useState<ResourceListItem[]>([]);
  const [checks, setChecks] = React.useState<Record<string, ResourceCheck>>({});
  const [loadingList, setLoadingList] = React.useState(true);
  const [listError, setListError] = React.useState<string | null>(null);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [duplicateFilter, setDuplicateFilter] = React.useState<DuplicateFilter>("all");
  const [categoryFilter, setCategoryFilter] = React.useState<string>(ALL);
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [concurrency, setConcurrency] = React.useState(3);
  const [running, setRunning] = React.useState<"run" | "write" | null>(null);
  const [confirmWrite, setConfirmWrite] = React.useState(false);
  const [rateLimitStatus, setRateLimitStatus] = React.useState<{ used: number; max: number; windowMs: number } | null>(
    null,
  );

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

  React.useEffect(() => {
    void loadList();
    void loadChecks();
  }, [loadList, loadChecks]);

  const merged = React.useMemo(() => mergeResourceRows(list, checks), [list, checks]);

  const categories = React.useMemo(() => {
    const set = new Set(merged.map((r) => r.category).filter(Boolean));
    return [...set].sort();
  }, [merged]);

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
      if (categoryFilter !== ALL && r.category !== categoryFilter) return false;
      return true;
    });
  }, [merged, query, statusFilter, duplicateFilter, categoryFilter]);

  // Changing a filter can shrink the result set below the current page —
  // always land back on page 1 rather than showing an empty page.
  React.useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [query, statusFilter, duplicateFilter, categoryFilter]);

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

  const runOrWrite = async (action: "run" | "write") => {
    if (selectedSlugs.length === 0) return;
    if (action === "write" && !confirmWrite) return;
    setRunning(action);
    try {
      const res = await fetch("/api/resources/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: selectedSlugs, action, concurrency, confirmWrite }),
      });
      const data = (await res.json()) as RunResponse;
      if (!res.ok || data.error) {
        toast.error(action === "run" ? "Run failed" : "Write failed", { description: data.error ?? `HTTP ${res.status}` });
        return;
      }
      await loadChecks(); // re-read the persisted store rather than re-deriving client-side
      if (data.rateLimitStatus) setRateLimitStatus(data.rateLimitStatus);

      const appliedNote = data.applyResult
        ? ` · applied ${data.applyResult.applied}, failed ${data.applyResult.failed}, rate-limited ${data.applyResult.rateLimited} (via ${data.applyResult.writeVia})`
        : "";
      toast.success(`${action === "run" ? "Checked" : "Wrote"} ${selectedSlugs.length} resource(s)${appliedNote}`);
    } catch (e) {
      toast.error("Request failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Concurrency</label>
          <Input
            type="number"
            min={1}
            value={concurrency}
            onChange={(e) => setConcurrency(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-20"
          />
        </div>

        <Button onClick={() => runOrWrite("run")} disabled={selectedSlugs.length === 0 || running !== null}>
          {running === "run" ? "Running…" : `Run (${selectedSlugs.length} selected)`}
        </Button>

        <Button
          variant="destructive"
          onClick={() => runOrWrite("write")}
          disabled={selectedSlugs.length === 0 || !confirmWrite || running !== null}
        >
          {running === "write" ? "Writing…" : `Write (${selectedSlugs.length} selected)`}
        </Button>

        {rateLimitStatus ? (
          <span className="text-xs text-muted-foreground">
            Writes used: {rateLimitStatus.used}/{rateLimitStatus.max} (rolling {Math.round(rateLimitStatus.windowMs / 60000)}
            -min window)
          </span>
        ) : null}
      </div>

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
          <Button
            size="sm"
            variant="outline"
            disabled={filtered.length === 0}
            onClick={() =>
              downloadCsv(
                `resources-overview-export-${todayStamp()}.csv`,
                toCsv(RESOURCE_EXPORT_HEADER, toResourceExportRows(filtered)),
              )
            }
          >
            Export CSV
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
              return (
                <TableRow key={r.slug}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} aria-label={`Select ${r.title}`} />
                  </TableCell>
                  <TableCell>
                    {r.link ? (
                      <a href={r.link} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                        {r.title}
                      </a>
                    ) : (
                      <span className="font-medium">{r.title}</span>
                    )}
                    <div className="text-xs text-muted-foreground">{r.slug}</div>
                  </TableCell>
                  <TableCell className="font-medium">{r.category || "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {tagList(r.tags).map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.checked ? (
                      <Badge variant={r.hasDuplicate ? "warning" : "success"}>{r.hasDuplicate ? "Yes" : "No"}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">not checked</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                    {r.hasDuplicate ? (
                      <>
                        <div className="font-medium text-foreground">{r.duplicateSection}</div>
                        <div className="font-mono">{r.duplicateContent}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {r.writeStatus ? <Badge variant={r.writeStatus === "applied" ? "success" : "secondary"}>{r.writeStatus}</Badge> : "—"}
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
          <Select value={String(pagination.pageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[50, 100, 200, 500].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
              <SelectItem value={String(filtered.length || 1)}>All ({filtered.length})</SelectItem>
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
