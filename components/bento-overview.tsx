"use client";

import * as React from "react";
import { Sparkles, CheckCircle2, CheckCheck, AlertTriangle, Layers, Zap, ArrowRightToLine } from "lucide-react";

import type { OverviewStats, Toggles } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

interface BentoOverviewProps {
  stats: OverviewStats;
  toggles: Toggles;
  onToggle: (t: Toggles) => void;
}

/** A rounded bento tile. `accent` tints the border/heading; `className` sizes it in the grid. */
function Tile({
  className,
  accent,
  children,
}: {
  className?: string;
  accent?: "primary" | "warning" | "success";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
        accent === "warning" && "border-warning/30",
        accent === "success" && "border-success/30",
        className,
      )}
    >
      {children}
    </div>
  );
}

function StatTile({
  label,
  value,
  suffix,
  icon,
  accent = "primary",
}: {
  label: string;
  value: number;
  suffix?: string;
  icon: React.ReactNode;
  accent?: "primary" | "warning" | "success";
}) {
  const tone =
    accent === "warning" ? "text-warning" : accent === "success" ? "text-success" : "text-primary";
  return (
    <Tile accent={accent} className="flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={tone}>{icon}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className={cn("tabular text-3xl font-semibold leading-none", tone)}>{value}</span>
        {suffix ? <span className="tabular text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    </Tile>
  );
}

/** Small dependency-free SVG bar chart of the review pipeline (real per-status counts). */
function PipelineChart({ stats }: { stats: OverviewStats }) {
  const bars = [
    { label: "Generated", value: stats.generated, className: "fill-primary" },
    { label: "Approved", value: stats.approved, className: "fill-success" },
    { label: "Pending", value: stats.pending, className: "fill-secondary" },
    { label: "Needs work", value: stats.needsWork, className: "fill-destructive" },
  ];
  const max = Math.max(1, ...bars.map((b) => b.value));
  const W = 260;
  const H = 96;
  const gap = 12;
  const bw = (W - gap * (bars.length - 1)) / bars.length;
  return (
    <Tile className="col-span-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Review pipeline</span>
        <Zap className="h-4 w-4 text-primary" />
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="Review pipeline counts">
        {bars.map((b, i) => {
          const h = (b.value / max) * H;
          const x = i * (bw + gap);
          return (
            <g key={b.label}>
              <rect
                x={x}
                y={H - h}
                width={bw}
                height={h}
                rx={3}
                className={cn(b.className, "transition-[height] duration-300")}
              />
              <text x={x + bw / 2} y={H - h - 3} textAnchor="middle" className="tabular fill-foreground text-[9px]">
                {b.value}
              </text>
              <text x={x + bw / 2} y={H + 12} textAnchor="middle" className="fill-muted-foreground text-[7px]">
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </Tile>
  );
}

/** 7-day generation throughput (generated-per-day from tracker timestamps). */
function ThroughputChart({ throughput }: { throughput: OverviewStats["throughput"] }) {
  const max = Math.max(1, ...throughput.map((p) => p.count));
  const W = 260;
  const H = 96;
  const gap = 10;
  const n = Math.max(1, throughput.length);
  const bw = (W - gap * (n - 1)) / n;
  const dayLabel = (iso: string) => iso.slice(5); // MM-DD
  return (
    <Tile className="col-span-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Throughput · last 7 days
        </span>
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="FAQs generated per day, last 7 days">
        {throughput.map((p, i) => {
          const h = (p.count / max) * H;
          const x = i * (bw + gap);
          return (
            <g key={p.date}>
              <rect x={x} y={H - h} width={bw} height={Math.max(h, 1)} rx={3} className="fill-primary transition-[height] duration-300" />
              <text x={x + bw / 2} y={H - h - 3} textAnchor="middle" className="tabular fill-foreground text-[9px]">
                {p.count || ""}
              </text>
              <text x={x + bw / 2} y={H + 12} textAnchor="middle" className="tabular fill-muted-foreground text-[7px]">
                {dayLabel(p.date)}
              </text>
            </g>
          );
        })}
      </svg>
    </Tile>
  );
}

function CollectionTile({ perCollection }: { perCollection: Record<string, number> }) {
  const entries = Object.entries(perCollection ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <Tile className="col-span-2 row-span-2">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Generated by collection</span>
        <Layers className="h-4 w-4 text-primary" />
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing generated yet.</p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-1">
          {entries.map(([pillar, n]) => (
            <li key={pillar} className="flex items-center gap-2 text-sm">
              <span className="w-32 shrink-0 truncate text-foreground" title={pillar}>
                {pillar || "—"}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${(n / max) * 100}%` }}
                />
              </span>
              <span className="tabular w-6 shrink-0 text-right text-muted-foreground">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

function ToggleTile({
  label,
  description,
  checked,
  icon,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  icon: React.ReactNode;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <Tile className="flex flex-col justify-between">
      <div className="flex items-start justify-between gap-2">
        <span className="text-primary">{icon}</span>
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
      </div>
      <div className="mt-3">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </Tile>
  );
}

export function BentoOverview({ stats, toggles, onToggle }: BentoOverviewProps) {
  return (
    <section
      aria-label="Overview"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <StatTile
        label="Generated"
        value={stats.generated}
        suffix={`/ ${stats.total}`}
        icon={<Sparkles className="h-4 w-4" />}
      />
      <StatTile
        label="Approved"
        value={stats.approved}
        icon={<CheckCircle2 className="h-4 w-4" />}
        accent="success"
      />
      <StatTile
        label="Needs work"
        value={stats.needsWork}
        icon={<AlertTriangle className="h-4 w-4" />}
        accent="primary"
      />

      <ThroughputChart throughput={stats.throughput} />
      <PipelineChart stats={stats} />
      <CollectionTile perCollection={stats.perCollection} />

      <ToggleTile
        label="Auto-move on approve"
        description="Move raw → done when a row is approved."
        checked={toggles.autoMove}
        icon={<ArrowRightToLine className="h-5 w-5" />}
        onCheckedChange={(v) => onToggle({ ...toggles, autoMove: v })}
      />
      <ToggleTile
        label="Auto-approve on generate"
        description="Approve each row the instant it's generated — skips review."
        checked={toggles.autoApprove}
        icon={<CheckCheck className="h-5 w-5" />}
        onCheckedChange={(v) => onToggle({ ...toggles, autoApprove: v })}
      />
    </section>
  );
}
