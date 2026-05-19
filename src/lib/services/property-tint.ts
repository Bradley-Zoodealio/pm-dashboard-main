import { showCountdown } from "./stages";

// One card state → one tint. Green is reserved for "advanced" so it can never
// collide with the countdown scale. "complete" is a deeper, more saturated
// green reserved for ready-for-listing — the renovation is done, the card is
// fading off the board within 24h.
//
// The addendum-* tints are a parallel countdown for the 5-calendar-day window
// that begins when an addendum email leaves contracts@. They live on calendar
// pins only (never on board cards), and they ramp on a cool/jewel palette
// (indigo → violet → fuchsia → pink) so they read as clearly distinct from
// the EOI passed/urgent/warning/healthy scale even at the urgent end.
// "addendum-sent" is a stationary zinc pin marking the send day; its color
// does not shift.
export type Tint =
  | "passed"
  | "urgent"
  | "warning"
  | "healthy"
  | "advanced"
  | "complete"
  | "addendum-sent"
  | "addendum-healthy"
  | "addendum-warning"
  | "addendum-urgent"
  | "addendum-passed";

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
  complete: {
    bg: "bg-emerald-300/70 dark:bg-emerald-800/50",
    beforeStripe: "before:bg-emerald-700",
    dot: "bg-emerald-700",
    label: "text-emerald-900 dark:text-emerald-100",
  },
  "addendum-sent": {
    bg: "bg-zinc-100 dark:bg-zinc-900/40",
    beforeStripe: "before:bg-zinc-400",
    dot: "bg-zinc-400",
    label: "text-zinc-600 dark:text-zinc-400",
  },
  "addendum-healthy": {
    bg: "bg-indigo-100 dark:bg-indigo-950/40",
    beforeStripe: "before:bg-indigo-500",
    dot: "bg-indigo-500",
    label: "text-indigo-700 dark:text-indigo-300",
  },
  "addendum-warning": {
    bg: "bg-violet-100 dark:bg-violet-950/40",
    beforeStripe: "before:bg-violet-500",
    dot: "bg-violet-500",
    label: "text-violet-700 dark:text-violet-300",
  },
  "addendum-urgent": {
    bg: "bg-fuchsia-100 dark:bg-fuchsia-950/40",
    beforeStripe: "before:bg-fuchsia-500",
    dot: "bg-fuchsia-500",
    label: "text-fuchsia-700 dark:text-fuchsia-300",
  },
  "addendum-passed": {
    bg: "bg-pink-100 dark:bg-pink-950/40",
    beforeStripe: "before:bg-pink-600",
    dot: "bg-pink-600",
    label: "text-pink-700 dark:text-pink-300",
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

// Deadline = addendum_sent_at + 5 calendar days. The pin color shifts on
// the same urgency thresholds the EOI scale uses (≤1 / ≤3 / >3 days out)
// — same shape, different palette.
export function tintForAddendumDeadline(daysUntilDeadline: number): Tint {
  if (daysUntilDeadline < 0) return "addendum-passed";
  if (daysUntilDeadline <= 1) return "addendum-urgent";
  if (daysUntilDeadline <= 3) return "addendum-warning";
  return "addendum-healthy";
}

export function tintForProperty(
  stage: string,
  inspectDate: string | null,
  renovationCompletedAt: string | null = null,
  addendumSentAt: string | null = null,
): Tint {
  // Renovation marked complete → distinct saturated emerald until the 24h
  // board filter hides the card. Stage is still contract-work.
  if (renovationCompletedAt) return "complete";
  // Properties in Addendum Sent with a known send instant get their card
  // tinted on the addendum 5-day urgency scale — same indigo→pink ramp
  // used for the calendar deadline pin. Falls through to "advanced" when
  // we don't yet know the send instant (manual move pending sync, etc.).
  if (stage === "addendum-sent" && addendumSentAt) {
    const sent = new Date(addendumSentAt);
    if (!Number.isNaN(sent.getTime())) {
      const deadline = new Date(sent);
      deadline.setDate(deadline.getDate() + 5);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const deadlineDay = new Date(
        deadline.getFullYear(),
        deadline.getMonth(),
        deadline.getDate(),
      );
      const daysOut = Math.round(
        (deadlineDay.getTime() - today.getTime()) / 86_400_000,
      );
      return tintForAddendumDeadline(daysOut);
    }
  }
  // Past Exec Final Review → green, regardless of inspect date.
  if (!showCountdown(stage)) return "advanced";
  const daysOut = daysUntil(inspectDate);
  if (daysOut === null) return "healthy";
  if (daysOut < 0) return "passed";
  if (daysOut <= 1) return "urgent";
  if (daysOut <= 3) return "warning";
  return "healthy";
}
