interface ComingSoonTabProps {
  emoji: string;
  label: string;
}

/** Placeholder for a tab that isn't wired up yet — Hospitals, Doctors. */
export function ComingSoonTab({ emoji, label }: ComingSoonTabProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
      <div className="text-4xl">{emoji}</div>
      <p className="text-sm font-medium">{label} — coming soon</p>
      <p className="text-xs text-muted-foreground">This tab isn&apos;t wired up yet.</p>
    </div>
  );
}
