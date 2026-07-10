"use client";

import * as React from "react";
import { Loader2, X, AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";

import type { GenStatus } from "@/lib/types";
import type { GenEvent } from "@/lib/batch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface BatchPanelProps {
  /** The slugs to run; a NEW array reference starts a run. null = hidden. */
  slugs: string[] | null;
  concurrency: number;
  onConcurrencyChange: (n: number) => void;
  onStatus: (slug: string, status: GenStatus) => void;
  /** Called once when the batch finishes, with the slugs that were freshly generated. */
  onDone: (doneSlugs: string[]) => void;
  onClose: () => void;
  onRetry: (slugs: string[]) => void;
}

interface Failure {
  slug: string;
  error: string;
}

interface RunState {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  running: number;
  finished: boolean;
  aborted?: { reason: "auth" | "client-disconnect"; message: string };
  failures: Failure[];
}

const INITIAL: RunState = { total: 0, done: 0, failed: 0, skipped: 0, running: 0, finished: false, failures: [] };

export function BatchPanel({
  slugs,
  concurrency,
  onConcurrencyChange,
  onStatus,
  onDone,
  onClose,
  onRetry,
}: BatchPanelProps) {
  const [state, setState] = React.useState<RunState>(INITIAL);
  const abortRef = React.useRef<AbortController | null>(null);
  const doneSlugsRef = React.useRef<string[]>([]);

  // Latest callbacks without re-triggering the run effect.
  const cbs = React.useRef({ onStatus, onDone, concurrency });
  cbs.current = { onStatus, onDone, concurrency };

  React.useEffect(() => {
    // A new `slugs` array identity (a fresh Start or Retry) drives one run. The
    // effect is self-contained: its cleanup aborts its own fetch. Under React
    // Strict Mode the effect runs twice (mount → cleanup → mount); the first
    // fetch is aborted by its cleanup and the second survives — so no stale
    // guard here (a guard would let the survivor bail out and leave nothing).
    if (!slugs) return;
    setState({ ...INITIAL, total: slugs.length });
    doneSlugsRef.current = [];
    slugs.forEach((s) => cbs.current.onStatus(s, "queued"));

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const apply = (e: GenEvent) => {
      if (e.type === "start") return setState((s) => ({ ...s, total: e.total }));
      if (e.type === "row") {
        cbs.current.onStatus(e.slug, e.status);
        if (e.status === "running") return setState((s) => ({ ...s, running: s.running + 1 }));
        if (e.status === "done") {
          doneSlugsRef.current.push(e.slug);
          return setState((s) => ({ ...s, done: s.done + 1, running: Math.max(0, s.running - 1) }));
        }
        if (e.status === "skipped") return setState((s) => ({ ...s, skipped: s.skipped + 1 }));
        if (e.status === "failed")
          return setState((s) => ({
            ...s,
            failed: s.failed + 1,
            running: Math.max(0, s.running - 1),
            failures: [...s.failures, { slug: e.slug, error: e.error }],
          }));
      }
      if (e.type === "aborted") return setState((s) => ({ ...s, aborted: { reason: e.reason, message: e.message } }));
      if (e.type === "done") {
        setState((s) => ({ ...s, finished: true, running: 0 }));
        cbs.current.onDone(doneSlugsRef.current);
      }
    };

    (async () => {
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slugs, concurrency: cbs.current.concurrency }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const msg = await res.text().catch(() => res.statusText);
          setState((s) => ({ ...s, finished: true, aborted: { reason: "client-disconnect", message: msg } }));
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx).replace(/^data: /, "");
            buf = buf.slice(idx + 2);
            if (chunk) apply(JSON.parse(chunk) as GenEvent);
          }
        }
      } catch {
        // Aborted by the user (Stop) or the connection dropped — mark finished.
        setState((s) => ({ ...s, finished: true }));
      }
    })();

    return () => ctrl.abort();
  }, [slugs]);

  if (!slugs) return null;

  const completed = state.done + state.failed + state.skipped;
  const pct = state.total ? Math.round((completed / state.total) * 100) : 0;
  const busy = !state.finished && !state.aborted;

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : state.failed || state.aborted ? (
          <AlertTriangle className="h-4 w-4 text-warning" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-success" />
        )}
        <span className="text-sm font-medium text-foreground">
          {busy ? "Generating…" : state.aborted ? "Batch stopped" : "Batch complete"}
        </span>
        <span className="tabular text-sm text-muted-foreground">
          {state.done} done · {state.failed} failed · {state.skipped} skipped · {completed}/{state.total}
        </span>

        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          concurrency
          <Input
            type="number"
            min={1}
            max={8}
            value={concurrency}
            disabled={busy}
            onChange={(e) => onConcurrencyChange(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
            className="h-7 w-14 tabular"
            aria-label="Concurrency"
          />
        </label>

        {busy ? (
          <Button size="sm" variant="outline" onClick={() => abortRef.current?.abort()}>
            Stop
          </Button>
        ) : (
          <>
            {state.failures.length ? (
              <Button size="sm" variant="outline" onClick={() => onRetry(state.failures.map((f) => f.slug))}>
                <RotateCcw className="h-4 w-4" /> Retry {state.failures.length} failed
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {state.aborted?.reason === "auth" ? (
        <p className="mt-2 text-xs text-warning">
          Claude is not logged in — run <code className="rounded bg-muted px-1">claude</code> in a terminal, then retry.
        </p>
      ) : null}

      {state.failures.length ? (
        <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto text-xs">
          {state.failures.map((f) => (
            <li key={f.slug} className="flex gap-2">
              <span className="shrink-0 font-medium text-destructive">{f.slug}</span>
              <span className="truncate text-muted-foreground" title={f.error}>
                {f.error}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
