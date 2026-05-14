"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  applyPlan,
  scanForPipelineChanges,
  type PlanItem,
  type ScanResult,
  type ApplyResult,
} from "@/lib/services/gmail-sync";

const scanOpts = z.object({
  sinceDays: z.number().int().min(1).max(365).optional(),
});

export async function scanGmailAction(
  opts: { sinceDays?: number } = {},
): Promise<ScanResult> {
  const parsed = scanOpts.parse(opts);
  return scanForPipelineChanges({ sinceDays: parsed.sinceDays });
}

export async function applyGmailPlanAction(
  plan: PlanItem[],
): Promise<ApplyResult> {
  if (!Array.isArray(plan) || plan.length === 0) {
    return { applied: 0, failed: 0, details: [] };
  }
  const result = await applyPlan(plan);
  revalidatePath("/");
  for (const detail of result.details) {
    if (detail.ok) {
      const slug = detail.item.type === "add"
        ? detail.item.fields.slug
        : detail.item.slug;
      revalidatePath(`/properties/${slug}`);
    }
  }
  return result;
}
