import { PropertyCard } from "./PropertyCard";
import { STAGES, type StageId } from "@/lib/services/stages";
import type { PropertyRow } from "@/lib/db/properties";

export function Board({ properties }: { properties: PropertyRow[] }) {
  const byStage = new Map<string, PropertyRow[]>();
  for (const s of STAGES) byStage.set(s.id, []);
  for (const p of properties) {
    const bucket = byStage.get(p.stage);
    if (bucket) bucket.push(p);
    else byStage.set(p.stage, [p]);
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {STAGES.map((stage) => {
        const items = byStage.get(stage.id) ?? [];
        return (
          <Column key={stage.id} stageId={stage.id} label={stage.label} count={items.length}>
            {items.map((p) => (
              <PropertyCard key={p.id} property={p} />
            ))}
          </Column>
        );
      })}
    </div>
  );
}

function Column({
  stageId,
  label,
  count,
  children,
}: {
  stageId: StageId;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section
      data-stage={stageId}
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-border bg-card p-2 shadow-sm"
    >
      <header className="flex items-center justify-between rounded-md bg-[color:var(--brand-blue-tint)] px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--brand-blue)]">
        <span>{label}</span>
        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
          {count}
        </span>
      </header>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}
