#!/usr/bin/env tsx
// Read-only: prints addendum_sent_at + addendum_thread_id for every
// property currently in Addendum Sent. Used to confirm the backfill
// landed.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { listProperties } from "@/lib/db/properties";

async function main() {
  const props = await listProperties();
  const inAddendum = props.filter((p) => p.stage === "addendum-sent");
  console.log(`Currently in Addendum Sent: ${inAddendum.length}\n`);
  for (const p of inAddendum) {
    const sent = p.addendum_sent_at
      ? new Date(p.addendum_sent_at).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "(null)";
    const days = p.addendum_sent_at
      ? Math.round(
          (Date.now() - new Date(p.addendum_sent_at).getTime()) /
            86_400_000,
        )
      : null;
    const deadlineDelta = days != null ? 5 - days : null;
    const deadlineNote =
      deadlineDelta == null
        ? ""
        : deadlineDelta < 0
          ? `  ⚠ ${Math.abs(deadlineDelta)}d past deadline`
          : deadlineDelta === 0
            ? `  · deadline today`
            : `  · ${deadlineDelta}d left`;
    console.log(`  ${p.address}`);
    console.log(`    sent: ${sent}${deadlineNote}`);
    console.log(`    thread: ${p.addendum_thread_id ?? "(null)"}\n`);
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
