import { showCountdown } from "./stages";

// One card state → one tint. Green is reserved for "advanced" so it can never
// collide with the countdown scale.
export type Tint = "passed" | "urgent" | "warning" | "healthy" | "advanced";

export interface TintStyle {
  /** Background wash (~10% alpha so the surface stays readable). */
  bg: string;
  /** Stripe class with `before:` prefix — paste directly on a `relative` parent. */
  beforeStripe: string;
  /** Solid color for a standalone dot / cell-stripe (no pseudo-element). */
  dot: string;
  /** Text color for the countdown label. */
  label: string;
}

// Full class strings live here so Tailwind's source-scanner sees every variant.
// Do not build class names by interpolation — Tailwind only matches literal strings.
//
// One step darker than the original -50/70 set so the tints stand out against
// the cool page background (--background: #f4f6fa).
export const TINT_STYLES: Record<Tint, TintStyle> = {
  passed: {
    bg: "bg-red-100 dark:bg-red-950/40",
    beforeStripe: "before:bg-red-500",
    dot: "bg-red-500",
    label: "text-red-700 dark:text-red-300",
  },
  urgent: {
    bg: "bg-orange-100 dark:bg-orange-950/40",
    beforeStripe: "before:bg-orange-500",
    dot: "bg-orange-500",
    label: "text-orange-700 dark:text-orange-300",
  },
  warning: {
    bg: "bg-amber-100 dark:bg-amber-950/40",
    beforeStripe: "before:bg-amber-500",
    dot: "bg-amber-500",
    label: "text-amber-700 dark:text-amber-300",
  },
  healthy: {
    bg: "bg-sky-100 dark:bg-sky-950/40",
    beforeStripe: "before:bg-sky-500",
    dot: "bg-sky-500",
    label: "text-sky-700 dark:text-sky-300",
  },
  advanced: {
    bg: "bg-emerald-100 dark:bg-emerald-950/40",
    beforeStripe: "before:bg-emerald-500",
    dot: "bg-emerald-500",
    label: "text-emerald-700 dark:text-emerald-300",
  },
};

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(date + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** "May 19" — year is dropped on board/list cards since the date is always within
 * a few weeks of "today" by definition of the active pipeline. */
export function formatInspectDate(date: string | null): string {
  if (!date) return "—";
  const d = new Date(date + "T00:00:00");
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function tintForProperty(stage: string, inspectDate: string | null): Tint {
  // Past Exec Final Review → green, regardless of inspect date.
  if (!showCountdown(stage)) return "advanced";
  const daysOut = daysUntil(inspectDate);
  if (daysOut === null) return "healthy";
  if (daysOut < 0) return "passed";
  if (daysOut <= 1) return "urgent";
  if (daysOut <= 3) return "warning";
  return "healthy";
}
