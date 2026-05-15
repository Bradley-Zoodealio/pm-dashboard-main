import "server-only";

import { getSupabase } from "./supabase";
import type { StageId } from "@/lib/services/stages";

export interface PropertyRow {
  id: string;
  slug: string;
  address: string;
  stage: StageId | string;
  purchase_cents: number | null;
  clr_cents: number | null;
  reserve_pct: number | null;
  inspect_date: string | null;
  assignee: string | null;
  inspect_url: string | null;
  redfin_url: string | null;
  cma_url: string | null;
  comps_url: string | null;
  questionnaire_url: string | null;
  remodel_bid_url: string | null;
  project_tracker_url: string | null;
  arv_cents: number | null;
  est_repair_cents: number | null;
  created_at: string;
  updated_at: string;
}

export interface PropertyNoteRow {
  id: string;
  property_id: string;
  body: string;
  checked: boolean;
  position: number;
  created_at: string;
}

export type PropertyField = Exclude<
  keyof PropertyRow,
  "id" | "created_at" | "updated_at"
>;

export async function listProperties(): Promise<PropertyRow[]> {
  const { data, error } = await getSupabase()
    .from("properties")
    .select("*")
    .order("inspect_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as PropertyRow[];
}

// Active properties suitable for tying a fresh bid draft to. Excludes
// ready-for-listing (renovation already done) since you don't compose new
// bids for a property that's gone to market.
export async function listActiveProperties(): Promise<
  Array<Pick<PropertyRow, "id" | "slug" | "address" | "stage" | "assignee">>
> {
  const { data, error } = await getSupabase()
    .from("properties")
    .select("id, slug, address, stage, assignee")
    .neq("stage", "ready-for-listing")
    .order("inspect_date", { ascending: false, nullsFirst: true });
  if (error) throw error;
  return (data ?? []) as Array<Pick<PropertyRow, "id" | "slug" | "address" | "stage" | "assignee">>;
}

export async function getPropertyBySlug(slug: string): Promise<PropertyRow | null> {
  const { data, error } = await getSupabase()
    .from("properties")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data as PropertyRow) ?? null;
}

export async function listNotesForProperty(propertyId: string): Promise<PropertyNoteRow[]> {
  const { data, error } = await getSupabase()
    .from("property_notes")
    .select("*")
    .eq("property_id", propertyId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PropertyNoteRow[];
}

export async function updatePropertyField<F extends PropertyField>(
  slug: string,
  field: F,
  value: PropertyRow[F],
): Promise<void> {
  const { error } = await getSupabase()
    .from("properties")
    .update({ [field]: value })
    .eq("slug", slug);
  if (error) throw error;
}

export async function moveStage(slug: string, stage: StageId): Promise<void> {
  await updatePropertyField(slug, "stage", stage);
}

export interface PropertyInsert {
  slug: string;
  address: string;
  stage: StageId | string;
  purchase_cents?: number | null;
  clr_cents?: number | null;
  reserve_pct?: number | null;
  inspect_date?: string | null;
  assignee?: string | null;
  inspect_url?: string | null;
  redfin_url?: string | null;
  cma_url?: string | null;
  comps_url?: string | null;
  questionnaire_url?: string | null;
  remodel_bid_url?: string | null;
  project_tracker_url?: string | null;
  arv_cents?: number | null;
  est_repair_cents?: number | null;
}

export async function insertProperty(row: PropertyInsert): Promise<PropertyRow> {
  const { data, error } = await getSupabase()
    .from("properties")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as PropertyRow;
}

export async function insertNotes(
  propertyId: string,
  notes: Array<{ body: string; checked: boolean; position: number }>,
): Promise<void> {
  if (notes.length === 0) return;
  const rows = notes.map((n) => ({ property_id: propertyId, ...n }));
  const { error } = await getSupabase().from("property_notes").insert(rows);
  if (error) throw error;
}
