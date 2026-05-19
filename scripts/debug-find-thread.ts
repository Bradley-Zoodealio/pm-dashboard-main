#!/usr/bin/env tsx
// Read-only: searches contracts@'s Sent folder for any subject containing
// the given keyword. Prints subject + date + thread id so we can debug
// matcher misses.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { listThreads, getThread, header } from "@/lib/google/gmail";

async function main() {
  const keyword = process.argv[2] ?? "Brian";
  const q = `in:sent subject:"${keyword}" newer_than:180d`;
  console.log(`Query: ${q}\n`);
  const threads = await listThreads(q, "tih-contracts");
  for (const t of threads) {
    const data = await getThread(t.threadId, "tih-contracts");
    const m = data.messages?.[0];
    if (!m) continue;
    const subject = header(m.payload?.headers ?? undefined, "subject");
    const date = header(m.payload?.headers ?? undefined, "date");
    console.log(`  ${subject}`);
    console.log(`    ${date}`);
    console.log(`    thread: https://mail.google.com/mail/u/0/#all/${t.threadId}\n`);
  }
  if (threads.length === 0) console.log("(no matches)");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
