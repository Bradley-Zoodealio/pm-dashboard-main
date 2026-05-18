#!/usr/bin/env tsx
// Read-only: runs the Gmail sync scanner against the live inbox.
// Prints the proposed plan but does NOT write to Postgres.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { scanForPipelineChanges } from "@/lib/services/gmail-sync";
import { labelFor } from "@/lib/services/stages";

async function main() {
  const days = Number(process.argv[2] ?? 30);
  console.log(`Scanning Gmail for inspection threads (last ${days} days)…\n`);

  const result = await scanForPipelineChanges({ sinceDays: days });
  console.log(`Scanned ${result.scannedThreads} threads`);
  console.log(`Existing properties in DB: ${result.existingCount}`);
  console.log(`Proposed plan items: ${result.plan.length}\n`);

  for (const item of result.plan) {
    if (item.type === "add") {
      console.log(`  ADD       ${item.address}`);
      console.log(`            → ${labelFor(item.toStage)}`);
      if (item.note) console.log(`            note: ${item.note}`);
      if (item.copyCma)
        console.log(`            will copy CMA: ${item.copyCma.sourceUrl}`);
    } else if (item.type === "move") {
      console.log(`  MOVE      ${item.address}`);
      console.log(`            ${labelFor(item.fromStage)} → ${labelFor(item.toStage)}`);
      console.log(`            note: ${item.note}`);
    } else {
      console.log(`  COPY-CMA  ${item.address}`);
      console.log(`            source: ${item.sourceUrl}`);
    }
    console.log(`        thread: https://mail.google.com/mail/u/0/#all/${item.threadId}\n`);
  }

  if (result.plan.length === 0) {
    console.log("(No changes proposed — board is in sync with Gmail.)");
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
