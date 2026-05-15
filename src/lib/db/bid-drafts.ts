import "server-only";

import { getSupabase } from "./supabase";

export type DraftTier = "option-1" | "option-2" | null;

export interface BidDraftRow {
  id: string;
  property_id: string | null;
  parent_draft_id: string | null;
  tier: DraftTier;
  title: string;
  created_by_email: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BidDraftItemRow {
  id: string;
  draft_id: string;
  position: number;
  description: string;
  total_cents: number | null;
  is_footer: boolean;
  source_bid_line_item_id: string | null;
}

export interface BidDraftWithItems extends BidDraftRow {
  items: BidDraftItemRow[];
}

export interface BidDraftSummary extends BidDraftRow {
  item_count: number;
  total_cents: number;
  property_address: string | null;
  property_slug: string | null;
}

// ── Default footer panel — canonical values from CLAUDE.md ──────────────────

export interface FooterSeed {
  description: string;
  total_cents: number | null;
}

export const FOOTER_SEEDS: readonly FooterSeed[] = [
  { description: "Final Clean", total_cents: 80_000 },
  { description: "Rekey + Combo Lockbox", total_cents: 35_000 },
  { description: "30 Day Per Diem for Remodel", total_cents: 310_000 },
  { description: "GC Management Fee Included", total_cents: 0 },
] as const;

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listDrafts(opts?: {
  propertyId?: string;
  includeArchived?: boolean;
  limit?: number;
}): Promise<BidDraftSummary[]> {
  const sb = getSupabase();
  let q = sb
    .from("bid_drafts")
    .select("*, properties(address, slug), bid_draft_items(total_cents)")
    .order("updated_at", { ascending: false });
  if (opts?.propertyId) q = q.eq("property_id", opts.propertyId);
  if (!opts?.includeArchived) q = q.is("archived_at", null);
  if (opts?.limit) q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const r = row as unknown as BidDraftRow & {
      properties: { address: string; slug: string } | null;
      bid_draft_items: Array<{ total_cents: number | null }>;
    };
    const items = r.bid_draft_items ?? [];
    return {
      ...r,
      properties: undefined,
      bid_draft_items: undefined,
      item_count: items.length,
      total_cents: items.reduce((s, it) => s + (it.total_cents ?? 0), 0),
      property_address: r.properties?.address ?? null,
      property_slug: r.properties?.slug ?? null,
    } as BidDraftSummary;
  });
}

export async function getDraftWithItems(id: string): Promise<BidDraftWithItems | null> {
  const sb = getSupabase();
  const draftQ = await sb.from("bid_drafts").select("*").eq("id", id).maybeSingle();
  if (draftQ.error) throw draftQ.error;
  if (!draftQ.data) return null;

  const itemsQ = await sb
    .from("bid_draft_items")
    .select("*")
    .eq("draft_id", id)
    .order("position", { ascending: true });
  if (itemsQ.error) throw itemsQ.error;

  return { ...(draftQ.data as BidDraftRow), items: (itemsQ.data ?? []) as BidDraftItemRow[] };
}

// ── Writes ─────────────────────────────────────────────────────────────────

export interface CreateDraftInput {
  propertyId?: string | null;
  parentDraftId?: string | null;
  tier?: DraftTier;
  title: string;
  seedFooters?: boolean;
  createdByEmail?: string | null;
}

export async function createDraft(input: CreateDraftInput): Promise<BidDraftRow> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bid_drafts")
    .insert({
      property_id: input.propertyId ?? null,
      parent_draft_id: input.parentDraftId ?? null,
      tier: input.tier ?? null,
      title: input.title,
      created_by_email: input.createdByEmail ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;

  if (input.seedFooters !== false) {
    const footerRows = FOOTER_SEEDS.map((f, idx) => ({
      draft_id: data.id,
      position: 1000 + idx, // footers sort to the end; bump base if you want gaps for real items
      description: f.description,
      total_cents: f.total_cents,
      is_footer: true,
    }));
    const ins = await sb.from("bid_draft_items").insert(footerRows);
    if (ins.error) throw ins.error;
  }

  return data as BidDraftRow;
}

export async function updateDraftMeta(
  id: string,
  patch: Partial<Pick<BidDraftRow, "title" | "tier" | "archived_at">>,
): Promise<BidDraftRow> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bid_drafts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as BidDraftRow;
}

