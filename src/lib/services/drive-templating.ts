import "server-only";

import {
  copyTemplate,
  findTemplateCopiesForAddress,
  type DriveFileResult,
} from "@/lib/google/drive";
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
  searchKeyword: string;
  fileNameFor(address: string): string;
  field: PropertyField;
}

const CONFIGS: Record<TemplateKind, TemplateConfig> = {
  comps: {
    envVar: "DRIVE_TEMPLATE_FILE_ID",
    searchKeyword: "Inspection Report",
    fileNameFor: (a) => `Comps/Inspection Report - ${a}`,
    field: "comps_url",
  },
  "remodel-bid": {
    envVar: "DRIVE_REMODEL_BID_TEMPLATE_FILE_ID",
    searchKeyword: "Remodel Bid",
    fileNameFor: (a) => `Remodel Bid - ${a}`,
    field: "remodel_bid_url",
  },
  "project-tracker": {
    envVar: "DRIVE_PROJECT_TRACKER_TEMPLATE_FILE_ID",
    searchKeyword: "Project Tracker",
    fileNameFor: (a) => `Project Tracker - ${a}`,
    field: "project_tracker_url",
  },
};

function streetPart(address: string): string {
  return address.split(",")[0].trim();
}

function existingUrl(property: PropertyRow, kind: TemplateKind): string | null {
  if (kind === "comps") return property.comps_url;
  if (kind === "remodel-bid") return property.remodel_bid_url;
  return property.project_tracker_url;
}

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

  const fragment = streetPart(property.address);
  let driveResult: DriveFileResult | null = null;
  try {
    const matches = await findTemplateCopiesForAddress(
      fragment,
      cfg.searchKeyword,
      templateId,
    );
    if (matches.length > 0) {
      driveResult = matches[0];
      await updatePropertyField(slug, cfg.field, driveResult.webViewLink as never);
      return {
        url: driveResult.webViewLink,
        reused: "drive",
        name: driveResult.name,
        matchCount: matches.length,
      };
    }
  } catch (err) {
    console.error(
      `[drive-templating] search failed for ${kind}; falling through to copy:`,
      (err as Error).message,
    );
  }

  const created = await copyTemplate(templateId, cfg.fileNameFor(property.address));
  await updatePropertyField(slug, cfg.field, created.webViewLink as never);

  return { url: created.webViewLink, reused: false, name: created.name };
}
