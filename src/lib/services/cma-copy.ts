import "server-only";

import {
  copyTemplate,
  ensureDocsSubfolder,
  ensurePropertyFolder,
} from "@/lib/google/drive";
import { getPropertyBySlug, updatePropertyField } from "@/lib/db/properties";

const SHEET_ID_FROM_URL =
  /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;

export function extractSheetIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(SHEET_ID_FROM_URL);
  return m ? m[1] : null;
}

// Copy a CMA Google Sheet into a property's Docs/ subfolder under pm@'s Drive
// and persist the new file's webViewLink as the property's cma_url. The source
// must be readable by pm@tih — Contracts shares the CMA with pm@ before this
// runs (per the OAuth-pivot workflow convention).
export async function copyCmaToPropertyDocs(args: {
  slug: string;
  sourceUrl: string;
}): Promise<{ url: string; name: string }> {
  const sourceId = extractSheetIdFromUrl(args.sourceUrl);
  if (!sourceId) {
    throw new Error(`Could not parse Sheet ID from URL: ${args.sourceUrl}`);
  }

  const property = await getPropertyBySlug(args.slug);
  if (!property) throw new Error(`Property not found: ${args.slug}`);

  const propertyFolderId = await ensurePropertyFolder(args.slug);
  const docsFolderId = await ensureDocsSubfolder(propertyFolderId);
  const targetName = `CMA - ${property.address}`;

  const result = await copyTemplate(sourceId, targetName, docsFolderId);
  await updatePropertyField(args.slug, "cma_url", result.webViewLink as never);

  return { url: result.webViewLink, name: result.name };
}
