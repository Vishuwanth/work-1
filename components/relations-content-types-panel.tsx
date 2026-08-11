"use client";

import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ContentTypeInfo } from "@/lib/relation-reports";

/**
 * "What content types and relations exist" report. Field names, cardinality,
 * and target types come from the schema registry (ground truth, generated
 * from Strapi's own schema.json files — see scripts/generate-relation-schema.js);
 * this button only re-checks each type is still live and refreshes entry
 * counts (~38 cheap requests). Manual, like the Resources tab's "Fetch live
 * taxonomy" — not auto-run on tab open.
 */
export function RelationsContentTypesPanel() {
  const [contentTypes, setContentTypes] = React.useState<ContentTypeInfo[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null);

  // Always forces a live re-fetch (lib/relations/corpus-cache.js's
  // forceRefresh) — this is the one button that guarantees the Relations
  // tab's cached corpus is current, so it also warms that cache (~55-70s),
  // not just this panel's own report.
  const discover = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/relations/discover");
      const data = (await res.json()) as { contentTypes?: ContentTypeInfo[]; updatedAt?: string; error?: string };
      if (!res.ok || data.error) {
        toast.error("Discovery failed", { description: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setContentTypes(data.contentTypes ?? []);
      setUpdatedAt(data.updatedAt ?? null);
      setLoaded(true);
      toast.success(`Discovered ${data.contentTypes?.length ?? 0} content types`, {
        description: "This also refreshed the Relations tab's cached corpus.",
      });
    } catch (e) {
      toast.error("Discovery failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <Button onClick={discover} disabled={loading}>
          {loading ? "Discovering… (~1 min, refreshes the cache too)" : "Discover + refresh cache"}
        </Button>
        {loaded ? (
          <span className="text-xs text-muted-foreground">
            {contentTypes.length} content types, {contentTypes.reduce((n, t) => n + t.entryCount, 0)} entries total
            {updatedAt ? ` · updated ${new Date(updatedAt).toLocaleTimeString()}` : ""}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Re-fetches everything live from prod and overwrites the shared cache the Relations tab and every
            Run/Write batch reads from (~1 min for ~4,600 entries). The field/relation structure itself only
            changes when the schema registry is regenerated — see docs/specs.
          </span>
        )}
      </div>

      {contentTypes.length > 0 ? (
        <div className="space-y-4">
          {contentTypes.map((ct) => (
            <div key={ct.apiId} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{ct.label}</span>
                <Badge variant="outline">{ct.apiId}</Badge>
                <span className="text-xs text-muted-foreground">
                  /api/{ct.plural} · {ct.entryCount} entries · title field: {ct.titleField ?? "(none detected)"} · slug field:{" "}
                  {ct.slugField ?? "(none)"}
                </span>
              </div>

              {ct.relationFields.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">No relation fields discovered on this content type.</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Field</TableHead>
                        <TableHead>Cardinality</TableHead>
                        <TableHead>Target type</TableHead>
                        <TableHead>Relations tab can…</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ct.relationFields.map((rf) => (
                        <TableRow key={rf.field}>
                          <TableCell className="font-mono text-xs">{rf.field}</TableCell>
                          <TableCell className="text-xs">{rf.cardinality}</TableCell>
                          <TableCell className="font-mono text-xs">{rf.targetApiId}</TableCell>
                          <TableCell className="text-xs">
                            {rf.reserved ? (
                              <Badge variant="outline">owned by the Resources tab&apos;s classifier</Badge>
                            ) : rf.nonContent ? (
                              <Badge variant="outline">editorial metadata — not a content link</Badge>
                            ) : (
                              <Badge variant="secondary">propose + write</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
