"use server";

import { revalidatePath } from "next/cache";
import {
  addDraftItem,
  archiveDraft,
  createDraft,
  duplicateAsOption2,
  removeDraftItem,
  reorderDraftItems,
  unarchiveDraft,
  updateDraftItem,
  updateDraftMeta,
  type BidDraftItemRow,
  type BidDraftRow,
  type DraftTier,
} from "@/lib/db/bid-drafts";
import { getPropertyBySlug } from "@/lib/db/properties";
import {
  ensureOptionsTabs,
  extractSpreadsheetId,
  listSheetTabs,
  writeLineItemsToSheet,
  type LineItem,
} from "@/lib/google/sheets";
import { getDraftWithItems } from "@/lib/db/bid-drafts";

export async function createDraftAction(input: {
  propertySlug?: string | null;
  title?: string;
  tier?: DraftTier;
}): Promise<{ draftId: string }> {
  let propertyId: string | null = null;
  let title: string;

  if (input.propertySlug) {
    const property = await getPropertyBySlug(input.propertySlug);
    if (!property) throw new Error(`Property "${input.propertySlug}" not found`);
    propertyId = property.id;
    // For property-tied drafts, the address is always the right title unless
    // the caller explicitly overrides.
    title = input.title?.trim() || property.address;
  } else {
    // Generic drafts MUST be given a title up front. No auto-generated
    // "Standalone draft · DATE" — those just become clutter the user has
    // to rename later.
    const trimmed = input.title?.trim() ?? "";
    if (!trimmed) {
      throw new Error("A generic draft needs a title. Pass a non-empty `title` or a `propertySlug`.");
    }
    title = trimmed;
  }

  const draft = await createDraft({
    propertyId,
    title,
    tier: input.tier ?? null,
  });

  revalidatePath("/bids/drafts");
  return { draftId: draft.id };
}

export async function updateDraftTitleAction(
  draftId: string,
  title: string,
): Promise<BidDraftRow> {
  const draft = await updateDraftMeta(draftId, { title });
  revalidatePath("/bids/drafts");
  return draft;
}

export async function archiveDraftAction(draftId: string): Promise<void> {
  await archiveDraft(draftId);
  revalidatePath("/bids/drafts");
}

export async function unarchiveDraftAction(draftId: string): Promise<void> {
  await unarchiveDraft(draftId);
  revalidatePath("/bids/drafts");
}

export async function addDraftItemAction(input: {
  draftId: string;
  description: string;
  totalCents: number | null;
  sourceBidLineItemId?: string | null;
}): Promise<BidDraftItemRow> {
  return addDraftItem({
    draftId: input.draftId,
    description: input.description,
    totalCents: input.totalCents,
    sourceBidLineItemId: input.sourceBidLineItemId ?? null,
  });
}

// Quick-add from the Items tab. Targets the most-recently-updated *standalone*
// active draft. If none exists, creates one. The caller gets back the draft ID
// so it can prompt the user to open it.
export async function quickAddPhrasingAction(
  description: string,
  totalCents: number | null,
): Promise<{ draftId: string; draftTitle: string; createdNew: boolean }> {
  const { listDrafts } = await import("@/lib/db/bid-drafts");
  const candidates = await listDrafts({ limit: 5 });
  let target = candidates.find((d) => d.property_id == null);
  let createdNew = false;
  if (!target) {
    const newDraft = await createDraft({
      title: `Items cart · ${new Date().toISOString().slice(0, 10)}`,
    });
    createdNew = true;
    target = {
      ...newDraft,
      item_count: 0,
      total_cents: 0,
      property_address: null,
      property_slug: null,
    };
  }
  await addDraftItem({
    draftId: target.id,
    description,
    totalCents,
  });
  return { draftId: target.id, draftTitle: target.title, createdNew };
}

export async function updateDraftItemAction(
  itemId: string,
  patch: { description?: string; totalCents?: number | null },
): Promise<BidDraftItemRow> {
  const dbPatch: Partial<Pick<BidDraftItemRow, "description" | "total_cents">> = {};
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.totalCents !== undefined) dbPatch.total_cents = patch.totalCents;
  return updateDraftItem(itemId, dbPatch);
}

export async function removeDraftItemAction(itemId: string): Promise<void> {
  await removeDraftItem(itemId);
}

export async function reorderDraftItemsAction(
  draftId: string,
  orderedIds: string[],
): Promise<void> {
  await reorderDraftItems(draftId, orderedIds);
}

export async function duplicateAsOption2Action(draftId: string): Promise<{ draftId: string }> {
  const newId = await duplicateAsOption2(draftId);
  revalidatePath("/bids/drafts");
  return { draftId: newId };
}

// ── Send draft to the property's Remodel Bid sheet ─────────────────────────

export interface SendToSheetResult {
  ok: boolean;
  spreadsheetId: string;
  tabName: string;
  itemCount: number;
  warning?: string;
}

export async function sendDraftToSheetAction(
  draftId: string,
): Promise<SendToSheetResult> {
  const draft = await getDraftWithItems(draftId);
  if (!draft) throw new Error("Draft not found");
  if (!draft.property_id) {
    throw new Error("Standalone drafts can't be written to a sheet — open the draft from a property page first.");
  }

  // Fetch the property to find the Remodel Bid sheet URL.
  const sb = (await import("@/lib/db/supabase")).getSupabase();
  const propQ = await sb
    .from("properties")
    .select("remodel_bid_url, address")
    .eq("id", draft.property_id)
    .single();
  if (propQ.error || !propQ.data) throw propQ.error ?? new Error("Property not found");
  const property = propQ.data as { remodel_bid_url: string | null; address: string };
  if (!property.remodel_bid_url) {
    throw new Error(`${property.address} has no Remodel Bid sheet yet. Click "Create Remodel Bid" on the property page first.`);
  }

  const spreadsheetId = extractSpreadsheetId(property.remodel_bid_url);
  if (!spreadsheetId) throw new Error("Couldn't extract spreadsheet ID from the bid URL.");

  // Determine target tab.
  let tabName: string;
  let warning: string | undefined;
  if (draft.tier === "option-2") {
    await ensureOptionsTabs(spreadsheetId);
    tabName = "Option 2";
  } else {
    const tabs = await listSheetTabs(spreadsheetId);
    const preferred =
      tabs.find((t) => t.title === "Option 1") ??
      tabs.find((t) => t.title === "Invoice") ??
      tabs.sort((a, b) => a.index - b.index)[0];
    if (!preferred) throw new Error("Sheet has no tabs.");
    tabName = preferred.title;
    if (draft.tier === "option-1" && preferred.title !== "Option 1") {
      warning = `Wrote to "${preferred.title}" (the sheet has no "Option 1" tab).`;
    }
  }

  // Sort items: non-footers by position asc, then footers by position asc.
  const ordered = [...draft.items].sort((a, b) => {
    if (a.is_footer !== b.is_footer) return a.is_footer ? 1 : -1;
    return a.position - b.position;
  });

  // Items with null total_cents or empty description don't get written.
  const lineItems: LineItem[] = ordered
    .filter((i) => i.description.trim().length > 0 && i.total_cents != null)
    .map((i) => ({ description: i.description, total: (i.total_cents as number) / 100 }));

  const count = await writeLineItemsToSheet(spreadsheetId, lineItems, tabName);

  return { ok: true, spreadsheetId, tabName, itemCount: count, warning };
}
