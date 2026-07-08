import { loadAll } from "@/app/actions";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initial = await loadAll();
  return <AppShell initial={initial} />;
}
