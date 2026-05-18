"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  cancelPropertyService,
  closePropertyService,
  restoreFromTerminalService,
} from "@/lib/services/property-lifecycle";
import { STAGES, type PipelineStageId } from "@/lib/services/stages";

const slugSchema = z.string().min(1).max(200);
const PIPELINE_IDS = new Set<string>(STAGES.map((s) => s.id));

function revalidateAfterTransition(slug: string): void {
  revalidatePath("/");
  revalidatePath(`/properties/${slug}`);
}

export async function cancelPropertyAction(formData: FormData): Promise<void> {
  const slug = slugSchema.parse(formData.get("slug"));
  const reason = String(formData.get("reason") ?? "");
  await cancelPropertyService({ slug, reason });
  revalidateAfterTransition(slug);
}

export async function closePropertyAction(slug: string): Promise<void> {
  const checkedSlug = slugSchema.parse(slug);
  await closePropertyService(checkedSlug);
  revalidateAfterTransition(checkedSlug);
}

export async function restoreFromTerminalAction(
  formData: FormData,
): Promise<void> {
  const slug = slugSchema.parse(formData.get("slug"));
  const newStage = String(formData.get("newStage") ?? "");
  if (!PIPELINE_IDS.has(newStage)) {
    throw new Error(`Cannot restore to non-pipeline stage: ${newStage}`);
  }
  await restoreFromTerminalService({
    slug,
    newStage: newStage as PipelineStageId,
  });
  revalidateAfterTransition(slug);
}
