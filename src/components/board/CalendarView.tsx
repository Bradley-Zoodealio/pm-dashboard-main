"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { labelFor, showCountdown } from "@/lib/services/stages";
import {
  TINT_STYLES,
  tintForProperty,
  tintForAddendumDeadline,
  type Tint,
} from "@/lib/services/property-tint";
import type { PropertyRow } from "@/lib/db/properties";

// One pin on one day. EOI entries are anchored to inspect_date; addendum
// entries are anchored to the 5-day deadline (sent + 5 calendar days).
interface CalendarEntry {
  id: string;
  slug: string;
  address: string;
  assignee: string;
  source: "eoi" | "addendum";
  kind: "eoi" | "addendum-deadline";
  // YMD key in local time.
  dateKey: string;
  // Shown on the deadline pin's second line so the PM can see when the
  // 5-day clock started at a glance.
  sentDateLabel?: string;
  tint: Tint;
  // Stage label for the EOI pin's tooltip (unchanged from the prior view).
  stageLabel?: string;
}

const ADDENDUM_WINDOW_DAYS = 5;

function ymdKey(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function daysUntilLocal(targetIsoDay: string): number {
  const target = new Date(targetIsoDay + "T00:00:00");
  if (Number.isNaN(target.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function ymdFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return ymdKey(d);
}

function shortMonthDay(ymd: string): string {
  const d = new Date(ymd + "T00:00:00");
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(ymd + "T00:00:00");
  if (Number.isNaN(d.getTime())) return ymd;
  d.setDate(d.getDate() + days);
  return ymdKey(d);
}

function buildEoiEntries(properties: PropertyRow[]): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const p of properties) {
    if (!showCountdown(p.stage)) continue;
    if (!p.inspect_date) continue;
    out.push({
      id: `eoi:${p.id}`,
      slug: p.slug,
      address: p.address,
      assignee: p.assignee ?? "Unassigned",
      source: "eoi",
      kind: "eoi",
      dateKey: p.inspect_date,
      tint: tintForProperty(p.stage, p.inspect_date),
      stageLabel: labelFor(p.stage),
    });
  }
  return out;
}

function buildAddendumEntries(properties: PropertyRow[]): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const p of properties) {
    if (p.stage !== "addendum-sent") continue;
    if (!p.addendum_sent_at) continue;
    if (p.cancelled_at) continue;
    const sentYmd = ymdFromIso(p.addendum_sent_at);
    if (!sentYmd) continue;
    const deadlineYmd = addDaysYmd(sentYmd, ADDENDUM_WINDOW_DAYS);
    const daysOut = daysUntilLocal(deadlineYmd);
    out.push({
      id: `addendum-deadline:${p.id}`,
      slug: p.slug,
      address: p.address,
      assignee: p.assignee ?? "Unassigned",
      source: "addendum",
      kind: "addendum-deadline",
      dateKey: deadlineYmd,
      sentDateLabel: shortMonthDay(sentYmd),
      tint: tintForAddendumDeadline(daysOut),
    });
  }
  return out;
}

type ShowSet = { eoi: boolean; addendum: boolean };

// `?show=eoi,addendum` — both default to active when absent. An empty value
// (`?show=`) renders nothing, which is intentional: users can mute both
// streams without losing the URL contract.
function parseShow(param: string | null): ShowSet {
  if (param === null) return { eoi: true, addendum: true };
  const parts = new Set(param.split(",").map((s) => s.trim()).filter(Boolean));
  return { eoi: parts.has("eoi"), addendum: parts.has("addendum") };
}

function showToParam(show: ShowSet): string | null {
  if (show.eoi && show.addendum) return null; // omit the param entirely
  const parts: string[] = [];
  if (show.eoi) parts.push("eoi");
  if (show.addendum) parts.push("addendum");
  return parts.join(",");
}

export function CalendarView({ properties }: { properties: PropertyRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const show = useMemo(
    () => parseShow(searchParams.get("show")),
    [searchParams],
  );

  function toggleShow(key: "eoi" | "addendum") {
    const next: ShowSet = { ...show, [key]: !show[key] };
    const params = new URLSearchParams(searchParams.toString());
    const v = showToParam(next);
    if (v === null) params.delete("show");
    else params.set("show", v);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }

  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const eoiEntries = useMemo(() => buildEoiEntries(properties), [properties]);
  const addendumEntries = useMemo(
    () => buildAddendumEntries(properties),
    [properties],
  );

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    const all: CalendarEntry[] = [];
    if (show.eoi) all.push(...eoiEntries);
    if (show.addendum) all.push(...addendumEntries);
    for (const e of all) {
      const list = m.get(e.dateKey) ?? [];
      list.push(e);
      m.set(e.dateKey, list);
    }
    return m;
  }, [eoiEntries, addendumEntries, show]);

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
        <div className="ml-auto flex items-center gap-2 text-xs">
          <FilterPill
            label="EOI"
            active={show.eoi}
            activeDotCls="bg-sky-500"
            onClick={() => toggleShow("eoi")}
          />
          <FilterPill
            label="Addendum"
            active={show.addendum}
            activeDotCls="bg-indigo-500"
            onClick={() => toggleShow("addendum")}
          />
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
                {events.map((e) => (
                  <PinLink key={e.id} entry={e} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PinLink({ entry }: { entry: CalendarEntry }) {
  const style = TINT_STYLES[entry.tint];
  if (entry.kind === "addendum-deadline") {
    return (
      <Link
        href={`/properties/${entry.slug}`}
        title={`Addendum deadline · ${entry.assignee} · sent ${entry.sentDateLabel}`}
        className={`block rounded border-l-4 px-1.5 py-1 text-[11px] leading-tight transition-all hover:brightness-95 ${style.bg} ${style.label}`}
        style={{ borderLeftColor: "currentColor" }}
      >
        <div className="truncate font-medium text-foreground">{entry.address}</div>
        <div className="truncate">
          {entry.assignee} · Sent {entry.sentDateLabel}
        </div>
      </Link>
    );
  }
  // EOI
  return (
    <Link
      href={`/properties/${entry.slug}`}
      title={`${entry.address} — ${entry.stageLabel ?? ""} — ${entry.assignee}`}
      className={`block rounded border-l-4 px-1.5 py-1 text-[11px] leading-tight transition-all hover:brightness-95 ${style.bg} ${style.label}`}
      style={{ borderLeftColor: "currentColor" }}
    >
      <div className="truncate font-medium text-foreground">{entry.address}</div>
      <div className="truncate">{entry.assignee}</div>
    </Link>
  );
}

function FilterPill({
  label,
  active,
  activeDotCls,
  onClick,
}: {
  label: string;
  active: boolean;
  activeDotCls: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors ${
        active
          ? "border-border bg-card text-foreground"
          : "border-border bg-background text-muted-foreground line-through decoration-muted-foreground/50"
      }`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-sm ${active ? activeDotCls : "bg-muted-foreground/40"}`}
      />
      {label}
    </button>
  );
}
