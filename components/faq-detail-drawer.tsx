"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, Pencil, X } from "lucide-react";

import type { Fixture, ReviewRecord, Toggles } from "@/lib/types";
import { getSection, applyEdits, faqCount, isFaqShape } from "@/lib/fixtures";
import { getFixture, getReview, saveReview, approveRow, moveToDone, moveBack } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface FaqDetailDrawerProps {
  /** "collection/slug" — the page identity. */
  rowKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toggles: Toggles;
  onChanged: () => void;
}

interface EditBuffer {
  answers: Record<string, string>;
}

const stripP = (html: string) => html.replace(/^\s*<p>/i, "").replace(/<\/p>\s*$/i, "").trim();

/**
 * Answer HTML comes from our own generation pipeline (a single trusted `<p>…</p>`),
 * so it's not attacker-controlled. Still, as defense-in-depth before injecting it,
 * strip any <script> blocks and inline event handlers.
 */
function sanitizeAnswerHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/** Why a loaded fixture is not a usable faq section (for the inline invalid message). */
function invalidReason(fx: Fixture): string {
  const s = getSection(fx);
  if (!s) return "no section found in the fixture";
  if (s.type !== "faq") return `section type is "${s.type}", expected "faq"`;
  if (!Array.isArray(s.groups)) return "section has no groups array";
  return "unknown reason";
}

/** Slug and route come from the live-site CSV, so they are shown, never edited. */
function FieldChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <code className="tabular rounded bg-muted px-1.5 py-0.5 text-foreground">{value}</code>
    </span>
  );
}

export function FaqDetailDrawer({ rowKey, open, onOpenChange, toggles, onChanged }: FaqDetailDrawerProps) {
  const [fixture, setFixture] = React.useState<Fixture | null>(null);
  const [record, setRecord] = React.useState<ReviewRecord | null>(null);
  const [buffer, setBuffer] = React.useState<EditBuffer>({ answers: {} });
  const [editing, setEditing] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open || !rowKey) return;
    let alive = true;
    setLoading(true);
    setEditing(false);
    Promise.all([getFixture(rowKey), getReview(rowKey)]).then(([fx, rec]) => {
      if (!alive) return;
      setFixture(fx);
      setRecord(rec);
      setBuffer({ answers: { ...rec.edits.answers } });
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [open, rowKey]);

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
    rowKey && mutate(() => saveReview(rowKey, { edits: buffer }), "Edits saved");
  const onApprove = () =>
    rowKey &&
    mutate(async () => {
      await saveReview(rowKey, { edits: buffer });
      await approveRow(rowKey, toggles.autoMove);
    }, toggles.autoMove ? "Approved and moved to done" : "Approved");
  const onNeedsWork = () =>
    rowKey && mutate(() => saveReview(rowKey, { reviewStatus: "needs-work" }), "Marked needs work");
  const onMove = () => rowKey && mutate(() => moveToDone(rowKey), "Moved to done");
  const onMoveBack = () =>
    rowKey && mutate(() => moveBack(rowKey), "Moved back to raw (un-approved)");
  const onSaveNote = (note: string) =>
    rowKey && mutate(() => saveReview(rowKey, { note }), "Note saved");

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
              <FieldChip label="slug" value={fixture.slug} />
              <FieldChip label="route" value={fixture.route} />
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
                              __html: sanitizeAnswerHtml(
                                buffer.answers[key] != null ? `<p>${buffer.answers[key]}</p>` : it.a,
                              ),
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
            {approved ? (
              <Button size="sm" variant="outline" onClick={onMoveBack} disabled={pending}>
                Move back to raw
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
