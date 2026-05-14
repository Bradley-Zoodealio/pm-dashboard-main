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
  "inspect_date",
  "assignee",
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
  if (field === "reserve_pct") {
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

export async function moveStageAction(slug: string, stage: string): Promise<void> {
  const checkedSlug = slugSchema.parse(slug);
  if (!isStageId(stage)) {
    throw new Error(`Unknown stage: ${stage}`);
  }
  await moveStageRepo(checkedSlug, stage as StageId);
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
