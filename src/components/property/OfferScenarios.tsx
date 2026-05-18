"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  computeScenario,
  fmtMoney,
  type OfferInputs,
} from "@/lib/services/offer-math";
import { saveRevisedScenarioAction } from "@/lib/actions/properties";

interface RevisedValues {
  purchaseCents: number | null;
  clrCents: number | null;
  reservePct: number | null;
}

interface Props {
  slug: string;
  purchaseCents: number | null;
  clrCents: number | null;
  reservePct: number | null;
  arvCents: number | null;
  estRepairCents: number | null;
  revisedAsIs: RevisedValues;
  revisedRepaired: RevisedValues;
}

const DEFAULT_FEES = {
  programFeePct: 0.085,
  resaleFeePct: 0.055,
  titlePct: 0.01,
};

const STORAGE_KEY = "ppm-offer-fees";

function readStoredFees() {
  if (typeof window === "undefined") return DEFAULT_FEES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FEES;
    const parsed = JSON.parse(raw);
    return {
      programFeePct: Number(parsed.programFeePct) || DEFAULT_FEES.programFeePct,
      resaleFeePct: Number(parsed.resaleFeePct) || DEFAULT_FEES.resaleFeePct,
      titlePct: Number(parsed.titlePct) || DEFAULT_FEES.titlePct,
    };
  } catch {
    return DEFAULT_FEES;
  }
}

function dollars(cents: number | null, fallback = 0): number {
  return cents != null ? cents / 100 : fallback;
}

interface ScenarioState {
  purchase: number;
  clr: number;
  reservePct: number;
}

// Build a column's initial state from revised values if any are set, otherwise
// from the property's original offer + a column-specific CLR default.
function initialStateFor(
  original: { purchase: number; clr: number; reservePct: number; estRepair: number },
  revised: RevisedValues,
  fallbackClr: number,
): ScenarioState {
  const hasRevision =
    revised.purchaseCents != null ||
    revised.clrCents != null ||
    revised.reservePct != null;
  if (hasRevision) {
    return {
      purchase: dollars(revised.purchaseCents, original.purchase),
      clr: dollars(revised.clrCents, fallbackClr),
      reservePct: revised.reservePct ?? original.reservePct,
    };
  }
  return {
    purchase: original.purchase,
    clr: fallbackClr,
    reservePct: original.reservePct,
  };
}

export function OfferScenarios({
  slug,
  purchaseCents,
  clrCents,
  reservePct,
  arvCents,
  estRepairCents,
  revisedAsIs,
  revisedRepaired,
}: Props) {
  const [fees, setFees] = useState(readStoredFees);

  function updateFees(patch: Partial<typeof DEFAULT_FEES>) {
    setFees((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota */
      }
      return next;
    });
  }

  const purchase = dollars(purchaseCents);
  const clr = dollars(clrCents);
  const arv = dollars(arvCents);
  const reserveValue = reservePct ?? 0;
  const estRepair = dollars(estRepairCents, clr);

  const original = {
    purchase,
    clr,
    reservePct: reserveValue,
    estRepair,
  };

  // AS IS defaults to CLR=0 (Cash+ baseline), Repaired defaults to the
  // property's CLR or estRepair fallback.
  const [asIsState, setAsIsState] = useState<ScenarioState>(() =>
    initialStateFor(original, revisedAsIs, 0),
  );
  const [repairedState, setRepairedState] = useState<ScenarioState>(() =>
    initialStateFor(original, revisedRepaired, Math.max(clr, estRepair)),
  );

  // Saved baselines — what's currently persisted. Used to detect "dirty"
  // (unsaved local edits) and to revert after a successful save.
  const [asIsSaved, setAsIsSaved] = useState<ScenarioState>(asIsState);
  const [repairedSaved, setRepairedSaved] = useState<ScenarioState>(
    repairedState,
  );

  const asIs: OfferInputs = {
    purchase: asIsState.purchase,
    programFeePct: fees.programFeePct,
    resaleFeePct: fees.resaleFeePct,
    reservePct: asIsState.reservePct / 100,
    titlePct: fees.titlePct,
    clr: asIsState.clr,
  };

  const repaired: OfferInputs = {
    purchase: repairedState.purchase,
    programFeePct: fees.programFeePct,
    resaleFeePct: fees.resaleFeePct,
    reservePct: repairedState.reservePct / 100,
    titlePct: fees.titlePct,
    clr: repairedState.clr,
  };

  const asIsArv = arv || asIsState.purchase;
  const repairedArv = arv || repairedState.purchase;

  const asIsResult = useMemo(
    () => computeScenario(asIs, asIsArv),
    [asIs, asIsArv],
  );
  const repairedResult = useMemo(
    () => computeScenario(repaired, repairedArv),
    [repaired, repairedArv],
  );

  const delta = repairedResult.totalAtARV - asIsResult.totalAtARV;

  if (purchase === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Offer Scenarios
        </h2>
        <p className="text-sm text-muted-foreground">
          Set the purchase price to compute scenarios.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Offer Scenarios
        </h2>
        <div className="text-xs text-muted-foreground">
          Click any value to revise. Save to share with the team.
        </div>
      </header>

      <details className="mb-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Session fee assumptions</summary>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <FeeInput
            label="Program Fee %"
            value={fees.programFeePct * 100}
            onChange={(v) => updateFees({ programFeePct: v / 100 })}
          />
          <FeeInput
            label="Resale Fee %"
            value={fees.resaleFeePct * 100}
            onChange={(v) => updateFees({ resaleFeePct: v / 100 })}
          />
          <FeeInput
            label="Title %"
            value={fees.titlePct * 100}
            onChange={(v) => updateFees({ titlePct: v / 100 })}
          />
        </div>
        <p className="mt-1 text-[10px]">
          Stored in localStorage; not persisted to the property.
        </p>
      </details>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ScenarioColumn
          slug={slug}
          kind="as-is"
          title="AS IS"
          subtitle="Cash+ baseline"
          state={asIsState}
          onChange={setAsIsState}
          saved={asIsSaved}
          onSaved={setAsIsSaved}
          arv={asIsArv}
          result={asIsResult}
        />
        <ScenarioColumn
          slug={slug}
          kind="repaired"
          title="Repaired"
          subtitle="Cash+ with Repairs"
          state={repairedState}
          onChange={setRepairedState}
          saved={repairedSaved}
          onSaved={setRepairedSaved}
          arv={repairedArv}
          result={repairedResult}
        />
      </div>

      <div className="mt-3 rounded border border-border bg-muted/40 p-2 text-xs">
        Delta in total seller proceeds (Repaired − AS IS):{" "}
        <strong
          className={
            delta >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }
        >
          {fmtMoney(delta)}
        </strong>
      </div>
    </section>
  );
}

function FeeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span>{label}</span>
      <input
        type="number"
        step="0.01"
        value={Number.isFinite(value) ? value.toFixed(2) : ""}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-7 rounded border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
    </label>
  );
}

// Click-to-edit value, modeled after InlineEditField but driven by local
// state instead of a server action. Used inside the OfferScenarios breakdown
// so users can revise Purchase / CLR / Reserve in place.
function InlineNumberEdit({
  value,
  onChange,
  format,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  format: "money" | "percent";
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit() {
    const parsed = parseFloat(draft);
    if (Number.isFinite(parsed) && parsed !== value) onChange(parsed);
    setEditing(false);
  }

  function cancel() {
    setDraft(String(value));
    setEditing(false);
  }

  if (!editing) {
    const display = format === "money" ? fmtMoney(value) : `${value}%`;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${ariaLabel}`}
        className="cursor-pointer rounded px-1 -mx-1 text-right hover:bg-accent hover:underline"
      >
        {display}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="number"
      step={format === "money" ? 100 : 0.25}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      className="h-6 w-24 rounded border border-input bg-transparent px-1 text-right text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
    />
  );
}

function ScenarioColumn({
  slug,
  kind,
  title,
  subtitle,
  state,
  onChange,
  saved,
  onSaved,
  arv,
  result,
}: {
  slug: string;
  kind: "as-is" | "repaired";
  title: string;
  subtitle: string;
  state: ScenarioState;
  onChange: (next: ScenarioState) => void;
  saved: ScenarioState;
  onSaved: (next: ScenarioState) => void;
  arv: number;
  result: ReturnType<typeof computeScenario>;
}) {
  const [isSaving, startSaveTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const fp = result.firstPayout;

  const dirty =
    state.purchase !== saved.purchase ||
    state.clr !== saved.clr ||
    state.reservePct !== saved.reservePct;

  function save() {
    setSaveError(null);
    startSaveTransition(async () => {
      try {
        await saveRevisedScenarioAction(slug, kind, {
          purchaseCents: Math.round(state.purchase * 100),
          clrCents: Math.round(state.clr * 100),
          reservePct: state.reservePct,
        });
        onSaved({ ...state });
      } catch (err) {
        setSaveError((err as Error).message);
      }
    });
  }

  function revert() {
    onChange({ ...saved });
    setSaveError(null);
  }

  return (
    <div className="rounded border border-border p-3">
      <header className="mb-2 flex items-baseline justify-between">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <div className="text-[10px] text-muted-foreground">
          ARV {fmtMoney(arv)}
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Purchase</dt>
        <dd className="text-right">
          <InlineNumberEdit
            value={state.purchase}
            onChange={(v) => onChange({ ...state, purchase: v })}
            format="money"
            ariaLabel="purchase"
          />
        </dd>
        <dt className="text-muted-foreground">− Program fee</dt>
        <dd className="text-right">{fmtMoney(fp.programFee)}</dd>
        <dt className="text-muted-foreground">− Resale fee</dt>
        <dd className="text-right">{fmtMoney(fp.resaleFee)}</dd>
        <dt className="text-muted-foreground">− Title</dt>
        <dd className="text-right">{fmtMoney(fp.title)}</dd>
        <dt className="text-muted-foreground">− CLR</dt>
        <dd className="text-right">
          <InlineNumberEdit
            value={state.clr}
            onChange={(v) => onChange({ ...state, clr: v })}
            format="money"
            ariaLabel="CLR"
          />
        </dd>
        <dt className="text-muted-foreground">
          − Reserve{" "}
          <InlineNumberEdit
            value={state.reservePct}
            onChange={(v) => onChange({ ...state, reservePct: v })}
            format="percent"
            ariaLabel="reserve percent"
          />
        </dt>
        <dd className="text-right">{fmtMoney(fp.reserve)}</dd>
      </dl>
      <hr className="my-2 border-border" />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="font-medium">1st payout</dt>
        <dd className="text-right font-medium">{fmtMoney(fp.firstPayout)}</dd>
        <dt className="font-medium">2nd payout @ ARV</dt>
        <dd className="text-right font-medium">{fmtMoney(result.secondPayoutAtARV)}</dd>
        <dt className="font-medium">Total to seller</dt>
        <dd className="text-right font-medium">{fmtMoney(result.totalAtARV)}</dd>
      </dl>
      {dirty && (
        <div className="mt-2 flex items-center justify-end gap-2">
          {saveError && (
            <span className="text-[11px] text-red-600 dark:text-red-400">{saveError}</span>
          )}
          <button
            type="button"
            onClick={revert}
            disabled={isSaving}
            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Revert
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isSaving}
            className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