export async function archiveDraft(id: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("bid_drafts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function unarchiveDraft(id: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("bid_drafts").update({ archived_at: null }).eq("id", id);
  if (error) throw error;
}

// ── Item writes ────────────────────────────────────────────────────────────

export interface AddItemInput {
  draftId: string;
  description: string;
  totalCents: number | null;
  isFooter?: boolean;
  sourceBidLineItemId?: string | null;
}

export async function addDraftItem(input: AddItemInput): Promise<BidDraftItemRow> {
  const sb = getSupabase();
  // Find next position for non-footer rows (footers stay at the end).
  const { data: rows, error: pErr } = await sb
    .from("bid_draft_items")
    .select("position")
    .eq("draft_id", input.draftId)
    .eq("is_footer", false)
    .order("position", { ascending: false })
    .limit(1);
  if (pErr) throw pErr;
  const nextPosition = (rows?.[0]?.position ?? 0) + 1;

  const { data, error } = await sb
    .from("bid_draft_items")
    .insert({
      draft_id: input.draftId,
      position: nextPosition,
      description: input.description,
      total_cents: input.totalCents,
      is_footer: input.isFooter ?? false,
      source_bid_line_item_id: input.sourceBidLineItemId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;

  await touchDraft(input.draftId);
  return data as BidDraftItemRow;
}

export async function updateDraftItem(
  itemId: string,
  patch: Partial<Pick<BidDraftItemRow, "description" | "total_cents" | "position">>,
): Promise<BidDraftItemRow> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bid_draft_items")
    .update(patch)
    .eq("id", itemId)
    .select("*, bid_drafts(id)")
    .single();
  if (error) throw error;
  const row = data as unknown as BidDraftItemRow & { bid_drafts?: { id: string } };
  if (row.bid_drafts?.id) await touchDraft(row.bid_drafts.id);
  return row;
}

export async function removeDraftItem(itemId: string): Promise<void> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bid_draft_items")
    .delete()
    .eq("id", itemId)
    .select("draft_id")
    .single();
  if (error) throw error;
  if (data?.draft_id) await touchDraft(data.draft_id);
}

export async function reorderDraftItems(draftId: string, orderedIds: string[]): Promise<void> {
  const sb = getSupabase();
  // Two-phase update to avoid unique-position collisions if we ever add one.
  // For now positions aren't unique, so a single sweep is fine.
  await Promise.all(
    orderedIds.map((id, idx) =>
      sb.from("bid_draft_items").update({ position: idx + 1 }).eq("id", id),
    ),
  );
  await touchDraft(draftId);
}

async function touchDraft(id: string): Promise<void> {
  const sb = getSupabase();
  await sb.from("bid_drafts").update({ updated_at: new Date().toISOString() }).eq("id", id);
}

// ── Duplicate as Option 2 ──────────────────────────────────────────────────

export async function duplicateAsOption2(sourceDraftId: string): Promise<string> {
  const sb = getSupabase();
  const source = await getDraftWithItems(sourceDraftId);
  if (!source) throw new Error("Source draft not found");

  // Mark source as option-1 if it doesn't have a tier yet, so the two are paired symmetrically.
  if (source.tier == null) {
    await sb.from("bid_drafts").update({ tier: "option-1" }).eq("id", sourceDraftId);
  }

  const newTitle = source.title.replace(/\bOption\s*1\b/i, "Option 2");
  const finalTitle = newTitle === source.title ? `${source.title} · Option 2` : newTitle;

  const { data: newDraft, error: newErr } = await sb
    .from("bid_drafts")
    .insert({
      property_id: source.property_id,
      parent_draft_id: sourceDraftId,
      tier: "option-2",
      title: finalTitle,
      created_by_email: source.created_by_email,
    })
    .select("*")
    .single();
  if (newErr) throw newErr;

  if (source.items.length > 0) {
    const rows = source.items.map((it) => ({
      draft_id: newDraft.id,
      position: it.position,
      description: it.description,
      total_cents: it.total_cents,
      is_footer: it.is_footer,
      source_bid_line_item_id: it.source_bid_line_item_id,
    }));
    const ins = await sb.from("bid_draft_items").insert(rows);
    if (ins.error) throw ins.error;
  }

  return newDraft.id;
}
