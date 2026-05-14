"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  extractSpreadsheetId,
  writeLineItemsToSheet,
  ensureOptionsTabs,
  type LineItem,
} from "@/lib/google/sheets";
import { getPropertyBySlug } from "@/lib/db/properties";

const slugSchema = z.string().min(1).max(200);
const lineItemSchema = z.object({
  description: z.string().min(1),
  total: z.number().nonnegative(),
});

export interface FillBidResult {
  written: number;
  tab: string | null;
  spreadsheetId: string;
}

export async function fillBidLineItemsAction(
  slug: string,
  rawJson: string,
  tab?: string,
): Promise<FillBidResult> {
  const checkedSlug = slugSchema.parse(slug);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsedJson)) {
    throw new Error("Expected a JSON array of {description, total} objects");
  }
  const items: LineItem[] = parsedJson.map((it, i) => {
    try {
      return lineItemSchema.parse(it);
    } catch (err) {
      throw new Error(`item[${i}]: ${(err as Error).message}`);
    }
  });

  const property = await getPropertyBySlug(checkedSlug);
  if (!property) throw new Error(`Property not found: ${checkedSlug}`);
  if (!property.remodel_bid_url) {
    throw new Error("Property has no remodel_bid_url set. Create a Remodel Bid first.");
  }

  const spreadsheetId = extractSpreadsheetId(property.remodel_bid_url);
  if (!spreadsheetId) {
    throw new Error(`Could not extract spreadsheet ID from ${property.remodel_bid_url}`);
  }

  if (tab && /^Option\s*\d+$/i.test(tab)) {
    await ensureOptionsTabs(spreadsheetId);
  }

  const written = await writeLineItemsToSheet(spreadsheetId, items, tab);
  revalidatePath(`/properties/${checkedSlug}`);
  return { written, tab: tab ?? null, spreadsheetId };
}
