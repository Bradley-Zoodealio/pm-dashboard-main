import "server-only";

import {
  copyTemplate,
  ensurePmReviewFolder,
  ensureRenovationFolder,
  findFileByNameInFolder,
  type DriveFileResult,
} from "@/lib/google/drive";
import type { MailboxKey } from "@/lib/google/mailboxes";
import {
  getPropertyBySlug,
  updatePropertyField,
  type PropertyField,
  type PropertyRow,
} from "@/lib/db/properties";

export type TemplateKind = "comps" | "remodel-bid" | "project-tracker";

export type EnsureResult =
  | { url: string; reused: "linked" }
  | { url: string; reused: "drive"; name: string; matchCount: number }
  | { url: string; reused: false; name: string };

interface TemplateConfig {
  envVar: string;
  fileNameFor(address: string): string;
  field: PropertyField;
  // Which Drive account owns the destination folder. Comps + Remodel Bid land
  // in the accounting Drive's PM Review/; Project Tracker stays in pm@.
  mailbox: MailboxKey;
  resolveFolderId(slug: string): Promise<string>;
}

const CONFIGS: Record<TemplateKind, TemplateConfig> = {
  comps: {
    envVar: "DRIVE_TEMPLATE_FILE_ID",
    fileNameFor: (a) => `Comps - ${a}`,
    field: "comps_url",
    mailbox: "tih-accounting",
    resolveFolderId: ensurePmReviewFolder,
  },
  "remodel-bid": {
    envVar: "DRIVE_REMODEL_BID_TEMPLATE_FILE_ID",
    fileNameFor: (a) => `Remodel Bid - ${a}`,
    field: "remodel_bid_url",
    mailbox: "tih-accounting",
    resolveFolderId: ensurePmReviewFolder,
  },
  "project-tracker": {
    envVar: "DRIVE_PROJECT_TRACKER_TEMPLATE_FILE_ID",
    fileNameFor: (a) => `Project Tracker - ${a}`,
    field: "project_tracker_url",
    mailbox: "tih-pm",
    resolveFolderId: ensureRenovationFolder,
  },
};

function existingUrl(property: PropertyRow, kind: TemplateKind): string | null {
  if (kind === "comps") return property.comps_url;
  if (kind === "remodel-bid") return property.remodel_bid_url;
  return property.project_tracker_url;
}

// Resolve a property's Drive artifact (Comps / Remodel Bid / Project Tracker).
// Order of preference:
//   1. URL already linked on the property row — reuse.
//   2. A file with the canonical name already in the destination folder — link + reuse.
//   3. Otherwise, copy the template into the destination folder.
// Destination folder is resolved per-kind:
//   - Comps + Remodel Bid → accounting Drive's PM Review/ via ensurePmReviewFolder
//   - Project Tracker → pm@ Drive's Active/<address>/ via ensureRenovationFolder
export async function ensureDriveTemplate(
  slug: string,
  kind: TemplateKind,
): Promise<EnsureResult> {
  const cfg = CONFIGS[kind];
  const templateId = process.env[cfg.envVar];
  if (!templateId) {
    throw new Error(`${cfg.envVar} not configured`);
  }

  const property = await getPropertyBySlug(slug);
  if (!property) throw new Error(`Property not found: ${slug}`);

  const linked = existingUrl(property, kind);
  if (linked) {
    return { url: linked, reused: "linked" };
  }

  const destinationFolderId = await cfg.resolveFolderId(slug);
  const targetName = cfg.fileNameFor(property.address);

  let resolved: DriveFileResult;
  let reusedFromDrive = false;

  const existing = await findFileByNameInFolder(
    destinationFolderId,
    targetName,
    cfg.mailbox,
  );
  if (existing) {
    resolved = existing;
    reusedFromDrive = true;
  } else {
    resolved = await copyTemplate(
      templateId,
      targetName,
      destinationFolderId,
      cfg.mailbox,
    );
  }

  await updatePropertyField(slug, cfg.field, resolved.webViewLink as never);

  return reusedFromDrive
    ? {
        url: resolved.webViewLink,
        reused: "drive",
        name: resolved.name,
        matchCount: 1,
      }
    : { url: resolved.webViewLink, reused: false, name: resolved.name };
}
