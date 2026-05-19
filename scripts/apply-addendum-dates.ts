#!/usr/bin/env tsx
// Backfills addendum_sent_at + addendum_thread_id for every property
// matched by the addendum-response detector. Filters the scan's plan
// to ONLY addendum-detected items — other categories (new property
// adds, FIX-URL updates, copy-cma, stage moves) are not applied by
// this script. Run via:
//   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/apply-addendum-dates.ts [days]

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import {
  applyPlan,
  scanForPipelineChanges,
} from "@/lib/services/gmail-sync";

async function main() {
  const days = Number(process.argv[2] ?? 90);
  console.log(`Scanning contracts@ Sent folder (last ${days} days)…\n`);

  const scan = await scanForPipelineChanges({ sinceDays: days });
  const addendumOnly = scan.plan.filter((p) => p.type === "addendum-detected");
  console.log(`Total plan items: ${scan.plan.length}`);
  console.log(`Addendum-detected items: ${addendumOnly.length}\n`);

  if (addendumOnly.length === 0) {
    console.log("Nothing to apply.");
    return;
  }

  for (const item of addendumOnly) {
    if (item.type !== "addendum-detected") continue;
    const ymd = new Date(item.sentAtIso).toLocaleDateString();
    const stageNote = item.toStage
      ? `${item.fromStage} → ${item.toStage}`
      : "backfill (stage unchanged)";
    console.log(`  ${item.address}  ·  ${ymd}  ·  ${stageNote}`);
  }
  console.log("");

  const result = await applyPlan(addendumOnly);
  console.log(`Applied: ${result.applied}   Failed: ${result.failed}\n`);
  for (const d of result.details) {
    if (d.ok) continue;
    if (d.item.type !== "addendum-detected") continue;
    console.log(`  FAIL ${d.item.address}: ${d.error}`);
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
