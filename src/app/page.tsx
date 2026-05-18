import { ViewSwitcher } from "@/components/board/ViewSwitcher";
import { RefreshButton } from "@/components/board/RefreshButton";
import { SyncButton } from "@/components/board/SyncButton";
import { FilterBar } from "@/components/board/FilterBar";
import { listProperties, type PropertyRow } from "@/lib/db/properties";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ assignee?: string; exec?: string }>;
}) {
  const { assignee, exec } = await searchParams;
  let properties: PropertyRow[] = [];
  let error: string | null = null;
  try {
    properties = await listProperties();
  } catch (err) {
    error = (err as Error).message;
  }

  let filtered = properties;
  if (assignee) {
    filtered = filtered.filter((p) => (p.assignee ?? "Unassigned") === assignee);
  }
  if (exec) {
    filtered = filtered.filter((p) => (p.exec_reviewer ?? "Unassigned") === exec);
  }

  if (error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div className="max-w-xl rounded-lg border border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950/40">
          <div className="font-medium text-amber-900 dark:text-amber-200">Database not ready</div>
          <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">{error}</p>
          <p className="mt-2 text-amber-900/80 dark:text-amber-200/80">
            Apply the schema with <code className="rounded bg-amber-200/40 px-1">npm run db:migrate</code>{" "}
            and import legacy data with{" "}
            <code className="rounded bg-amber-200/40 px-1">npm run db:import-tasks:write</code>.
          </p>
        </div>
      </main>
    );
  }

  if (properties.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No properties yet. Import legacy data with{" "}
          <code className="rounded bg-foreground/10 px-1">npm run db:import-tasks:write</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {filtered.length} of {properties.length}{" "}
          {properties.length === 1 ? "property" : "properties"}
          {assignee && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
              {assignee}
            </span>
          )}
          {exec && (
            <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">
              Exec: {exec}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <RefreshButton />
          <SyncButton />
        </div>
      </header>
      <FilterBar />
      <ViewSwitcher properties={filtered} />
    </main>
  );
}
