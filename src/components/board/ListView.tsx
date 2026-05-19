import Link from "next/link";
import {
  ASSIGNEE_OPTIONS,
  EXEC_OPTIONS,
  STAGES,
  isExecReviewStage,
  showCountdown,
} from "@/lib/services/stages";
import {
  TINT_STYLES,
  daysUntil,
  formatInspectDate,
  tintForProperty,
} from "@/lib/services/property-tint";
import type { PropertyRow } from "@/lib/db/properties";
import { PersonPicker } from "./PersonPicker";

function formatMoney(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function ListView({ properties }: { properties: PropertyRow[] }) {
  const byStage = new Map<string, PropertyRow[]>();
  for (const s of STAGES) byStage.set(s.id, []);
  for (const p of properties) {
    const bucket = byStage.get(p.stage);
    if (bucket) bucket.push(p);
    else byStage.set(p.stage, [p]);
  }

  return (
    <div className="flex flex-col gap-6 overflow-auto p-4">
      {STAGES.map((stage) => {
        const items = byStage.get(stage.id) ?? [];
        if (items.length === 0) return null;
        const showExec = isExecReviewStage(stage.id);
        return (
          <section key={stage.id} className="flex flex-col gap-2">
            <header className="flex items-baseline justify-between px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>{stage.label}</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                {items.length}
              </span>
            </header>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Address</th>
                    <th className="px-3 py-2 text-right">Purchase</th>
                    <th className="px-3 py-2 text-right">CLR</th>
                    <th className="px-3 py-2 text-right">Reserve</th>
                    <th className="px-3 py-2 text-left">Inspect</th>
                    <th className="px-3 py-2 text-left">Assignee</th>
                    {showExec && <th className="px-3 py-2 text-left">Exec</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((p) => {
                    const countdown = showCountdown(p.stage) ? daysUntil(p.inspect_date) : null;
                    const tint =
                      TINT_STYLES[
                        tintForProperty(
                          p.stage,
                          p.inspect_date,
                          p.renovation_completed_at,
                          p.addendum_sent_at,
                        )
                      ];
                    return (
                      <tr key={p.id} className={`${tint.bg} hover:brightness-95`}>
                        <td className="relative px-3 py-2 pl-4">
                          <span
                            className={`absolute inset-y-0 left-0 w-1 ${tint.dot}`}
                            aria-hidden
                          />
                          <Link
                            href={`/properties/${p.slug}`}
                            className="font-medium hover:underline"
                          >
                            {p.address}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right">{formatMoney(p.purchase_cents)}</td>
                        <td className="px-3 py-2 text-right">{formatMoney(p.clr_cents)}</td>
                        <td className="px-3 py-2 text-right">
                          {p.reserve_pct != null ? `${p.reserve_pct}%` : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {formatInspectDate(p.inspect_date)}
                          {countdown !== null && (
                            <span className={`ml-2 text-xs font-medium ${tint.label}`}>
                              ({countdown < 0
                                ? `${-countdown}d ago`
                                : countdown === 0
                                  ? "today"
                                  : `in ${countdown}d`})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <PersonPicker
                            slug={p.slug}
                            field="assignee"
                            value={p.assignee}
                            options={ASSIGNEE_OPTIONS}
                            ariaLabel="Assignee"
                          />
                        </td>
                        {showExec && (
                          <td className="px-3 py-2">
                            <PersonPicker
                              slug={p.slug}
                              field="exec_reviewer"
                              value={p.exec_reviewer}
                              options={EXEC_OPTIONS}
                              ariaLabel="Exec reviewer"
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
