"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AccountingFolderAmbiguous,
  RenovationFolderAmbiguous,
  type AddressTokens,
  type FolderCandidate,
} from "@/lib/google/drive";
import {
  ensureDriveTemplate,
  type EnsureResult,
  type TemplateKind,
} from "@/lib/services/drive-templating";

export type TemplateActionResult =
  | { ok: true; result: EnsureResult }
  | {
      ok: false;
      needsPicker: true;
      folderKind: "accounting" | "renovation";
      address: string;
      candidates: FolderCandidate[];
      searchedYears: number[];
      searchedTokens: AddressTokens;
    };

const slugSchema = z.string().min(1).max(200);

async function run(
  slug: string,
  kind: TemplateKind,
): Promise<TemplateActionResult> {
  const checkedSlug = slugSchema.parse(slug);
  try {
    const result = await ensureDriveTemplate(checkedSlug, kind);
    revalidatePath(`/properties/${checkedSlug}`);
    revalidatePath("/");
    return { ok: true, result };
  } catch (err) {
    if (err instanceof AccountingFolderAmbiguous) {
      return {
        ok: false,
        needsPicker: true,
        folderKind: "accounting",
        address: err.address,
        candidates: [...err.candidates],
        searchedYears: [...err.searchedYears],
        searchedTokens: err.searchedTokens,
      };
    }
    if (err instanceof RenovationFolderAmbiguous) {
      return {
        ok: false,
        needsPicker: true,
        folderKind: "renovation",
        address: err.address,
        candidates: [...err.candidates],
        searchedYears: [...err.searchedYears],
        searchedTokens: err.searchedTokens,
      };
    }
    throw err;
  }
}

export async function createCompsAction(
  slug: string,
): Promise<TemplateActionResult> {
  return run(slug, "comps");
}

export async function createRemodelBidAction(
  slug: string,
): Promise<TemplateActionResult> {
  return run(slug, "remodel-bid");
}

export async function createProjectTrackerAction(
  slug: string,
): Promise<TemplateActionResult> {
  return run(slug, "project-tracker");
}
