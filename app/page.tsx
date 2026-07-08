import { loadAll } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { views, stats, toggles } = await loadAll();
  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="text-2xl font-bold text-primary">CancerFax Review</h1>
      <p className="text-muted-foreground">{views.length} rows loaded</p>
      <pre className="tabular mt-4 rounded-md bg-muted p-4 text-xs">
        {JSON.stringify({ stats, toggles }, null, 2)}
      </pre>
    </main>
  );
}
