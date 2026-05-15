"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  addDraftItemAction,
  archiveDraftAction,
  duplicateAsOption2Action,
  removeDraftItemAction,
  sendDraftToSheetAction,
  updateDraftItemAction,
  updateDraftTitleAction,
} from "@/lib/actions/bid-drafts";
import { fetchBucketDetail } from "@/lib/actions/bid-aggregates";
import type {
  BidDraftItemRow,
  BidDraftWithItems,
} from "@/lib/db/bid-drafts";
import type {
  BucketDetail,
  BucketSummary,
} from "@/lib/db/bid-aggregates";
import {
  calculateFromSqft,
  detectFormula,
  rateLabel,
  type FormulaPreset,
} from "@/lib/formulas";

interface PropertyContext {
  id: string;
  slug: string;
  address: string;
  clrCents: number | null;
  remodelBidUrl: string | null;
}

interface RecentDraft {
  id: string;
  title: string;
  updatedAt: string;
  totalCents: number;
  itemCount: number;
}

interface Props {
  initialDraft: BidDraftWithItems;
  property: PropertyContext | null;
  buckets: BucketSummary[];
  recentDrafts: RecentDraft[];
}

function dollars(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(Math.round(cents) / 100).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;
}

function parseDollarsToCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export function ComposeEditor({ initialDraft, property, buckets, recentDrafts }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<BidDraftWithItems>(initialDraft);
  const [, startTransition] = useTransition();
  const [bucketDetail, setBucketDetail] = useState<Map<string, BucketDetail>>(new Map());
  const [openBucket, setOpenBucket] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ filter: string }>({ filter: "" });
  const [sending, setSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const nonFooterItems = draft.items.filter((i) => !i.is_footer);
  const footerItems = draft.items.filter((i) => i.is_footer);
  const runningTotal = draft.items.reduce((s, i) => s + (i.total_cents ?? 0), 0);
  const overCLR =
    property?.clrCents != null && runningTotal > property.clrCents
      ? runningTotal - property.clrCents
      : 0;

  // ── Mutations ────────────────────────────────────────────────────────────

  function applyItem(updated: BidDraftItemRow) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === updated.id ? updated : it)),
    }));
  }

  function addItem(item: BidDraftItemRow) {
    setDraft((prev) => ({ ...prev, items: [...prev.items, item] }));
  }

  function removeLocalItem(id: string) {
    setDraft((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== id) }));
  }

  async function handleAddPhrasing(description: string, medianCents: number | null) {
    const created = await addDraftItemAction({
      draftId: draft.id,
      description: titleCase(description),
      totalCents: medianCents,
    });
    addItem(created);
  }

  async function handleAddCustom() {
    const created = await addDraftItemAction({
      draftId: draft.id,
      description: "",
      totalCents: null,
    });
    addItem(created);
  }

  async function handleItemBlur(
    item: BidDraftItemRow,
    patch: { description?: string; totalCents?: number | null },
  ) {
    const updated = await updateDraftItemAction(item.id, patch);
    applyItem(updated);
  }

  async function handleRemove(id: string) {
    removeLocalItem(id);
    await removeDraftItemAction(id);
  }

  async function handleTitleBlur(value: string) {
    if (value === draft.title) return;
    const updated = await updateDraftTitleAction(draft.id, value);
    setDraft((prev) => ({ ...prev, title: updated.title, updated_at: updated.updated_at }));
  }

  async function handleArchive() {
    if (!confirm("Archive this draft? It will be hidden from the active drafts list.")) return;
    await archiveDraftAction(draft.id);
    router.push("/bids/drafts");
  }

  async function handleCopyJson() {
    const payload = draft.items
      .filter((it) => !it.is_footer && it.description.trim().length > 0)
      .map((it) => ({
        description: it.description,
        total: it.total_cents == null ? null : it.total_cents / 100,
      }));
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setStatusMessage(`Copied JSON for ${payload.length} line items to clipboard.`);
    } catch {
      setStatusMessage("Clipboard unavailable — could not copy.");
    }
  }

  async function handleSendToSheet() {
    if (!property?.remodelBidUrl) return;
    if (
      !confirm(
        `Replace line items in the Remodel Bid sheet for ${property.address}? This will overwrite the current contents.`,
      )
    ) {
      return;
    }
    setSending(true);
    setStatusMessage(null);
    try {
      const result = await sendDraftToSheetAction(draft.id);
      const link = `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}/edit`;
      setStatusMessage(
        `Wrote ${result.itemCount} items to "${result.tabName}". ${result.warning ?? ""} ${link}`,
      );
    } catch (err) {
      setStatusMessage(`Send failed: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  async function handleDuplicate() {
    const { draftId: newId } = await duplicateAsOption2Action(draft.id);
    router.push(`/bids/compose?draft=${newId}`);
  }

  // ── Bucket picker (left rail) ────────────────────────────────────────────

  async function toggleBucket(name: string) {
    if (openBucket === name) {
      setOpenBucket(null);
      return;
    }
    setOpenBucket(name);
    if (!bucketDetail.has(name)) {
      startTransition(async () => {
        const detail = await fetchBucketDetail(name);
        setBucketDetail((prev) => new Map(prev).set(name, detail));
      });
    }
  }

  const filteredBuckets = useMemo(() => {
    const f = picker.filter.toLowerCase().trim();
    if (f.length < 2) return buckets;
    return buckets.filter((b) => b.name.toLowerCase().includes(f));
  }, [buckets, picker.filter]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {property && (
              <Link
                href={`/properties/${property.slug}`}
                className="rounded-md bg-accent/60 px-2 py-0.5 font-medium hover:bg-accent"
              >
                {property.address}
              </Link>
            )}
            {draft.tier && (
              <span className="rounded-md bg-foreground/10 px-2 py-0.5">
                {draft.tier === "option-1" ? "Option 1" : "Option 2"}
              </span>
            )}
          </div>
          <input
            type="text"
            defaultValue={draft.title}
            onBlur={(e) => handleTitleBlur(e.target.value)}
            className="mt-1 w-full bg-transparent text-2xl font-semibold leading-tight outline-none focus:bg-accent/40 focus:px-1"
          />
        </div>
        <RecentDraftsDropdown current={draft.id} recentDrafts={recentDrafts} />
      </header>

      {/* Status message */}
      {statusMessage && (
        <div className="rounded border border-border bg-card p-3 text-xs">{statusMessage}</div>
      )}

      {/* Two-column body */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
        {/* Left rail — bucket picker */}
        <aside className="flex max-h-[calc(100vh-200px)] flex-col gap-2 overflow-y-auto rounded-lg border border-border p-3">
          <header className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pick from library
          </header>
          <input
            type="search"
            value={picker.filter}
            onChange={(e) => setPicker({ filter: e.target.value })}
            placeholder="Filter…"
            className="h-8 rounded border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
          />
          <ul className="flex flex-col gap-1">
            {filteredBuckets.map((b) => {
              const isOpen = openBucket === b.name;
              const detail = bucketDetail.get(b.name);
              return (
                <li key={b.name} className="rounded border border-transparent">
                  <button
                    type="button"
                    onClick={() => toggleBucket(b.name)}
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent/40"
                  >
                    <span>{b.name}</span>
                    <span className="text-[10px] text-muted-foreground">{b.itemCount}</span>
                  </button>
                  {isOpen && (
                    <div className="ml-2 mt-1 border-l border-border pl-2">
                      {detail ? (
                        <ul className="flex flex-col gap-1">
                          {detail.phrasings.slice(0, 50).map((p) => (
                            <li key={p.description} className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                onClick={() =>
                                  handleAddPhrasing(
                                    p.description,
                                    p.medianTotal != null ? Math.round(p.medianTotal * 100) : null,
                                  )
                                }
                                className="text-left text-[11px] leading-snug hover:underline"
                                title={`+ Add to draft (median ${
                                  p.medianTotal != null ? `$${Math.round(p.medianTotal)}` : "—"
                                })`}
                              >
                                + {titleCase(p.description)}
                              </button>
                              <span className="text-[10px] text-muted-foreground">
                                n={p.n} · med{" "}
                                {p.medianTotal != null
                                  ? `$${Math.round(p.medianTotal).toLocaleString()}`
                                  : "—"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="py-1 text-[11px] text-muted-foreground">Loading…</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Right side — draft pane */}
        <section className="flex flex-col gap-3">
          {/* Running total */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border bg-card p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Running total
              </p>
              <p className="text-2xl font-semibold">{dollars(runningTotal)}</p>
            </div>
            {property?.clrCents != null && (
              <div className="text-right text-xs">
                <p className="text-muted-foreground">
                  CLR ceiling: {dollars(property.clrCents)}
                </p>
                {overCLR > 0 && (
                  <p className="font-medium text-red-600 dark:text-red-400">
                    Over by {dollars(overCLR)}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Scope items */}
          <div className="rounded-lg border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-3 py-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Scope items ({nonFooterItems.length})
              </h2>
              <button
                type="button"
                onClick={handleAddCustom}
                className="rounded border border-input px-2 py-0.5 text-xs hover:bg-accent"
              >
                + Custom line item
              </button>
            </header>
            {nonFooterItems.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                No items yet. Add from the library on the left, or click{" "}
                <span className="font-medium">+ Custom line item</span>.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {nonFooterItems.map((it) => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    onBlur={(patch) => handleItemBlur(it, patch)}
                    onRemove={() => handleRemove(it.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Footer panel */}
          <div className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Footers (auto-included)
            </header>
            <ul className="divide-y divide-border">
              {footerItems.map((it) => (
                <ItemRow
                  key={it.id}
                  item={it}
                  descriptionReadOnly
                  onBlur={(patch) => handleItemBlur(it, patch)}
                  onRemove={() => handleRemove(it.id)}
                />
              ))}
            </ul>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyJson}
              className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              Copy JSON
            </button>
            {property?.remodelBidUrl && (
              <button
                type="button"
                onClick={handleSendToSheet}
                disabled={sending}
                className="h-9 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {sending ? "Sending…" : `Send to ${draft.tier === "option-2" ? "Option 2" : "Sheet"}`}
              </button>
            )}
            {draft.tier !== "option-2" && (
              <button
                type="button"
                onClick={handleDuplicate}
                className="h-9 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent"
              >
                Duplicate as Option 2
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleArchive}
              className="h-9 rounded-md border border-input bg-card px-3 text-xs text-muted-foreground hover:bg-accent"
            >
              Archive
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onBlur,
  onRemove,
  descriptionReadOnly = false,
}: {
  item: BidDraftItemRow;
  onBlur: (patch: { description?: string; totalCents?: number | null }) => void;
  onRemove: () => void;
  descriptionReadOnly?: boolean;
}) {
  const [, startTransition] = useTransition();
  const [calcOpen, setCalcOpen] = useState(false);

  const formula = descriptionReadOnly ? null : detectFormula(item.description);

  function applyCalc(newCents: number) {
    setCalcOpen(false);
    startTransition(() => onBlur({ totalCents: newCents }));
  }

  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-start gap-2">
        <input
          type="text"
          defaultValue={item.description}
          readOnly={descriptionReadOnly}
          onBlur={(e) => {
            if (descriptionReadOnly) return;
            if (e.target.value !== item.description) {
              startTransition(() => onBlur({ description: e.target.value }));
            }
          }}
          placeholder="Description…"
          className={
            "flex-1 bg-transparent text-sm outline-none " +
            (descriptionReadOnly ? "text-muted-foreground" : "focus:bg-accent/40 focus:px-1")
          }
        />
        <input
          type="text"
          defaultValue={
            item.total_cents == null ? "" : (item.total_cents / 100).toLocaleString()
          }
          onBlur={(e) => {
            const cents = parseDollarsToCents(e.target.value);
            if (cents !== item.total_cents) {
              startTransition(() => onBlur({ totalCents: cents }));
            }
            if (cents != null) e.target.value = (cents / 100).toLocaleString();
          }}
          inputMode="decimal"
          placeholder="—"
          className="w-24 rounded border border-transparent bg-transparent px-1 text-right text-sm tabular-nums outline-none focus:border-input"
        />
        {formula && (
          <button
            type="button"
            onClick={() => setCalcOpen((o) => !o)}
            className={
              "rounded border px-1.5 py-0.5 text-[10px] " +
              (calcOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-accent")
            }
            title={`Calculate from sqft using ${formula.label} formula (${rateLabel(formula)})`}
          >
            calc
          </button>
        )}
        {!descriptionReadOnly && (
          <button
            type="button"
            onClick={() => {
              if (confirm("Remove this item?")) onRemove();
            }}
            className="rounded px-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Remove"
          >
            ✕
          </button>
        )}
      </div>
      {calcOpen && formula && (
        <SqftCalc formula={formula} onApply={applyCalc} onCancel={() => setCalcOpen(false)} />
      )}
    </li>
  );
}

function SqftCalc({
  formula,
  onApply,
  onCancel,
}: {
  formula: FormulaPreset;
  onApply: (cents: number) => void;
  onCancel: () => void;
}) {
  const [sqftStr, setSqftStr] = useState("");
  const sqft = parseFloat(sqftStr.replace(/[,\s]/g, ""));
  const isValid = Number.isFinite(sqft) && sqft > 0;
  const total = isValid ? calculateFromSqft(formula, sqft) : 0;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-accent/30 px-3 py-2 text-xs">
      <span className="font-medium">{formula.label}</span>
      <span className="text-muted-foreground">
        {rateLabel(formula)}
        {formula.marginPct > 0 && ` (= $${formula.base.toFixed(2)} × ${1 + formula.marginPct / 100})`}
      </span>
      <div className="flex items-center gap-1">
        <label className="text-muted-foreground">Sq ft:</label>
        <input
          type="text"
          autoFocus
          value={sqftStr}
          onChange={(e) => setSqftStr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isValid) onApply(total * 100);
            if (e.key === "Escape") onCancel();
          }}
          inputMode="decimal"
          placeholder="1200"
          className="h-7 w-20 rounded border border-input bg-background px-2 text-right tabular-nums outline-none focus-visible:border-ring"
        />
      </div>
      <span className="text-muted-foreground">→</span>
      <span className="font-medium tabular-nums">
        ${total.toLocaleString()}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => onApply(total * 100)}
        disabled={!isValid}
        className="h-7 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        Apply
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="h-7 rounded-md border border-input bg-card px-2 text-[11px] text-muted-foreground hover:bg-accent"
      >
        Cancel
      </button>
    </div>
  );
}

function RecentDraftsDropdown({
  current,
  recentDrafts,
}: {
  current: string;
  recentDrafts: RecentDraft[];
}) {
  const [open, setOpen] = useState(false);
  const others = recentDrafts.filter((d) => d.id !== current);
  if (others.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-8 rounded border border-input px-2 text-xs hover:bg-accent"
      >
        Recent drafts ▾
      </button>
      {open && (
        <ul className="absolute right-0 z-10 mt-1 w-72 rounded-md border border-border bg-popover p-1 shadow-md">
          {others.map((d) => (
            <li key={d.id}>
              <Link
                href={`/bids/compose?draft=${d.id}`}
                className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-accent"
                onClick={() => setOpen(false)}
              >
                <span className="truncate">{d.title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {dollars(d.totalCents)} · {d.itemCount}
                </span>
              </Link>
            </li>
          ))}
          <li className="border-t border-border pt-1">
            <Link
              href="/bids/drafts"
              className="block rounded px-2 py-1 text-xs hover:bg-accent"
              onClick={() => setOpen(false)}
            >
              View all drafts →
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}
