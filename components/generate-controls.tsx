"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2, Pause } from "lucide-react";

import type { RowView } from "@/lib/types";
import { generateRow } from "@/app/actions";
import { Button } from "@/components/ui/button";

const AUTH_RE = /log ?in|logged in|authenticat|credential|invalid api|not.*authoriz|unauthor/i;

/** Run generation for one slug and surface a success/error toast. Returns ok. */
export async function generateWithToast(slug: string): Promise<boolean> {
  const result = await generateRow(slug);
  if (result.ok) {
    toast.success("FAQ generated", { description: slug });
    return true;
  }
  const authy = AUTH_RE.test(result.error);
  toast.error(authy ? "Claude is not logged in" : "Generation failed", {
    description: authy ? "run `claude` once in a terminal to log in" : result.error.slice(0, 200),
  });
  return false;
}

interface GenerateControlsProps {
  views: RowView[];
  autoGenerate: boolean;
  onStop: () => void;
  onChanged: () => void;
}

/**
 * When auto-generate is on, walks the not-generated rows one at a time via
 * `generateRow`, pausable (toggle off / Pause), and stops on the first error.
 */
export function GenerateControls({ views, autoGenerate, onStop, onChanged }: GenerateControlsProps) {
  const [current, setCurrent] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const runningRef = React.useRef(false);
  const stopRef = React.useRef(false);

  React.useEffect(() => {
    if (!autoGenerate) {
      stopRef.current = true;
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    const queue = views.filter((v) => v.contentState === "not-generated").map((v) => v.slug);
    setTotal(queue.length);
    setDone(0);

    (async () => {
      for (const slug of queue) {
        if (stopRef.current) break;
        setCurrent(slug);
        const ok = await generateWithToast(slug);
        onChanged();
        if (!ok) {
          onStop();
          break;
        }
        setDone((d) => d + 1);
      }
      runningRef.current = false;
      setCurrent(null);
      if (!stopRef.current) {
        toast.success("Auto-generate finished");
        onStop();
      }
    })();
    // Only (re)start the queue when the toggle flips; view refreshes must not re-enter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate]);

  if (!autoGenerate && !current) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <span className="text-foreground">
        Auto-generating{current ? ` — ${current}` : "…"}
      </span>
      <span className="tabular text-muted-foreground">
        {done}/{total}
      </span>
      <Button size="sm" variant="outline" className="ml-auto" onClick={onStop}>
        <Pause className="h-4 w-4" /> Pause
      </Button>
    </div>
  );
}
