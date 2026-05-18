import "server-only";

import { getSupabase } from "@/lib/db/supabase";
import { getPropertyBySlug } from "@/lib/db/properties";
import { ensurePropertyFolder, moveFolderToBucket } from "@/lib/google/drive";
import type { PipelineStageId } from "./stages";

// Cancel a property: terminal state with a required reason. Moves the Drive
// folder into Properties/Cancelled/ on success. Cancellation is reversible
// via restoreFromTerminal — audit columns persist for the lifetime of the row.
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

  const folderId =
    property.drive_folder_id ?? (await ensurePropertyFolder(args.slug));

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

  try {
    await moveFolderToBucket(folderId, "Cancelled");
  } catch (err) {
    // Drive move failure isn't fatal — DB state is the source of truth. Log
    // and let the user move the folder manually if needed.
    console.error(
      `[cancel] Drive folder move failed for ${args.slug}: ${(err as Error).message}`,
    );
  }
}

// Close a property: marks the work as fully complete. Used both from the
// "Mark Closed" button on Ready-for-Listing rows and the auto-close cron.
export async function closePropertyService(slug: string): Promise<void> {
  const property = await getPropertyBySlug(slug);
  if (!property) throw new Error(`Property not found: ${slug}`);

  const folderId =
    property.drive_folder_id ?? (await ensurePropertyFolder(slug));

  const sb = getSupabase();
  const { error } = await sb
    .from("properties")
    .update({
      stage: "closed",
      closed_at: new Date().toISOString(),
    })
    .eq("slug", slug);
  if (error) throw new Error(`close update failed: ${error.message}`);

  try {
    await moveFolderToBucket(folderId, "Closed");
  } catch (err) {
    console.error(
      `[close] Drive folder move failed for ${slug}: ${(err as Error).message}`,
    );
  }
}

// Restore from a terminal state. Audit columns (cancelled_at, cancelled_reason,
// closed_at) are preserved as a paper trail. Drive folder is moved back under
// Properties/ root (not into a bucket).
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

  if (property.drive_folder_id) {
    try {
      // moveFolderToBucket only handles Cancelled/Closed targets — for a
      // restore, we need to move out of those into the root. Re-parent
      // manually here.
      const { google } = await import("googleapis");
      const { getDriveClient } = await import("@/lib/google/auth");
      const drive = await getDriveClient("tih-pm");
      void google;

      const { data: rootSearch } = await drive.files.list({
        q: "name = 'Properties' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false",
        fields: "files(id)",
        pageSize: 1,
      });
      const rootId = rootSearch.files?.[0]?.id;
      if (!rootId) {
        console.warn("[restore] could not find Properties root; skipping move");
        return;
      }
      const { data: current } = await drive.files.get({
        fileId: property.drive_folder_id,
        fields: "parents",
      });
      const oldParents = (current.parents ?? []).join(",");
      await drive.files.update({
        fileId: property.drive_folder_id,
        addParents: rootId,
        removeParents: oldParents,
        fields: "id, parents",
      });
    } catch (err) {
      console.error(
        `[restore] Drive folder move failed for ${args.slug}: ${(err as Error).message}`,
      );
    }
  }
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
