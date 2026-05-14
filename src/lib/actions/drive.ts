"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  ensureDriveTemplate,
  type EnsureResult,
  type TemplateKind,
} from "@/lib/services/drive-templating";

const slugSchema = z.string().min(1).max(200);

async function run(slug: string, kind: TemplateKind): Promise<EnsureResult> {
  const checkedSlug = slugSchema.parse(slug);
  const result = await ensureDriveTemplate(checkedSlug, kind);
  revalidatePath(`/properties/${checkedSlug}`);
  revalidatePath("/");
  return result;
}

export async function createCompsAction(slug: string): Promise<EnsureResult> {
  return run(slug, "comps");
}

export async function createRemodelBidAction(slug: string): Promise<EnsureResult> {
  return run(slug, "remodel-bid");
}

export async function createProjectTrackerAction(slug: string): Promise<EnsureResult> {
  return run(slug, "project-tracker");
}
