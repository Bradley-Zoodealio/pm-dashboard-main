#!/usr/bin/env tsx
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { checkAllMailboxes } from "@/lib/services/mailbox-health";

async function main() {
  const checks = await checkAllMailboxes();
  for (const c of checks) {
    const status = c.ok ? "✓" : "✗";
    const detail = c.ok ? c.emailAddress : c.error;
    console.log(`  ${status} ${c.key.padEnd(15)} ${c.email.padEnd(38)} ${detail ?? ""}`);
  }
  console.log(`\n${checks.filter((c) => c.ok).length} of ${checks.length} mailboxes reachable.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
