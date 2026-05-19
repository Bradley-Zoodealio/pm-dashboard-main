#!/usr/bin/env tsx
// Read-only: sanity check after the backfill. Confirms questionnaire_url
// now points at drive.google.com and that inspection_thread_id was
// populated from the old Gmail URL.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { listProperties } from "@/lib/db/properties";

async function main() {
  const props = await listProperties();
  let drivePointed = 0;
  let stillGmail = 0;
  let nullUrl = 0;
  let withThread = 0;
  let withoutThread = 0;
  const stragglers: typeof props = [];

  for (const p of props) {
    if (!p.questionnaire_url) nullUrl++;
    else if (p.questionnaire_url.includes("drive.google.com")) drivePointed++;
    else if (p.questionnaire_url.includes("mail.google.com")) {
      stillGmail++;
      stragglers.push(p);
    } else stragglers.push(p);

    if (p.inspection_thread_id) withThread++;
    else withoutThread++;
  }

  console.log(`Total properties:                ${props.length}`);
  console.log(`questionnaire_url → drive.google: ${drivePointed}`);
  console.log(`questionnaire_url → mail.google:  ${stillGmail}`);
  console.log(`questionnaire_url null:           ${nullUrl}`);
  console.log(`inspection_thread_id set:         ${withThread}`);
  console.log(`inspection_thread_id null:        ${withoutThread}`);
  if (stragglers.length > 0) {
    console.log("\nStill on Gmail (or other):");
    for (const p of stragglers) {
      console.log(`  - ${p.address}: ${p.questionnaire_url}`);
    }
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
