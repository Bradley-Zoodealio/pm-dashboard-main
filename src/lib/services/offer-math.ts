// Two-payout offer math for Cash+ deals. Ported from old PPMDashboard.
// All amounts are in DOLLARS (not cents) — convert at the edges.

export interface OfferInputs {
  purchase: number;
  programFeePct: number;
  resaleFeePct: number;
  reservePct: number;
  titlePct: number;
  clr: number;
  mortgage?: number;
}

export interface PayoutBreakdown {
  purchase: number;
  programFee: number;
  resaleFee: number;
  reserve: number;
  title: number;
  clr: number;
  mortgage: number;
  firstPayout: number;
  basis: number;
}

export interface ScenarioResult {
  inputs: OfferInputs;
  firstPayout: PayoutBreakdown;
  secondPayoutAtPurchase: number;
  secondPayoutAtARV: number;
  totalAtARV: number;
}

export function computeFirstPayout(i: OfferInputs): PayoutBreakdown {
  const programFee = i.purchase * i.programFeePct;
  const resaleFee = i.purchase * i.resaleFeePct;
  const reserve = i.purchase * i.reservePct;
  const title = i.purchase * i.titlePct;
  const mortgage = i.mortgage ?? 0;
  const basis = i.purchase - reserve;
  const firstPayout =
    i.purchase - programFee - resaleFee - reserve - title - i.clr - mortgage;
  return {
    purchase: i.purchase,
    programFee,
    resaleFee,
    reserve,
    title,
    clr: i.clr,
    mortgage,
    firstPayout,
    basis,
  };
}

export function computeSecondPayout(i: OfferInputs, resalePrice: number): number {
  const reserve = i.purchase * i.reservePct;
  if (resalePrice === i.purchase) return reserve;
  if (resalePrice < i.purchase) {
    const shortfall = i.purchase - resalePrice;
    return Math.max(reserve - shortfall, 0);
  }
  const upside = resalePrice - i.purchase;
  return reserve + upside;
}

export function computeScenario(i: OfferInputs, arv: number): ScenarioResult {
  const firstPayout = computeFirstPayout(i);
  const secondPayoutAtPurchase = computeSecondPayout(i, i.purchase);
  const secondPayoutAtARV = computeSecondPayout(i, arv);
  const totalAtARV = firstPayout.firstPayout + secondPayoutAtARV;
  return {
    inputs: i,
    firstPayout,
    secondPayoutAtPurchase,
    secondPayoutAtARV,
    totalAtARV,
  };
}

export function fmtMoney(n: number): string {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded);
  return (rounded < 0 ? "-$" : "$") + abs.toLocaleString("en-US");
}

export function fmtPct(p: number): string {
  return (p * 100).toFixed(2).replace(/\.?0+$/, "") + "%";
}
