"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { fetchBucketDetail, fetchPhrasingOccurrences } from "@/lib/actions/bid-aggregates";
import { quickAddPhrasingAction } from "@/lib/actions/bid-drafts";
import type {
  BucketDetail,
  BucketSummary,
  LineItemOccurrence,
} from "@/lib/db/bid-aggregates";

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtRange(min: number | null, max: number | null): string {
  if (min == null || max == null) return "—";
  if (min === max) return fmtMoney(min);
  return `${fmtMoney(min)}–${fmtMoney(max)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

interface Props {
  buckets: BucketSummary[];
}

type AreaFilter = "all" | "kitchen" | "bathroom" | "interior" | "mechanical" | "exterior" | "demo" | "misc";

const AREA_CHIPS: Array<{ value: AreaFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bathroom", label: "Bathroom" },
  { value: "interior", label: "Interior" },
  { value: "mechanical", label: "Mechanical" },
  { value: "exterior", label: "Exterior" },
  { value: "demo", label: "Demo" },
  { value: "misc", label: "Misc" },
];

export function BucketGrid({ buckets }: Props) {
  const [query, setQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState<AreaFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Map<string, BucketDetail>>(new Map());
  const [drawerPhrasing, setDrawerPhrasing] = useState<string | null>(null);
  const [drawerOccurrences, setDrawerOccurrences] = useState<LineItemOccurrence[]>([]);
  const [toast, setToast] = useState<{ message: string; draftId: string } | null>(null);
  const [, startTransition] = useTransition();

  const q = query.trim().toLowerCase();

  // Counts per area for chip badges.
  const areaCounts = useMemo(() => {
    const m: Record<string, number> = { all: buckets.length };
    for (const b of buckets) m[b.area] = (m[b.area] ?? 0) + 1;
    return m;
  }, [buckets]);

  const filteredBuckets = useMemo(() => {
    let result = buckets;
    if (areaFilter !== "all") {
      result = result.filter((b) => b.area === areaFilter);
    }
    if (q.length >= 2) {
      result = result.filter((b) => {
        if (b.name.toLowerCase().includes(q)) return true;
        const detail = details.get(b.name);
        if (!detail) return false;
        return detail.phrasings.some((p) => p.description.includes(q));
      });
    }
    return result;
  }, [buckets, areaFilter, q, details]);

  function toggle(expandKey: string, detailBucketName?: string | null) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(expandKey)) {
        next.delete(expandKey);
        return next;
      }
      next.add(expandKey);
      return next;
    });
    // Some toggles are for parent group headers (multi-member groups) — those
    // don't have a bucket to fetch detail for.
    if (detailBucketName && !details.has(detailBucketName)) {
      startTransition(async () => {
        const detail = await fetchBucketDetail(detailBucketName);
        setDetails((prev) => new Map(prev).set(detailBucketName, detail));
      });
    }
  }

  async function openDrawer(phrasing: string) {
    setDrawerPhrasing(phrasing);
    setDrawerOccurrences([]);
    const occurrences = await fetchPhrasingOccurrences(phrasing);
    setDrawerOccurrences(occurrences);
  }

  async function copyPhrasing(phrasing: string) {
    try {
      await navigator.clipboard.writeText(titleCase(phrasing));
    } catch {
      /* no-op; clipboard may be unavailable */
    }
  }

  async function quickAdd(phrasing: string, medianCents: number | null) {
    const result = await quickAddPhrasingAction(titleCase(phrasing), medianCents);
    setToast({
      message: result.createdNew
        ? `Added to new draft "${result.draftTitle}"`
        : `Added to draft "${result.draftTitle}"`,
      draftId: result.draftId,
    });
  }

  // Group filtered buckets under their `group` (Kitchen, Bathroom, or own name).
  // Members within each group are sorted by total spend desc to surface the
  // most relevant categories first when the group is expanded.
  const groupedFilteredBuckets = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        members: BucketSummary[];
        itemCount: number;
        bidCount: number;
        totalSpend: number;
        avgPerItem: number;
      }
    >();
    for (const b of filteredBuckets) {
      const key = b.group;
      if (!map.has(key)) {
        map.set(key, {
          name: key,
          members: [],
          itemCount: 0,
          bidCount: 0,
          totalSpend: 0,
          avgPerItem: 0,
        });
      }
      const g = map.get(key)!;
      g.members.push(b);
      g.itemCount += b.itemCount;
      // bidCount across members is best-effort: sum of per-bucket bidCount may
      // double-count bids that span multiple member buckets (rare in practice).
      g.bidCount += b.bidCount;
      g.totalSpend += b.totalSpend;
    }
    const groups = Array.from(map.values()).map((g) => ({
      ...g,
      members: g.members.slice().sort((a, b) => b.totalSpend - a.totalSpend),
      avgPerItem: g.itemCount > 0 ? g.totalSpend / g.itemCount : 0,
    }));
    return groups.sort((a, b) => b.totalSpend - a.totalSpend);
  }, [filteredBuckets]);

  // When the user searches, auto-expand any bucket that has a phrasing match,
  // even if we haven't loaded its detail yet.
  const autoExpand = useMemo(() => {
    if (q.length < 2) return new Set<string>();
    const matches = new Set<string>();
    for (const [name, detail] of details) {
      if (detail.phrasings.some((p) => p.description.includes(q))) matches.add(name);
    }
    return matches;
  }, [q, details]);

  // When the user starts searching, lazy-load every bucket's detail so phrasing
  // matches in unexpanded buckets surface in `autoExpand`.
  useEffect(() => {
    if (q.length < 2) return;
    for (const b of buckets) {
      if (details.has(b.name)) continue;
      startTransition(async () => {
        const detail = await fetchBucketDetail(b.name);
        setDetails((prev) => {
          if (prev.has(b.name)) return prev;
          return new Map(prev).set(b.name, detail);
        });
      });
    }
  }, [q, buckets, details, startTransition]);

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search phrasings or category names — e.g. shaker, lvp, recaulk"
        className="h-9 rounded border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />

      <div className="flex flex-wrap gap-1">
        {AREA_CHIPS.map((chip) => {
          const count = areaCounts[chip.value] ?? 0;
          if (chip.value !== "all" && count === 0) return null;
          const active = areaFilter === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => setAreaFilter(chip.value)}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "border-foreground bg-foreground text-background"
                  : "border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              {chip.label}
              <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        {groupedFilteredBuckets.map((group) => {
          const isSingle = group.members.length === 1;
          const singleBucket = isSingle ? group.members[0] : null;
          // For single-member groups, the group expand IS the bucket expand —
          // we use the bucket name as the toggle key so the user gets one click
          // straight to phrasings.
          const expandKey = singleBucket?.name ?? `group:${group.name}`;
          const isOpen = expanded.has(expandKey) || (singleBucket != null && autoExpand.has(singleBucket.name));
          const detail = singleBucket ? details.get(singleBucket.name) : null;

          return (
            <article
              key={group.name}
              className="flex flex-col rounded-lg border border-border bg-card"
            >
              <button
                type="button"
                onClick={() => toggle(expandKey, singleBucket?.name)}
                className="flex items-center gap-4 px-4 py-3 text-left hover:bg-accent/40"
              >
                <span className="w-3 shrink-0 text-xs text-muted-foreground">
                  {isOpen ? "▾" : "▸"}
                </span>
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <h3 className="truncate font-medium">{group.name}</h3>
                  {!isSingle && (
                    <span className="text-[10px] text-muted-foreground">
                      {group.members.length} categories
                    </span>
                  )}
                </div>
                <dl className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-baseline gap-1">
                    <dt className="text-[10px] uppercase tracking-wide">Items</dt>
                    <dd className="text-foreground">{group.itemCount}</dd>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <dt className="text-[10px] uppercase tracking-wide">Bids</dt>
                    <dd className="text-foreground">{group.bidCount}</dd>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <dt className="text-[10px] uppercase tracking-wide">Avg</dt>
                    <dd className="text-foreground tabular-nums">{fmtMoney(group.avgPerItem)}</dd>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <dt className="text-[10px] uppercase tracking-wide">Total</dt>
                    <dd className="text-foreground tabular-nums">{fmtMoney(group.totalSpend)}</dd>
                  </div>
                </dl>
              </button>

              {isOpen && isSingle && singleBucket && (
                <div className="border-t border-border">
                  {detail ? (
                    <PhrasingList
                      detail={detail}
                      filter={q}
                      onOpen={openDrawer}
                      onCopy={copyPhrasing}
                      onQuickAdd={quickAdd}
                    />
                  ) : (
                    <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p>
                  )}
                </div>
              )}

              {isOpen && !isSingle && (
                <ul className="flex flex-col divide-y divide-border border-t border-border">
                  {group.members.map((member) => {
                    const memberOpen =
                      expanded.has(member.name) || autoExpand.has(member.name);
                    const memberDetail = details.get(member.name);
                    return (
                      <li key={member.name} className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => toggle(member.name, member.name)}
                          className="flex items-center gap-3 bg-accent/10 px-6 py-2 text-left hover:bg-accent/40"
                        >
                          <span className="w-3 shrink-0 text-[10px] text-muted-foreground">
                            {memberOpen ? "▾" : "▸"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">{member.name}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            n={member.itemCount} · avg {fmtMoney(member.avgPerItem)} · total{" "}
                            {fmtMoney(member.totalSpend)}
                          </span>
                        </button>
                        {memberOpen && (
                          <div>
                            {memberDetail ? (
                              <PhrasingList
                                detail={memberDetail}
                                filter={q}
                                onOpen={openDrawer}
                                onCopy={copyPhrasing}
                                onQuickAdd={quickAdd}
                              />
                            ) : (
                              <p className="px-6 py-3 text-xs text-muted-foreground">Loading…</p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          );
        })}
      </div>

      {drawerPhrasing && (
        <OccurrenceDrawer
          phrasing={drawerPhrasing}
          occurrences={drawerOccurrences}
          onClose={() => setDrawerPhrasing(null)}
        />
      )}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg">
          <span className="text-xs">{toast.message}</span>
          <a
            href={`/bids/compose?draft=${toast.draftId}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            Open →
          </a>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function PhrasingList({
  detail,
  filter,
  onOpen,
  onCopy,
  onQuickAdd,
}: {
  detail: BucketDetail;
  filter: string;
  onOpen: (phrasing: string) => void;
  onCopy: (phrasing: string) => void;
  onQuickAdd: (phrasing: string, medianCents: number | null) => void;
}) {
  const rows =
    filter.length >= 2
      ? detail.phrasings.filter((p) => p.description.includes(filter))
      : detail.phrasings;

  if (rows.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        No phrasings match {`"${filter}"`} in this bucket.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {rows.map((p) => (
        <li key={p.description} className="group flex flex-col gap-1 px-4 py-2">
          <button
            type="button"
            onClick={() => onOpen(p.description)}
            className="text-left text-xs leading-snug hover:underline"
          >
            {titleCase(p.description)}
          </button>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              n={p.n} · avg {fmtMoney(p.avgTotal)} · {fmtRange(p.minTotal, p.maxTotal)}
            </span>
            <span className="flex items-center gap-2">
              <span>{fmtDate(p.lastUsed)}</span>
              <button
                type="button"
                onClick={() => onCopy(p.description)}
                className="rounded border border-input bg-transparent px-1.5 py-0.5 text-[10px] hover:bg-accent"
                title="Copy phrasing to clipboard"
              >
                copy
              </button>
              <button
                type="button"
                onClick={() =>
                  onQuickAdd(
                    p.description,
                    p.medianTotal != null ? Math.round(p.medianTotal * 100) : null,
                  )
                }
                className="rounded border border-input bg-transparent px-1.5 py-0.5 text-[10px] hover:bg-accent"
                title="Add to your most recent draft (or start one)"
              >
                + Compose
              </button>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function OccurrenceDrawer({
  phrasing,
  occurrences,
  onClose,
}: {
  phrasing: string;
  occurrences: LineItemOccurrence[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-3 overflow-y-auto bg-background p-5 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Occurrences
            </p>
            <h2 className="text-sm font-medium leading-snug">{titleCase(phrasing)}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-input px-2 py-0.5 text-xs hover:bg-accent"
          >
            ✕
          </button>
        </header>
        {occurrences.length === 0 ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {occurrences.map((occ, idx) => (
              <li
                key={`${occ.bid.id}-${occ.position}-${idx}`}
                className="rounded border border-border p-3"
              >
                <a
                  href={occ.bid.drive_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm hover:underline"
                >
                  {occ.bid.address_raw ?? "Unnamed bid"} ↗
                </a>
                <div className="text-[11px] text-muted-foreground">
                  {occ.bid.tab_name} · {occ.bid.bid_year ?? "?"} · {fmtMoney(occ.total)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
