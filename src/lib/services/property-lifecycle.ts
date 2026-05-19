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

// Cron-side helper: properties stuck in ready-for-listing past the cutoff
// get auto-closed. Uses stage_changed_at (not updated_at).
export async function findAutoCloseCandidates(
  cutoff: Date,
): Promise<Array<{ slug: string }>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("properties")
    .select("slug, stage_changed_at")
    .eq("stage", "ready-for-listing")
    .lt("stage_changed_at", cutoff.toISOString());
  if (error) throw new Error(`auto-close query failed: ${error.message}`);
  return (data ?? []) as Array<{ slug: string }>;
}
