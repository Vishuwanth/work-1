"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, Loader2, Pencil, X } from "lucide-react";

import type { Fixture, ReviewRecord, Toggles } from "@/lib/types";
import { cleanSlug, getSection, applyEdits, faqCount, isFaqShape } from "@/lib/fixtures";
import { getFixture, getReview, saveReview, approveRow, moveToDone } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface FaqDetailDrawerProps {
  slug: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toggles: Toggles;
  onChanged: () => void;
}

interface EditBuffer {
  answers: Record<string, string>;
  slug: string;
  route: string;
}

const stripP = (html: string) => html.replace(/^\s*<p>/i, "").replace(/<\/p>\s*$/i, "").trim();

/** Why a loaded fixture is not a usable faq section (for the inline invalid message). */
function invalidReason(fx: Fixture): string {
  const s = getSection(fx);
  if (!s) return "no section found in the fixture";
  if (s.type !== "faq") return `section type is "${s.type}", expected "faq"`;
  if (!Array.isArray(s.groups)) return "section has no groups array";
  return "unknown reason";
}

function VerifyChip({ label, raw }: { label: string; raw: string }) {
  const { value, needsVerify } = cleanSlug(raw);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {needsVerify ? (
        <Badge variant="warning" className="tabular gap-1">
          <AlertTriangle className="h-3 w-3" /> {value}
        </Badge>
      ) : (
        <code className="tabular rounded bg-muted px-1.5 py-0.5 text-foreground">{value}</code>
      )}
    </span>
  );
}

export function FaqDetailDrawer({ slug, open, onOpenChange, toggles, onChanged }: FaqDetailDrawerProps) {
  const [fixture, setFixture] = React.useState<Fixture | null>(null);
  const [record, setRecord] = React.useState<ReviewRecord | null>(null);
  const [buffer, setBuffer] = React.useState<EditBuffer>({ answers: {}, slug: "", route: "" });
  const [editing, setEditing] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open || !slug) return;
    let alive = true;
    setLoading(true);
    setEditing(false);
    Promise.all([getFixture(slug), getReview(slug)]).then(([fx, rec]) => {
      if (!alive) return;
      setFixture(fx);
      setRecord(rec);
      setBuffer({ answers: { ...rec.edits.answers }, slug: rec.edits.slug, route: rec.edits.route });
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [open, slug]);

  const section = fixture ? getSection(fixture) : null;

  const mutate = (fn: () => Promise<void>, okMsg: string) => {
    startTransition(async () => {
      try {
        await fn();
        onChanged();
        toast.success(okMsg);
      } catch (e) {
        toast.error((e as Error).message || "Action failed");
      }
    });
  };

  const onSaveEdits = () =>
    slug && mutate(() => saveReview(slug, { edits: buffer }), "Edits saved");
  const onApprove = () =>
    slug &&
    mutate(async () => {
      await saveReview(slug, { edits: buffer });
      await approveRow(slug, toggles.autoMove);
    }, toggles.autoMove ? "Approved and moved to done" : "Approved");
  const onNeedsWork = () =>
    slug && mutate(() => saveReview(slug, { reviewStatus: "needs-work" }), "Marked needs work");
  const onMove = () => slug && mutate(() => moveToDone(slug), "Moved to done");
  const onSaveNote = (note: string) =>
    slug && mutate(() => saveReview(slug, { note }), "Note saved");

  const onCopy = async () => {
    if (!fixture || !record) return;
    const corrected = applyEdits(fixture, { ...record, edits: buffer });
    try {
      await navigator.clipboard.writeText(JSON.stringify(corrected, null, 2));
      toast.success("Corrected JSON copied");
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const approved = record?.reviewStatus === "approved";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="pr-8 text-base">
            {loading ? "Loading…" : fixture ? getSection(fixture)?.h2 ?? "FAQ section" : "No fixture"}
          </SheetTitle>
          {fixture ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <VerifyChip label="slug" raw={buffer.slug || fixture.slug} />
              <VerifyChip label="route" raw={buffer.route || fixture.route} />
              {section ? (
                <span className="tabular text-xs text-muted-foreground">
                  {faqCount(fixture)} FAQs · {section.groups.length} groups
                </span>
              ) : null}
            </div>
          ) : null}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : !fixture ? (
            <p className="text-sm text-muted-foreground">
              This row has no generated fixture yet. Use Generate on the row to create one.
            </p>
          ) : !isFaqShape(fixture) || !section ? (
            <p className="text-sm text-warning">Fixture is invalid: {invalidReason(fixture)}</p>
          ) : (
            <div className="space-y-6">
              {editing ? (
                <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/40 p-3">
                  <label className="text-xs font-medium text-muted-foreground">
                    Resolved slug
                    <Input
                      className="mt-1"
                      value={buffer.slug}
                      placeholder={cleanSlug(fixture.slug).value}
                      onChange={(e) => setBuffer((b) => ({ ...b, slug: e.target.value }))}
                    />
                  </label>
                  <label className="text-xs font-medium text-muted-foreground">
                    Resolved route
                    <Input
                      className="mt-1"
                      value={buffer.route}
                      placeholder={cleanSlug(fixture.route).value}
                      onChange={(e) => setBuffer((b) => ({ ...b, route: e.target.value }))}
                    />
                  </label>
                </div>
              ) : null}

              {section.groups.map((g, gi) => (
                <div key={gi} className="space-y-3">
                  <h3 className="text-sm font-semibold text-primary">{g.title}</h3>
                  {g.items.map((it, ii) => {
                    const key = `${gi}.${ii}`;
                    return (
                      <div key={ii} className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">{it.q}</p>
                        {editing ? (
                          <Textarea
                            rows={4}
                            value={buffer.answers[key] ?? stripP(it.a)}
                            onChange={(e) =>
                              setBuffer((b) => ({ ...b, answers: { ...b.answers, [key]: e.target.value } }))
                            }
                          />
                        ) : (
                          <div
                            className="prose-sm text-sm leading-relaxed text-muted-foreground [&_p]:m-0"
                            dangerouslySetInnerHTML={{
                              __html: buffer.answers[key] != null ? `<p>${buffer.answers[key]}</p>` : it.a,
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              <div>
                <label className="text-xs font-medium text-muted-foreground">Reviewer note</label>
                <Textarea
                  rows={2}
                  className="mt-1"
                  defaultValue={record?.note ?? ""}
                  placeholder="Add a note for this row…"
                  onBlur={(e) => {
                    if (e.target.value !== (record?.note ?? "")) onSaveNote(e.target.value);
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {fixture && isFaqShape(fixture) && section ? (
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-card px-5 py-3">
            <Button size="sm" onClick={onApprove} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve
            </Button>
            {approved && !toggles.autoMove ? (
              <Button size="sm" variant="secondary" onClick={onMove} disabled={pending}>
                Move to done
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={onNeedsWork} disabled={pending}>
              Needs work
            </Button>
            <Button
              size="sm"
              variant={editing ? "default" : "outline"}
              onClick={() => (editing ? onSaveEdits() : setEditing(true))}
              disabled={pending}
            >
              {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {editing ? "Save edits" : "Edit"}
            </Button>
            {editing ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
                <X className="h-4 w-4" /> Cancel
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={onCopy}>
              <Copy className="h-4 w-4" /> Copy JSON
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
