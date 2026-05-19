"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSupabase } from "@/lib/db/supabase";
import {
  listNotesForProperty,
  moveStage as moveStageRepo,
  updatePropertyField,
  type PropertyField,
} from "@/lib/db/properties";
import { isStageId, type StageId } from "@/lib/services/stages";

const slugSchema = z.string().min(1).max(200);

const EDITABLE_FIELDS = [
  "address",
  "purchase_cents",
  "clr_cents",
  "reserve_pct",
  "program_fee_pct",
  "resale_fee_pct",
  "revised_as_is_purchase_cents",
  "revised_as_is_clr_cents",
  "revised_as_is_reserve_pct",
  "revised_repaired_purchase_cents",
  "revised_repaired_clr_cents",
  "revised_repaired_reserve_pct",
  "inspect_date",
  "addendum_sent_at",
  "assignee",
  "exec_reviewer",
  "inspect_url",
  "redfin_url",
  "cma_url",
  "comps_url",
  "questionnaire_url",
  "remodel_bid_url",
  "project_tracker_url",
  "arv_cents",
  "est_repair_cents",
] as const satisfies ReadonlyArray<PropertyField>;

type EditableField = (typeof EDITABLE_FIELDS)[number];

const TEXT_FIELDS = new Set<EditableField>([
  "address",
  "assignee",
  "exec_reviewer",
  "inspect_url",
  "redfin_url",
  "cma_url",
  "comps_url",
  "questionnaire_url",
  "remodel_bid_url",
  "project_tracker_url",
]);

const MONEY_FIELDS = new Set<EditableField>([
  "purchase_cents",
  "clr_cents",
  "arv_cents",
  "est_repair_cents",
  "revised_as_is_purchase_cents",
  "revised_as_is_clr_cents",
  "revised_repaired_purchase_cents",
  "revised_repaired_clr_cents",
]);

const fieldSchema = z.enum(EDITABLE_FIELDS);

