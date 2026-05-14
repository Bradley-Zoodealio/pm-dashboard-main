#!/usr/bin/env tsx
// Read-only smoke test: search Drive for any existing copies of the templates
// for one of our properties. No writes.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { findTemplateCopiesForAddress } from "@/lib/google/drive";

async function main() {
  const sample = "7472 S Silver Cir";
  console.log(`Searching Drive for "${sample}"…\n`);

  for (const keyword of ["Inspection Report", "Remodel Bid", "Project Tracker"]) {
    const matches = await findTemplateCopiesForAddress(sample, keyword);
    console.log(`  ${keyword.padEnd(20)} → ${matches.length} matches`);
    matches.slice(0, 3).forEach((m) => {
      console.log(`      • ${m.name}  (${m.id})`);
    });
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
