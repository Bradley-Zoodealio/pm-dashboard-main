#!/usr/bin/env tsx
// Smoke test: load GOOGLE_SERVICE_ACCOUNT_JSON, instantiate JWT clients for each mailbox.
// Does NOT hit the Google API — only verifies env wiring and SA JSON shape.
// Pass --live to also call gmail.users.getProfile for each mailbox (requires DWD configured for that mailbox's domain).

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { MAILBOX_KEYS, MAILBOXES } from "@/lib/google/mailboxes";
import { getGmailClient } from "@/lib/google/auth";

const LIVE = process.argv.includes("--live");

async function main() {
  console.log(`Verifying ${MAILBOX_KEYS.length} mailboxes (live=${LIVE})…\n`);

  for (const key of MAILBOX_KEYS) {
    const mb = MAILBOXES[key];
    process.stdout.write(`  ${key.padEnd(15)} ${mb.email.padEnd(38)} `);

    let client;
    try {
      client = getGmailClient(key);
    } catch (err) {
      console.log(`✗ auth init failed: ${(err as Error).message}`);
      continue;
    }

    if (!LIVE) {
      console.log("✓ JWT client constructed");
      continue;
    }

    try {
      const profile = await client.users.getProfile({ userId: "me" });
      console.log(`✓ live OK (${profile.data.emailAddress})`);
    } catch (err) {
      console.log(`✗ live call failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
