#!/usr/bin/env tsx
// Dry-run the bid scraper: list Remodel Bid sheets in Drive and what we'd extract,
// without writing anything to Supabase.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { scrapeBidsFromDrive } from "@/lib/services/bid-scraper";

async function main() {
  const days = Number(process.argv[2] ?? 730);
  const summary = await scrapeBidsFromDrive({
    sinceDays: days,
    dryRun: true,
    perFileDelayMs: 200,
    onProgress: (m) => console.log("  " + m),
  });
  console.log(`\nSummary: files=${summary.filesSeen} bids=${summary.bidsUpserted} items=${summary.itemsUpserted} errors=${summary.errors.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