function parseValueFor(field: EditableField, raw: string): unknown {
  const trimmed = raw.trim();
  if (TEXT_FIELDS.has(field)) {
    return trimmed === "" ? null : trimmed;
  }
  if (MONEY_FIELDS.has(field)) {
    if (trimmed === "" || trimmed.toUpperCase() === "TBD") return null;
    const cents = Math.round(parseFloat(trimmed.replace(/[^0-9.-]/g, "")) * 100);
    return Number.isFinite(cents) ? cents : null;
  }
  if (
    field === "reserve_pct" ||
    field === "program_fee_pct" ||
    field === "resale_fee_pct" ||
    field === "revised_as_is_reserve_pct" ||
    field === "revised_repaired_reserve_pct"
  ) {
    if (trimmed === "") return null;
    const n = parseFloat(trimmed.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (field === "inspect_date") {
    if (trimmed === "" || trimmed.toUpperCase() === "TBD") return null;
    const m = trimmed.match(/^\d{4}-\d{2}-\d{2}$/);
    if (!m) throw new Error("inspect_date must be YYYY-MM-DD");
    return trimmed;
  }
  if (field === "addendum_sent_at") {
    if (trimmed === "") return null;
    const m = trimmed.match(/^\d{4}-\d{2}-\d{2}$/);
    if (!m) throw new Error("addendum_sent_at must be YYYY-MM-DD");
    return new Date(`${trimmed}T00:00:00`).toISOString();
  }
  return trimmed === "" ? null : trimmed;
}

export async function updateFieldAction(
  slug: string,
  field: string,
  rawValue: string,
): Promise<void> {
  const checkedSlug = slugSchema.parse(slug);
  const checkedField = fieldSchema.parse(field);
  const value = parseValueFor(checkedField, rawValue);
  await updatePropertyField(checkedSlug, checkedField, value as never);
  revalidatePath(`/properties/${checkedSlug}`);
  revalidatePath("/");
}

const scenarioKindSchema = z.enum(["as-is", "repaired"]);

// Atomic save of the three editable fields in an Offer Scenarios column.
// Either kind writes to a different set of columns; null clears the revision
// (falls back to the original offer in display).
export async function saveRevisedScenarioAction(
  slug: string,
  kind: "as-is" | "repaired",
  values: {
    purchaseCents: number | null;
    clrCents: number | null;
    reservePct: number | null;
  },
): Promise<void> {
  const checkedSlug = slugSchema.parse(slug);
  const checkedKind = scenarioKindSchema.parse(kind);
  const prefix = checkedKind === "as-is" ? "revised_as_is" : "revised_repaired";

  const sb = getSupabase();
  const { error } = await sb
    .from("properties")
    .update({
      [`${prefix}_purchase_cents`]: values.purchaseCents,
      [`${prefix}_clr_cents`]: values.clrCents,
      [`${prefix}_reserve_pct`]: values.reservePct,
    })
    .eq("slug", checkedSlug);
  if (error) throw error;
  revalidatePath(`/properties/${checkedSlug}`);
}

// Ordering of pipeline stages for "moving backward" detection. Terminal
// stages (cancelled, closed) are intentionally not ranked — moving into
// them is neither forward nor backward, and we preserve addendum fields
// for the historical record. Kept in sync with STAGE_ORDER in
// [@/lib/services/gmail-sync].
const STAGE_RANK: Record<string, number> = {
  "inspection-received": 0,
  "inspection-under-review": 1,
  "exec-final-review": 2,
  "addendum-sent": 3,
  title: 4,
  "contract-work": 5,
};

export async function moveStageAction(slug: string, stage: string): Promise<void> {
  const checkedSlug = slugSchema.parse(slug);
  if (!isStageId(stage)) {
    throw new Error(`Unknown stage: ${stage}`);
  }
  const target = stage as StageId;

  // Need the prior stage to know if we're leaving addendum-sent backward.
  // We can't reuse stage_changed_at for addendum_sent_at (Gmail backfill
  // may discover a send that pre-dated the drag), so the addendum fields
  // are independent — and this action is the only place that clears them
  // on a backward move.
  const sb = getSupabase();
  const { data: current, error: curErr } = await sb
    .from("properties")
    .select("stage")
    .eq("slug", checkedSlug)
    .maybeSingle();
  if (curErr) throw curErr;

  await moveStageRepo(checkedSlug, target);

  const wasAddendumSent = current?.stage === "addendum-sent";
  const targetRank = STAGE_RANK[target];
  if (
    wasAddendumSent &&
    targetRank !== undefined &&
    targetRank < STAGE_RANK["addendum-sent"]
  ) {
    await updatePropertyField(checkedSlug, "addendum_sent_at", null);
    await updatePropertyField(checkedSlug, "addendum_thread_id", null);
  }

  revalidatePath("/");
  revalidatePath(`/properties/${checkedSlug}`);
}

// Manual entry of the addendum send date (the modal that fires on
// drag-to-Addendum-Sent when addendum_sent_at is still null). The date
// arrives as YYYY-MM-DD from the picker; stored as the start of that
// day in the server's local time, then promoted to ISO. Gmail-sync will
// overwrite with the real internalDate on next run.
const addendumDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function setAddendumSentAtAction(
  slug: string,
  yyyyMmDd: string,
): Promise<void> {
  const checkedSlug = slugSchema.parse(slug);
  const checkedDate = addendumDateSchema.parse(yyyyMmDd);
  const iso = new Date(`${checkedDate}T00:00:00`).toISOString();
  await updatePropertyField(checkedSlug, "addendum_sent_at", iso);
  revalidatePath("/");
  revalidatePath(`/properties/${checkedSlug}`);
}

export async function addNoteAction(slug: string, body: string): Promise<void> {
  const checkedSlug = slugSchema.parse(slug);
  const trimmed = body.trim();
  if (!trimmed) return;

  const sb = getSupabase();
  const { data: prop, error: propErr } = await sb
    .from("properties")
    .select("id")
    .eq("slug", checkedSlug)
    .maybeSingle();
  if (propErr) throw propErr;
  if (!prop) throw new Error(`Property not found: ${checkedSlug}`);

  const existing = await listNotesForProperty(prop.id);
  const nextPos = existing.length === 0 ? 0 : Math.max(...existing.map((n) => n.position)) + 1;

  const { error } = await sb.from("property_notes").insert({
    property_id: prop.id,
    body: trimmed,
    checked: false,
    position: nextPos,
  });
  if (error) throw error;

  revalidatePath(`/properties/${checkedSlug}`);
}

export async function toggleNoteAction(
  slug: string,
  noteId: string,
  checked: boolean,
): Promise<void> {
  const checkedSlug = slugSchema.parse(slug);
  const checkedId = z.string().uuid().parse(noteId);

  const { error } = await getSupabase()
    .from("property_notes")
    .update({ checked })
    .eq("id", checkedId);
  if (error) throw error;

  revalidatePath(`/properties/${checkedSlug}`);
}

export async function deleteNoteAction(slug: string, noteId: string): Promise<void> {
  const checkedSlug = slugSchema.parse(slug);
  const checkedId = z.string().uuid().parse(noteId);

  const { error } = await getSupabase()
    .from("property_notes")
    .delete()
    .eq("id", checkedId);
  if (error) throw error;

  revalidatePath(`/properties/${checkedSlug}`);
}
