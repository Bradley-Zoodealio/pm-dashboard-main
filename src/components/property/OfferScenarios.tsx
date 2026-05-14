"use client";

import { useState, useMemo } from "react";
import {
  computeScenario,
  fmtMoney,
  type OfferInputs,
} from "@/lib/services/offer-math";

interface Props {
  purchaseCents: number | null;
  clrCents: number | null;
  reservePct: number | null;
  arvCents: number | null;
  estRepairCents: number | null;
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

export function OfferScenarios({
  purchaseCents,
  clrCents,
  reservePct,
  arvCents,
  estRepairCents,
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
  const reserveFraction = reservePct != null ? reservePct / 100 : 0;

  const asIs: OfferInputs = {
    purchase,
    programFeePct: fees.programFeePct,
    resaleFeePct: fees.resaleFeePct,
    reservePct: reserveFraction,
    titlePct: fees.titlePct,
    clr,
  };

  const repaired: OfferInputs = {
    ...asIs,
    clr: Math.max(clr, dollars(estRepairCents, clr)),
  };

  const asIsResult = useMemo(() => computeScenario(asIs, arv || purchase), [asIs, arv, purchase]);
  const repairedResult = useMemo(
    () => computeScenario(repaired, arv || purchase),
    [repaired, arv, purchase],
  );

  const delta = repairedResult.totalAtARV - asIsResult.totalAtARV;

  if (purchase === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Offer Scenarios
        </h2>
        <p className="text-sm text-muted-foreground">
          Set the purchase price (and ARV) to compute scenarios.
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
          ARV {fmtMoney(arv)} · Reserve{" "}
          {reservePct != null ? `${reservePct}%` : "—"}
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
        <ScenarioColumn title="AS IS" subtitle="current offer (Cash+)" result={asIsResult} />
        <ScenarioColumn
          title="Repaired"
          subtitle="Cash+ with Repairs"
          result={repairedResult}
        />
      </div>

      <div className="mt-3 rounded border border-border bg-muted/40 p-2 text-xs">
        Delta in total seller proceeds (Repaired − AS IS):{" "}
        <strong className={delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
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

function ScenarioColumn({
  title,
  subtitle,
  result,
}: {
  title: string;
  subtitle: string;
  result: ReturnType<typeof computeScenario>;
}) {
  const fp = result.firstPayout;
  return (
    <div className="rounded border border-border p-3">
      <header className="mb-2">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </header>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Purchase</dt>
        <dd className="text-right">{fmtMoney(fp.purchase)}</dd>
        <dt className="text-muted-foreground">− Program fee</dt>
        <dd className="text-right">{fmtMoney(fp.programFee)}</dd>
        <dt className="text-muted-foreground">− Resale fee</dt>
        <dd className="text-right">{fmtMoney(fp.resaleFee)}</dd>
        <dt className="text-muted-foreground">− Title</dt>
        <dd className="text-right">{fmtMoney(fp.title)}</dd>
        <dt className="text-muted-foreground">− CLR</dt>
        <dd className="text-right">{fmtMoney(fp.clr)}</dd>
        <dt className="text-muted-foreground">− Reserve</dt>
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
    </div>
  );
}
