"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface FieldStatus {
  field: string;
  isSet: boolean;
  masked: string;
}

const FIELD_LABELS: Record<string, string> = {
  "prod.token": "Prod API token",
  adminEmail: "Admin email",
  adminPassword: "Admin password",
};

function CredentialRow({ status, onSaved }: { status: FieldStatus; onSaved: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [revealed, setRevealed] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [revealing, setRevealing] = React.useState(false);

  const label = FIELD_LABELS[status.field] ?? status.field;

  const save = async () => {
    if (!value) return;
    setSaving(true);
    try {
      const res = await fetch("/api/resources/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: status.field, value }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) {
        toast.error("Save failed", { description: data.error ?? `HTTP ${res.status}` });
        return;
      }
      toast.success(`${label} saved (encrypted)`);
      setValue("");
      setEditing(false);
      setRevealed(null);
      onSaved();
    } catch (e) {
      toast.error("Save failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const reveal = async () => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    setRevealing(true);
    try {
      const res = await fetch("/api/resources/credentials/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: status.field }),
      });
      const data = (await res.json()) as { value?: string; error?: string };
      if (!res.ok || data.error) {
        toast.error("Reveal failed", { description: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setRevealed(data.value || "(empty)");
    } catch (e) {
      toast.error("Reveal failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRevealing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0">
      <div className="w-40 shrink-0 text-sm font-medium">{label}</div>
      <div className="min-w-[180px] flex-1 font-mono text-sm text-muted-foreground">
        {revealed !== null ? revealed : status.masked}
      </div>
      <Button size="sm" variant="outline" disabled={!status.isSet || revealing} onClick={reveal}>
        {revealed !== null ? "Hide" : revealing ? "Revealing…" : "Reveal"}
      </Button>
      {editing ? (
        <>
          <Input
            type="password"
            placeholder={`New ${label.toLowerCase()}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-56"
          />
          <Button size="sm" onClick={save} disabled={saving || !value}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setValue("");
            }}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
          {status.isSet ? "Update" : "Set"}
        </Button>
      )}
    </div>
  );
}

/**
 * Encrypted-at-rest Strapi credentials (staging/prod API tokens, admin
 * email+password). Ciphertext lives in data/strapi-credentials.enc.json,
 * which is safe to commit to this private repo — only whoever has
 * RESOURCES_SECRET_KEY (in .env.local, never committed) can decrypt it,
 * whether reading the file directly or via the Reveal button below.
 */
export function CredentialsPanel() {
  const [fields, setFields] = React.useState<FieldStatus[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/resources/credentials");
      const data = (await res.json()) as { fields?: FieldStatus[]; error?: string };
      if (!res.ok || data.error) {
        setLoadError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setFields(data.fields ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <p className="text-sm font-medium">Strapi credentials (encrypted at rest)</p>
        <p className="text-xs text-muted-foreground">
          AES-256-GCM encrypted in <code className="rounded bg-muted px-1 py-0.5">data/strapi-credentials.enc.json</code> —
          safe to commit to this private repo. Only whoever has{" "}
          <code className="rounded bg-muted px-1 py-0.5">RESOURCES_SECRET_KEY</code> (in{" "}
          <code className="rounded bg-muted px-1 py-0.5">.env.local</code>, never committed) can decrypt these values,
          here or anywhere else. The prod token is required for Run/Write to work at all. Admin email + password are
          optional — when set, writes log in as that admin so Strapi&apos;s edit history attributes the change to
          them instead of whoever generated the API token.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div>
          {fields.map((f) => (
            <CredentialRow key={f.field} status={f} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}
