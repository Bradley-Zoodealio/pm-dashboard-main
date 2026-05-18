// Pipeline stages drive the Kanban board columns and stage progression.
export const STAGES = [
  { id: "inspection-received", label: "Inspection Received" },
  { id: "inspection-under-review", label: "Inspection Under Review" },
  { id: "exec-final-review", label: "Exec Final Review" },
  { id: "addendum-sent", label: "Addendum Sent" },
  { id: "title", label: "Title" },
  { id: "contract-work", label: "Contract Work" },
  { id: "ready-for-listing", label: "Ready for Listing" },
] as const;

// Terminal stages are valid stage values but never render as board columns.
// Properties land here via the Cancel/Close server actions in
// [@/lib/actions/property-lifecycle].
export const TERMINAL_STAGES = [
  { id: "cancelled", label: "Cancelled" },
  { id: "closed", label: "Closed" },
] as const;

export type PipelineStageId = (typeof STAGES)[number]["id"];
export type TerminalStageId = (typeof TERMINAL_STAGES)[number]["id"];
export type StageId = PipelineStageId | TerminalStageId;

const ALL_STAGE_IDS = new Set<string>([
  ...STAGES.map((s) => s.id),
  ...TERMINAL_STAGES.map((s) => s.id),
]);
const TERMINAL_IDS = new Set<string>(TERMINAL_STAGES.map((s) => s.id));
const LABEL_BY_ID = new Map<string, string>([
  ...STAGES.map((s) => [s.id, s.label] as const),
  ...TERMINAL_STAGES.map((s) => [s.id, s.label] as const),
]);
const ID_BY_LABEL = new Map<string, StageId>([
  ...STAGES.map((s) => [s.label.toLowerCase(), s.id] as const),
  ...TERMINAL_STAGES.map((s) => [s.label.toLowerCase(), s.id] as const),
]);

export function isStageId(value: string): value is StageId {
  return ALL_STAGE_IDS.has(value);
}

export function isTerminalStage(value: string): value is TerminalStageId {
  return TERMINAL_IDS.has(value);
}

export function labelFor(id: string): string {
  return LABEL_BY_ID.get(id) ?? id;
}

export function stageFromLabel(label: string): StageId | null {
  return ID_BY_LABEL.get(label.trim().toLowerCase()) ?? null;
}

const COUNTDOWN_STAGES = new Set<StageId>([
  "inspection-received",
  "inspection-under-review",
  "exec-final-review",
]);

export function showCountdown(stageId: string): boolean {
  return isStageId(stageId) && COUNTDOWN_STAGES.has(stageId);
}

export const PM_TEAM = ["Bradley", "Ethan", "Colton"] as const;
export type PmName = (typeof PM_TEAM)[number];
export const ASSIGNEE_OPTIONS = ["Unassigned", ...PM_TEAM] as const;

// Exec team that reviews the Remodel Bid email we send out. The
// exec_reviewer field is meaningful once a property enters Exec Final Review.
export const EXEC_TEAM = ["Kala", "Jason", "Eliot"] as const;
export type ExecName = (typeof EXEC_TEAM)[number];
export const EXEC_OPTIONS = ["Unassigned", ...EXEC_TEAM] as const;

export function isExecReviewStage(stageId: string): boolean {
  return stageId === "exec-final-review";
}
