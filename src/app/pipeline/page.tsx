import Link from "next/link";
import { listProperties, type PropertyRow } from "@/lib/db/properties";
import {
  STAGES,
  ASSIGNEE_OPTIONS,
  showCountdown,
} from "@/lib/services/stages";

export const dynamic = "force-dynamic";

function formatMoney(cents: number): string {
  if (cents === 0) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(date + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export default async function PipelinePage() {
  let properties: PropertyRow[] = [];
  let error: string | null = null;
  try {
    properties = await listProperties();
  } catch (err) {
    error = (err as Error).message;
  }

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        {error}
      </main>
    );
  }

  if (properties.length === 0) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        No properties yet.
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-auto p-6">
      <StageRollup properties={properties} />
      <EoiWatch properties={properties} />
      <PmWorkload properties={properties} />
    </main>
  );
}

function StageRollup({ properties }: { properties: PropertyRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Pipeline by Stage
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {STAGES.map((stage) => {
          const rows = properties.filter((p) => p.stage === stage.id);
          const purchase = rows.reduce((acc, r) => acc + (r.purchase_cents ?? 0), 0);
          const clr = rows.reduce((acc, r) => acc + (r.clr_cents ?? 0), 0);
          const reserves = rows
            .map((r) => r.reserve_pct)
            .filter((x): x is number => x !== null);
          const avgReserve = reserves.length
            ? reserves.reduce((a, b) => a + b, 0) / reserves.length
            : null;

          return (
            <div
              key={stage.id}
              className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3"
            >
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {stage.label}
              </div>
              <div className="text-2xl font-semibold leading-none">{rows.length}</div>
              <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
                <dt className="text-muted-foreground">Purchase</dt>
                <dd className="text-right">{formatMoney(purchase)}</dd>
                <dt className="text-muted-foreground">CLR</dt>
                <dd className="text-right">{formatMoney(clr)}</dd>
                <dt className="text-muted-foreground">Avg reserve</dt>
                <dd className="text-right">
                  {avgReserve != null ? `${avgReserve.toFixed(0)}%` : "—"}
                </dd>
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EoiWatch({ properties }: { properties: PropertyRow[] }) {
  type Row = { p: PropertyRow; days: number; cls: "urgent" | "warning" | "passed" | "ok" };
  const decorated: Row[] = properties
    .filter((p) => showCountdown(p.stage))
    .map((p) => {
      const d = daysUntil(p.inspect_date);
      if (d === null) return null;
      const cls: Row["cls"] =
        d < 0 ? "passed" : d <= 2 ? "urgent" : d <= 7 ? "warning" : "ok";
      return { p, days: d, cls };
    })
    .filter((x): x is Row => x !== null)
    .filter((x) => x.cls !== "ok")
    .sort((a, b) => a.days - b.days);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        EOI Watch
      </h2>
      {decorated.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No deals approaching or past EOI.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {decorated.map(({ p, days, cls }) => (
            <li key={p.id}>
              <Link
                href={`/properties/${p.slug}`}
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted"
              >
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    cls === "urgent"
                      ? "bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200"
                      : cls === "warning"
                        ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                        : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {cls === "passed"
                    ? `${-days}d ago`
                    : days === 0
                      ? "today"
                      : `in ${days}d`}
                </span>
                <span className="flex-1 text-sm">{p.address}</span>
                <span className="text-xs text-muted-foreground">
                  {p.inspect_date} · {p.assignee ?? "Unassigned"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PmWorkload({ properties }: { properties: PropertyRow[] }) {
  const stageIds = STAGES.map((s) => s.id);
  const rows = ASSIGNEE_OPTIONS.map((name) => {
    const owned = properties.filter((p) => (p.assignee ?? "Unassigned") === name);
    const purchase = owned.reduce((acc, r) => acc + (r.purchase_cents ?? 0), 0);
    const clr = owned.reduce((acc, r) => acc + (r.clr_cents ?? 0), 0);
    const byStage: Record<string, number> = {};
    for (const sid of stageIds) byStage[sid] = 0;
    for (const o of owned) byStage[o.stage] = (byStage[o.stage] ?? 0) + 1;
    return { name, count: owned.length, purchase, clr, byStage };
  });

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        PM Workload
      </h2>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">PM</th>
              <th className="px-3 py-2 text-right">Total</th>
              {STAGES.map((s) => (
                <th key={s.id} className="px-3 py-2 text-right" title={s.label}>
                  {s.label.split(" ")[0]}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Purchase</th>
              <th className="px-3 py-2 text-right">CLR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.name} className={r.count === 0 ? "text-muted-foreground" : ""}>
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-right">{r.count}</td>
                {stageIds.map((sid) => (
                  <td key={sid} className="px-3 py-2 text-right">
                    {r.byStage[sid] || ""}
                  </td>
                ))}
                <td className="px-3 py-2 text-right">{formatMoney(r.purchase)}</td>
                <td className="px-3 py-2 text-right">{formatMoney(r.clr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
