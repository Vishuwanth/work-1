"use client";

import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";

import type { RowView, ContentState, ReviewStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface RowsTableProps {
  views: RowView[];
  onOpen: (slug: string) => void;
  onGenerate: (slug: string) => void;
}

const ALL = "all";

function ContentBadge({ state }: { state: ContentState }) {
  if (state === "done") return <Badge variant="success">● Done</Badge>;
  if (state === "raw")
    return (
      <Badge variant="secondary" className="bg-secondary/15 text-secondary-foreground">
        <span className="text-secondary">●</span>&nbsp;Raw
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-muted-foreground">
      ○ Not generated
    </Badge>
  );
}

function ReviewBadge({ status, verify }: { status: ReviewStatus; verify: number }) {
  return (
    <span className="flex items-center gap-1">
      {status === "approved" ? (
        <Badge variant="success">✓ Approved</Badge>
      ) : status === "needs-work" ? (
        <Badge variant="destructive">Needs work</Badge>
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          Pending
        </Badge>
      )}
      {verify > 0 ? (
        <Badge variant="warning" title={`${verify} field(s) need verification`}>
          ⚠ {verify}
        </Badge>
      ) : null}
    </span>
  );
}

function SortHeader({
  label,
  dir,
  onClick,
  className,
}: {
  label: string;
  dir: false | "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 text-left font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      {label}
      {dir === "asc" ? (
        <ArrowUp className="h-3 w-3" />
      ) : dir === "desc" ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

export function RowsTable({ views, onOpen, onGenerate }: RowsTableProps) {
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [pillar, setPillar] = React.useState(ALL);
  const [content, setContent] = React.useState(ALL);
  const [review, setReview] = React.useState(ALL);
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "rowNum", desc: false }]);

  const pillars = React.useMemo(
    () => Array.from(new Set(views.map((v) => v.pillarName).filter(Boolean))).sort(),
    [views],
  );

  const columns = React.useMemo<ColumnDef<RowView>[]>(
    () => [
      { accessorKey: "rowNum", header: "#" },
      { accessorKey: "title", header: "Title" },
      { accessorKey: "pillarName", header: "Pillar" },
      { accessorKey: "contentType", header: "Type" },
      { accessorKey: "excelStatus", header: "Excel" },
      { accessorKey: "contentState", header: "Content" },
      { accessorKey: "reviewStatus", header: "Review" },
    ],
    [],
  );

  const filtered = React.useMemo(
    () =>
      views.filter(
        (v) =>
          (pillar === ALL || v.pillarName === pillar) &&
          (content === ALL || v.contentState === content) &&
          (review === ALL || v.reviewStatus === review),
      ),
    [views, pillar, content, review],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _id, value) => {
      const q = String(value).toLowerCase();
      return (
        row.original.title.toLowerCase().includes(q) ||
        row.original.pillarName.toLowerCase().includes(q)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const paddingTop = virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length
    ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;

  const sortState = (id: string): false | "asc" | "desc" => {
    const s = sorting.find((x) => x.id === id);
    return s ? (s.desc ? "desc" : "asc") : false;
  };
  const toggleSort = (id: string) => table.getColumn(id)?.toggleSorting();

  const cols: { id: string; label: string; className: string; sortable?: boolean }[] = [
    { id: "rowNum", label: "#", className: "w-14", sortable: true },
    { id: "title", label: "Title", className: "min-w-[280px]", sortable: true },
    { id: "pillarName", label: "Pillar", className: "w-40", sortable: true },
    { id: "contentType", label: "Type", className: "w-28", sortable: true },
    { id: "excelStatus", label: "Excel", className: "w-24", sortable: true },
    { id: "contentState", label: "Content", className: "w-36", sortable: true },
    { id: "reviewStatus", label: "Review", className: "w-40", sortable: true },
    { id: "action", label: "", className: "w-28" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Search title or pillar…"
            className="pl-8"
            aria-label="Search rows"
          />
        </div>
        <Select value={pillar} onValueChange={setPillar}>
          <SelectTrigger className="w-44" aria-label="Filter by pillar">
            <SelectValue placeholder="Pillar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All pillars</SelectItem>
            {pillars.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={content} onValueChange={setContent}>
          <SelectTrigger className="w-40" aria-label="Filter by content state">
            <SelectValue placeholder="Content" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All content</SelectItem>
            <SelectItem value="not-generated">Not generated</SelectItem>
            <SelectItem value="raw">Raw</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
        <Select value={review} onValueChange={setReview}>
          <SelectTrigger className="w-40" aria-label="Filter by review state">
            <SelectValue placeholder="Review" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All reviews</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="needs-work">Needs work</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="text-xs text-muted-foreground">
        <span className="tabular">{rows.length}</span> of <span className="tabular">{views.length}</span> rows
      </div>

      <div ref={scrollRef} className="max-h-[68vh] overflow-auto rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              {cols.map((c) => {
                const dir = c.sortable ? sortState(c.id) : false;
                return (
                  <TableHead
                    key={c.id}
                    className={c.className}
                    aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                  >
                    {c.sortable ? (
                      <SortHeader label={c.label} dir={dir} onClick={() => toggleSort(c.id)} />
                    ) : (
                      c.label
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={cols.length} className="h-32 text-center text-muted-foreground">
                  {views.length === 0
                    ? "No content rows found — check docs/source/…xlsx"
                    : "No rows match your filters"}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {paddingTop > 0 ? (
                  <tr>
                    <td colSpan={cols.length} style={{ height: paddingTop }} />
                  </tr>
                ) : null}
                {virtualRows.map((vr) => {
                  const v = rows[vr.index].original;
                  return (
                    <TableRow
                      key={v.slug + v.rowNum}
                      data-index={vr.index}
                      ref={(el) => virtualizer.measureElement(el)}
                      onClick={() => onOpen(v.slug)}
                      className="cursor-pointer"
                    >
                      <TableCell className="tabular text-muted-foreground">{v.rowNum}</TableCell>
                      <TableCell className="font-medium text-foreground">{v.title}</TableCell>
                      <TableCell className="text-sm">{v.pillarName || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.contentType || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.excelStatus || "—"}</TableCell>
                      <TableCell>
                        <ContentBadge state={v.contentState} />
                      </TableCell>
                      <TableCell>
                        <ReviewBadge status={v.reviewStatus} verify={v.verifyCount} />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {v.contentState === "not-generated" ? (
                          <Button size="sm" variant="outline" onClick={() => onGenerate(v.slug)}>
                            Generate
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => onOpen(v.slug)}>
                            Review →
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {paddingBottom > 0 ? (
                  <tr>
                    <td colSpan={cols.length} style={{ height: paddingBottom }} />
                  </tr>
                ) : null}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
