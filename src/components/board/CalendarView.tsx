"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { labelFor, showCountdown } from "@/lib/services/stages";
import { TINT_STYLES, tintForProperty, type Tint } from "@/lib/services/property-tint";
import type { PropertyRow } from "@/lib/db/properties";

interface CalendarEntry {
  id: string;
  slug: string;
  address: string;
  assignee: string;
  stageLabel: string;
  stageId: string;
  inspect: string;
  tint: Tint;
}

function ymdKey(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function buildEntries(properties: PropertyRow[]): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const p of properties) {
    if (!showCountdown(p.stage)) continue;
    if (!p.inspect_date) continue;
    out.push({
      id: p.id,
      slug: p.slug,
      address: p.address,
      assignee: p.assignee ?? "Unassigned",
      stageLabel: labelFor(p.stage),
      stageId: p.stage,
      inspect: p.inspect_date,
      tint: tintForProperty(p.stage, p.inspect_date),
    });
  }
  return out;
}

export function CalendarView({ properties }: { properties: PropertyRow[] }) {
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const entries = useMemo(() => buildEntries(properties), [properties]);
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      const list = m.get(e.inspect) ?? [];
      list.push(e);
      m.set(e.inspect, list);
    }
    return m;
  }, [entries]);

  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = lastOfMonth.getDate();

  const cells: Array<{ date: Date | null }> = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ date: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month, d) });
  while (cells.length % 7 !== 0) cells.push({ date: null });

  const todayKey = ymdKey(new Date());
  const monthLabel = anchor.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  function step(months: number) {
    setAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + months, 1));
  }

  function goToday() {
    const now = new Date();
    setAnchor(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          aria-label="Previous month"
        >
          ‹ Prev
        </button>
        <h3 className="px-2 text-base font-semibold">{monthLabel}</h3>
        <button
          type="button"
          onClick={() => step(1)}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          aria-label="Next month"
        >
          Next ›
        </button>
        <button
          type="button"
          onClick={goToday}
          className="ml-2 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          Today
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Legend label="Past due" cls={TINT_STYLES.passed.dot} />
          <Legend label="≤1 day" cls={TINT_STYLES.urgent.dot} />
          <Legend label="2–3 days" cls={TINT_STYLES.warning.dot} />
          <Legend label="4+ days" cls={TINT_STYLES.healthy.dot} />
        </div>
      </div>

      <div className="grid flex-1 grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] gap-px overflow-hidden rounded-lg bg-border">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="bg-card px-2 py-1 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c.date) {
            return <div key={`pad-${i}`} className="bg-background/60" />;
          }
          const key = ymdKey(c.date);
          const events = byDate.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={`flex min-h-[100px] flex-col gap-1 overflow-y-auto bg-background p-1.5 ${
                isToday ? "ring-2 ring-inset ring-primary" : ""
              }`}
            >
              <div
                className={`text-xs ${
                  isToday ? "font-semibold text-primary" : "text-muted-foreground"
                }`}
              >
                {c.date.getDate()}
              </div>
              <div className="flex flex-col gap-1">
                {events.map((e) => {
                  const style = TINT_STYLES[e.tint];
                  return (
                    <Link
                      key={e.id}
                      href={`/properties/${e.slug}`}
                      title={`${e.address} — ${e.stageLabel} — ${e.assignee}`}
                      className={`block rounded border-l-4 px-1.5 py-1 text-[11px] leading-tight transition-all hover:brightness-95 ${style.bg} ${style.label}`}
                      style={{ borderLeftColor: "currentColor" }}
                    >
                      <div className="truncate font-medium text-foreground">{e.address}</div>
                      <div className="truncate">{e.assignee}</div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ label, cls }: { label: string; cls: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}
