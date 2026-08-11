"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { RowView, OverviewStats, Toggles, GenStatus } from "@/lib/types";
import { setToggles, generateRow, approveRows, approveAllGenerated } from "@/app/actions";
import { AUTH_RE } from "@/lib/gen-errors";
import { BentoOverview } from "@/components/bento-overview";
import { RowsTable } from "@/components/rows-table";
import { FaqDetailDrawer } from "@/components/faq-detail-drawer";
import { BatchPanel } from "@/components/batch-panel";
import { ResourcesTab } from "@/components/resources-tab";
import { DoctorsTab } from "@/components/doctors-tab";
import { RelationsTab } from "@/components/relations-tab";
import { ComingSoonTab } from "@/components/coming-soon-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AppShellProps {
  initial: { views: RowView[]; stats: OverviewStats; toggles: Toggles; error?: string };
}

const DEFAULT_CONCURRENCY = 3;

export function AppShell({ initial }: AppShellProps) {
  const { views, stats, toggles, error } = initial;
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const [genStatus, setGenStatus] = React.useState<Record<string, GenStatus>>({});
  const [batchKeys, setBatchKeys] = React.useState<string[] | null>(null);
  const [concurrency, setConcurrency] = React.useState(DEFAULT_CONCURRENCY);

  const refresh = React.useCallback(() => router.refresh(), [router]);
  const setStatus = React.useCallback(
    (slug: string, status: GenStatus) => setGenStatus((m) => ({ ...m, [slug]: status })),
    [],
  );

  const onToggle = (t: Toggles) => {
    startTransition(async () => {
      await setToggles(t);
      router.refresh();
    });
  };

  const onOpen = (slug: string) => {
    setSelectedSlug(slug);
    setOpen(true);
  };

  // Single-row on-demand generate — Server Action, with the same per-row live status.
  const onGenerate = (slug: string) => {
    setStatus(slug, "running");
    generateRow(slug).then(async (result) => {
      if (result.ok) {
        setStatus(slug, "done");
        if (toggles.autoApprove) await approveRows([slug], toggles.autoMove);
        toast.success(toggles.autoApprove ? "FAQ generated + approved" : "FAQ generated", { description: slug });
      } else {
        const authy = AUTH_RE.test(result.error);
        toast.error(authy ? "Claude is not logged in" : "Generation failed", {
          description: authy ? "run `claude` in a terminal to log in" : result.error.slice(0, 200),
        });
        setStatus(slug, "failed");
      }
      router.refresh();
    });
  };

  // Batch — a fresh array reference starts the streaming run in BatchPanel.
  const onRunBatch = (keys: string[]) => setBatchKeys([...keys]);

  // When the batch finishes: auto-approve the freshly-generated rows if enabled, then refresh.
  const onBatchDone = (doneSlugs: string[]) => {
    if (toggles.autoApprove && doneSlugs.length) {
      approveRows(doneSlugs, toggles.autoMove).then((n) => {
        toast.success(`Auto-approved ${n} generated ${n === 1 ? "row" : "rows"}`);
        router.refresh();
      });
    } else {
      router.refresh();
    }
  };

  // One-time bulk: approve every currently-generated (raw) row.
  const onApproveAll = () => {
    startTransition(async () => {
      const n = await approveAllGenerated(toggles.autoMove);
      toast.success(
        n ? `Approved ${n} generated ${n === 1 ? "row" : "rows"}${toggles.autoMove ? " → done" : ""}` : "Nothing to approve",
      );
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-primary">CancerFax Review</h1>
        <p className="text-sm text-muted-foreground">
          FAQ fixture review — generate, verify, approve, and move to done.
        </p>
      </header>

      <Tabs defaultValue="faqs">
        <TabsList>
          <TabsTrigger value="faqs">📋 FAQs</TabsTrigger>
          <TabsTrigger value="resources">🏷️ Resources</TabsTrigger>
          <TabsTrigger value="hospitals">🏗️🦥 Hospitals</TabsTrigger>
          <TabsTrigger value="doctors">🦆 Doctors</TabsTrigger>
          <TabsTrigger value="relations">🔗 Relations</TabsTrigger>
        </TabsList>

        <TabsContent value="faqs">
          {error ? (
            <div
              role="alert"
              className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null}

          <div className="mb-6">
            <BentoOverview stats={stats} toggles={toggles} onToggle={onToggle} />
          </div>

          {batchKeys ? (
            <div className="mb-3">
              <BatchPanel
                keys={batchKeys}
                concurrency={concurrency}
                onConcurrencyChange={setConcurrency}
                onStatus={setStatus}
                onDone={onBatchDone}
                onClose={() => {
                  setBatchKeys(null);
                  setGenStatus({});
                }}
                onRetry={onRunBatch}
              />
            </div>
          ) : null}

          <RowsTable
            views={views}
            onOpen={onOpen}
            onGenerate={onGenerate}
            genStatus={genStatus}
            onRunBatch={onRunBatch}
            onApproveAll={onApproveAll}
            batchRunning={batchKeys !== null}
          />

          <FaqDetailDrawer
            rowKey={selectedSlug}
            open={open}
            onOpenChange={setOpen}
            toggles={toggles}
            onChanged={refresh}
          />
        </TabsContent>

        <TabsContent value="resources">
          <ResourcesTab />
        </TabsContent>

        <TabsContent value="hospitals">
          <ComingSoonTab emoji="🏗️🦥" label="Hospitals" />
        </TabsContent>

        <TabsContent value="doctors">
          <DoctorsTab />
        </TabsContent>

        <TabsContent value="relations">
          <RelationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
