#!/usr/bin/env tsx
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import {
  listProperties,
  getPropertyBySlug,
  listNotesForProperty,
} from "@/lib/db/properties";

async function main() {
  const all = await listProperties();
  console.log(`listProperties → ${all.length} rows`);
  for (const p of all) {
    console.log(`  ${p.stage.padEnd(24)} ${p.address}`);
  }

  const sample = await getPropertyBySlug("7472-s-silver-cir-west-jordan-ut-84084");
  console.log(
    `\ngetPropertyBySlug(7472-s-silver-cir…) → ${sample?.address ?? "null"} | stage=${sample?.stage} | purchase_cents=${sample?.purchase_cents}`,
  );
  if (sample) {
    const notes = await listNotesForProperty(sample.id);
    notes.forEach((n) => console.log(`  note[${n.position}] ${n.checked ? "x" : " "} ${n.body}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
