export const STAGES = [
  { id: "inspection-received", label: "Inspection Received" },
  { id: "inspection-under-review", label: "Inspection Under Review" },
  { id: "exec-final-review", label: "Exec Final Review" },
  { id: "addendum-sent", label: "Addendum Sent" },
  { id: "title", label: "Title" },
  { id: "contract-work", label: "Contract Work" },
  { id: "ready-for-listing", label: "Ready for Listing" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

const STAGE_IDS = new Set<string>(STAGES.map((s) => s.id));
const LABEL_BY_ID = new Map<string, string>(STAGES.map((s) => [s.id, s.label]));
const ID_BY_LABEL = new Map<string, StageId>(STAGES.map((s) => [s.label.toLowerCase(), s.id]));

export function isStageId(value: string): value is StageId {
  return STAGE_IDS.has(value);
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

export const PM_TEAM = ["Bradley", "Ethan", "Colton", "Chris", "Christina"] as const;
export type PmName = (typeof PM_TEAM)[number];
export const ASSIGNEE_OPTIONS = ["Unassigned", ...PM_TEAM] as const;
