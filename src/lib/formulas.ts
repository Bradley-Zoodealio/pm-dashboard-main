// Per-sqft pricing formulas for remodel bid line items.
// Source: memory/feedback_remodel_bid_pricing.md (Bradley's team standard).
// Formulas bake in a 30% margin on base cost.
// Client-safe — no server imports.

export type FormulaKey = "paint" | "lvp" | "demo-flooring";

export interface FormulaPreset {
  key: FormulaKey;
  label: string;
  rate: number;        // per sqft, margin-included
  base: number;        // raw cost per sqft (for tooltip)
  marginPct: number;   // margin in % (for tooltip)
  roundTo: number;     // round result to nearest dollars
}

export const PAINT_FORMULA: FormulaPreset = {
  key: "paint",
  label: "Interior paint",
  rate: 5.85,
  base: 4.5,
  marginPct: 30,
  roundTo: 50,
};

export const LVP_FORMULA: FormulaPreset = {
  key: "lvp",
  label: "LVP flooring",
  rate: 5.2,
  base: 4.0,
  marginPct: 30,
  roundTo: 50,
};

export const DEMO_FLOORING_FORMULA: FormulaPreset = {
  key: "demo-flooring",
  label: "Demo flooring",
  rate: 0.95,
  base: 0.95,
  marginPct: 0,
  roundTo: 50,
};

export const ALL_FORMULAS: readonly FormulaPreset[] = [
  PAINT_FORMULA,
  LVP_FORMULA,
  DEMO_FLOORING_FORMULA,
] as const;

// Detect the appropriate formula from a line item description.
// Returns null when no formula applies (most rows).
export function detectFormula(description: string): FormulaPreset | null {
  const t = description.toLowerCase();

  // Demo-flooring must be checked before generic LVP — a row like
  // "demo existing tile flooring throughout" should NOT use the LVP install rate.
  if (/\bdemo.*\bflooring\b/.test(t) || /\bdemo.*\btile\s+flooring\b/.test(t)) {
    return DEMO_FLOORING_FORMULA;
  }

  // LVP / vinyl install
  if (/\b(lvp|vinyl\s+flooring)\b/.test(t) && !/\bdemo\b/.test(t)) {
    return LVP_FORMULA;
  }

  // Interior paint — exclude exterior, cabinets, decks, and other non-wall scopes
  // since those are priced flat / per-unit, not by sqft.
  if (
    /\b(paint|repaint)\b/.test(t) &&
    !/\bexterior\b/.test(t) &&
    !/\bcabinet/.test(t) &&
    !/\bdeck\b/.test(t) &&
    !/\bfence\b/.test(t)
  ) {
    return PAINT_FORMULA;
  }

  return null;
}

export function calculateFromSqft(formula: FormulaPreset, sqft: number): number {
  const raw = sqft * formula.rate;
  return Math.round(raw / formula.roundTo) * formula.roundTo;
}

export function rateLabel(formula: FormulaPreset): string {
  return `$${formula.rate.toFixed(2)}/sqft`;
}
