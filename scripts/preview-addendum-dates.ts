#!/usr/bin/env tsx
// Read-only: for every property currently in Addendum Sent stage,
// looks up the matching outbound "Inspection Addendum Response - <addr>"
// thread in contracts@'s Sent folder and prints the detected send instant.
// Does NOT write to Postgres or change anything in Gmail.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { scanForPipelineChanges } from "@/lib/services/gmail-sync";
import { listProperties } from "@/lib/db/properties";

async function main() {
  const days = Number(process.argv[2] ?? 60);
  const [props, scan] = await Promise.all([
    listProperties(),
    scanForPipelineChanges({ sinceDays: days }),
  ]);

  const inAddendum = props.filter((p) => p.stage === "addendum-sent");
  console.log(`Properties currently in Addendum Sent: ${inAddendum.length}\n`);

  const bySlug = new Map<string, { sentAtIso: string; threadId: string }>();
  for (const item of scan.plan) {
    if (item.type !== "addendum-detected") continue;
    bySlug.set(item.slug, {
      sentAtIso: item.sentAtIso,
      threadId: item.threadId,
    });
  }

  for (const p of inAddendum) {
    const hit = bySlug.get(p.slug);
    if (!hit) {
      console.log(`  ${p.address}`);
      console.log(`    (no outbound addendum email found in last ${days}d)\n`);
      continue;
    }
    const ymd = new Date(hit.sentAtIso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const daysAgo = Math.round(
      (Date.now() - new Date(hit.sentAtIso).getTime()) / 86_400_000,
    );
    console.log(`  ${p.address}`);
    console.log(`    sent: ${ymd} (${daysAgo} days ago)`);
    console.log(
      `    thread: https://mail.google.com/mail/u/0/#all/${hit.threadId}\n`,
    );
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
