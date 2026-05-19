import "server-only";

import { getSupabase } from "@/lib/db/supabase";
import { getPropertyBySlug } from "@/lib/db/properties";
import type { PipelineStageId } from "./stages";

// Cancel a property: terminal state with a required reason. Cancellation is
// reversible via restoreFromTerminal — audit columns persist for the lifetime
// of the row. Drive folders are not touched; the accounting team manages the
// accounting folder lifecycle, and the renovation folder (if any) is moved
// to Completed/ manually.
export async function cancelPropertyService(args: {
  slug: string;
  reason: string;
}): Promise<void> {
  const reason = args.reason.trim();
  if (reason.length < 5) {
    throw new Error("Cancellation reason must be at least 5 characters.");
  }

  const property = await getPropertyBySlug(args.slug);
  if (!property) throw new Error(`Property not found: ${args.slug}`);

  const sb = getSupabase();
  const { error } = await sb
    .from("properties")
    .update({
      stage: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_reason: reason,
    })
    .eq("slug", args.slug);
  if (error) throw new Error(`cancel update failed: ${error.message}`);
}

// Close a property: marks the work as fully complete. Used both from the
// "Mark Closed" button on Ready-for-Listing rows and the auto-close cron.
// Drive folders are not touched (see note on cancelPropertyService).
export async function closePropertyService(slug: string): Promise<void> {
  const property = await getPropertyBySlug(slug);
  if (!property) throw new Error(`Property not found: ${slug}`);

  const sb = getSupabase();
  const { error } = await sb
    .from("properties")
    .update({
      stage: "closed",
      closed_at: new Date().toISOString(),
    })
    .eq("slug", slug);
  if (error) throw new Error(`close update failed: ${error.message}`);
}

// Restore from a terminal state. Audit columns (cancelled_at, cancelled_reason,
// closed_at) are preserved as a paper trail. Drive folders are not touched.
export async function restoreFromTerminalService(args: {
  slug: string;
  newStage: PipelineStageId;
}): Promise<void> {
  const property = await getPropertyBySlug(args.slug);
  if (!property) throw new Error(`Property not found: ${args.slug}`);

  const sb = getSupabase();
  const { error } = await sb
    .from("properties")
    .update({ stage: args.newStage })
    .eq("slug", args.slug);
  if (error) throw new Error(`restore update failed: ${error.message}`);
}

// Mark renovation complete: flags the property as done WITHOUT changing
// stage. The board hides the card 24h after this timestamp; the auto-close
// cron closes it after 2 days. Only callable from contract-work.
export async function markRenovationCompleteService(args: {
  slug: string;
  note: string;
}): Promise<void> {
  const note = args.note.trim();
  if (note.length < 5) {
    throw new Error("Completion note must be at least 5 characters.");
  }

  const property = await getPropertyBySlug(args.slug);
  if (!property) throw new Error(`Property not found: ${args.slug}`);
  if (property.stage !== "contract-work") {
    throw new Error(
      `Can only mark renovation complete from contract-work (currently: ${property.stage}).`,
    );
  }
  if (property.renovation_completed_at) {
    throw new Error(
      `Renovation already marked complete at ${property.renovation_completed_at}.`,
    );
  }

  const sb = getSupabase();
  const { error } = await sb
    .from("properties")
    .update({
      renovation_completed_at: new Date().toISOString(),
      renovation_complete_note: note,
    })
    .eq("slug", args.slug);
  if (error)
    throw new Error(`mark renovation complete failed: ${error.message}`);
}

// Undo a renovation-complete mark: clears the completion timestamp + note
// so the card returns to the active board with the standard contract-work
// tint. Stage doesn't move (it was contract-work the whole time).
export async function undoRenovationCompleteService(args: {
  slug: string;
}): Promise<void> {
  const property = await getPropertyBySlug(args.slug);
  if (!property) throw new Error(`Property not found: ${args.slug}`);
  if (!property.renovation_completed_at) {
    throw new Error(`Renovation is not marked complete for ${args.slug}.`);
  }

  const sb = getSupabase();
  const { error } = await sb
    .from("properties")
    .update({
      renovation_completed_at: null,
      renovation_complete_note: null,
    })
    .eq("slug", args.slug);
  if (error)
    throw new Error(`undo renovation complete failed: ${error.message}`);
}

// Cron-side helper: properties whose renovation was completed past the
// cutoff get auto-closed. Stage is still contract-work; the cron flips it
// straight to closed.
export async function findAutoCloseCandidates(
  cutoff: Date,
): Promise<Array<{ slug: string }>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("properties")
    .select("slug, renovation_completed_at")
    .eq("stage", "contract-work")
    .not("renovation_completed_at", "is", null)
    .lt("renovation_completed_at", cutoff.toISOString());
  if (error) throw new Error(`auto-close query failed: ${error.message}`);
  return (data ?? []) as Array<{ slug: string }>;
}
