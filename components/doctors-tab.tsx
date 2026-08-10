"use client";

import * as React from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

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

interface DoctorCard {
  slug: string;
  name: string;
  siteName: string;
  department: string;
  qualification: string;
  designation: string;
  chips: string[];
  photo: string;
  bytes: number;
  width: number;
  height: number;
  origin: string;
  profile: string;
}

const ALL = "all";

function DoctorTile({ doctor }: { doctor: DoctorCard }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary/40">
      {/* Sources vary from 124x178 to 3648x5472, all near 2:3 — a fixed box keeps the grid even. */}
      <div className="relative aspect-[2/3] bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static file already on disk, 124x178 to 3648x5472; next/image would add a resize pipeline this grid does not need */}
        <img
          src={doctor.photo}
          alt={doctor.name}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <p className="text-sm font-semibold leading-tight">{doctor.name}</p>
          {doctor.qualification ? (
            <p className="text-xs text-muted-foreground">{doctor.qualification}</p>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">{doctor.department}</p>

        {doctor.width ? (
          <p className="text-[10px] tabular-nums text-muted-foreground">
            {doctor.width}×{doctor.height}
            {doctor.origin === "chinese" ? " · sysucc.org.cn" : " · english.sysucc.org.cn"}
          </p>
        ) : null}

        {doctor.chips.length ? (
          <div className="flex flex-wrap gap-1">
            {doctor.chips.slice(0, 3).map((chip) => (
              <Badge key={chip} variant="secondary" className="text-[10px] font-normal">
                {chip}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="mt-auto flex items-center gap-1 pt-1">
          <Button asChild size="sm" variant="outline" className="flex-1">
            <a href={doctor.photo} download={doctor.slug}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {(doctor.bytes / 1024).toFixed(0)} KB
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost" title={`Source profile — ${doctor.siteName}`}>
            <a href={doctor.profile} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The 51 SYSUCC portraits, joined to their fixtures by slug.
 *
 * Everything on a card except the photo comes from `sun yat sen doctors/extracted/`.
 * The photo's source and profile URL travel with it in data/doctor-photos.json, so
 * any image here can be traced back to the page it came from.
 */
export function DoctorsTab() {
  const [doctors, setDoctors] = React.useState<DoctorCard[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [department, setDepartment] = React.useState(ALL);
  const [zipping, setZipping] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/doctors/list");
        const data = (await res.json()) as { doctors?: DoctorCard[]; error?: string };
        if (!res.ok || data.error) {
          setError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        setDoctors(data.doctors ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const departments = React.useMemo(
    () => Array.from(new Set(doctors.map((d) => d.department))).sort(),
    [doctors],
  );

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return doctors.filter((d) => {
      if (department !== ALL && d.department !== department) return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        d.siteName.toLowerCase().includes(q) ||
        d.department.toLowerCase().includes(q) ||
        d.chips.some((c) => c.toLowerCase().includes(q))
      );
    });
  }, [doctors, query, department]);

  /**
   * Fetched as a blob rather than a plain link so a failed zip surfaces its JSON
   * error as a toast, instead of the browser silently saving the error body.
   */
  const downloadAll = React.useCallback(async () => {
    setZipping(true);
    try {
      const res = await fetch("/api/doctors/zip");
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sysucc-doctor-photos.zip";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${doctors.length} photos`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setZipping(false);
    }
  }, [doctors.length]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading portraits…
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, department or speciality…"
          className="w-[280px]"
        />

        <Select value={department} onValueChange={setDepartment}>
          <SelectTrigger className="w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments ({doctors.length})</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {shown.length} of {doctors.length}
        </span>

        <Button onClick={downloadAll} disabled={zipping} className="ml-auto" size="sm">
          {zipping ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-3.5 w-3.5" />
          )}
          Download all ({doctors.length})
        </Button>
      </div>

      {shown.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((d) => (
            <DoctorTile key={d.slug} doctor={d} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          No doctors match that filter.
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Portraits from Sun Yat-sen University Cancer Center. Each card links to its source
        profile. Re-fetch with{" "}
        <code className="rounded bg-muted px-1 py-0.5">node scripts/fetch-doctor-photos.js</code>.
      </p>
    </div>
  );
}
