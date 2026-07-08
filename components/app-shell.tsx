"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import type { RowView, OverviewStats, Toggles } from "@/lib/types";
import { setToggles } from "@/app/actions";
import { BentoOverview } from "@/components/bento-overview";
import { RowsTable } from "@/components/rows-table";
import { FaqDetailDrawer } from "@/components/faq-detail-drawer";
import { GenerateControls, generateWithToast } from "@/components/generate-controls";

interface AppShellProps {
  initial: { views: RowView[]; stats: OverviewStats; toggles: Toggles; error?: string };
}

export function AppShell({ initial }: AppShellProps) {
  const { views, stats, toggles, error } = initial;
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const refresh = React.useCallback(() => router.refresh(), [router]);

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

  const onGenerate = (slug: string) => {
    generateWithToast(slug).then(() => router.refresh());
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-primary">CancerFax Review</h1>
        <p className="text-sm text-muted-foreground">
          FAQ fixture review — generate, verify, approve, and move to done.
        </p>
      </header>

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

      <div className="mb-3">
        <GenerateControls
          views={views}
          autoGenerate={toggles.autoGenerate}
          onStop={() => onToggle({ ...toggles, autoGenerate: false })}
          onChanged={refresh}
        />
      </div>

      <RowsTable views={views} onOpen={onOpen} onGenerate={onGenerate} />

      <FaqDetailDrawer
        slug={selectedSlug}
        open={open}
        onOpenChange={setOpen}
        toggles={toggles}
        onChanged={refresh}
      />
    </div>
  );
}
