#!/usr/bin/env tsx
// One-time migration: backfill accounting_address_folder_id, pm_review_folder_id,
// and renovation_folder_id on every property so the new Drive structure is
// live across the whole pipeline without requiring a click per property.
//
// Idempotent: skips any property whose column is already populated.
//
// What this does NOT do:
//   - Move any files. The legacy PM-drive Properties/<addr>/Docs/ folders
//     contain mostly placeholders/tests; nothing of value to migrate.
//   - Touch cancelled properties.
//   - Auto-create renovation folders. Properties that should have one but
//     don't go on the punch list (data error — fix manually).
//
// Run: NODE_OPTIONS='--conditions=react-server' npx tsx scripts/migrate-drive-layout.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import {
  AccountingFolderAmbiguous,
  ensurePmReviewFolder,
  ensureRenovationSubfolders,
  findExistingRenovationFolder,
} from "@/lib/google/drive";
import { getSupabase } from "@/lib/db/supabase";
import { updatePropertyField } from "@/lib/db/properties";

const RENOVATION_STAGES = new Set([
  "contract-work",
  "ready-for-listing",
  "closed",
]);

interface PunchItem {
  slug: string;
  address: string;
  reason: string;
}

interface Report {
  accounting: { migrated: number; skipped: number; unmatched: PunchItem[] };
  renovation: { migrated: number; skipped: number; not_relevant: number; unmatched: PunchItem[] };
}

async function main() {
  const supabase = getSupabase();
  const { data: properties, error } = await supabase
    .from("properties")
    .select("slug, address, stage, pm_review_folder_id, renovation_folder_id")
    .neq("stage", "cancelled")
    .order("address");
  if (error) throw new Error(`Property list failed: ${error.message}`);
  if (!properties || properties.length === 0) {
    console.log("No properties to migrate.");
    return;
  }

  console.log(`Migrating ${properties.length} non-cancelled properties.\n`);

  const report: Report = {
    accounting: { migrated: 0, skipped: 0, unmatched: [] },
    renovation: { migrated: 0, skipped: 0, not_relevant: 0, unmatched: [] },
  };

  for (const prop of properties) {
    console.log(`▸ ${prop.address}  [${prop.stage}]`);

    // ── Accounting + PM Review ──────────────────────────────────────────────
    if (prop.pm_review_folder_id) {
      report.accounting.skipped++;
      console.log("    accounting: skip (already linked)");
    } else {
      try {
        const pmReviewId = await ensurePmReviewFolder(prop.slug);
        report.accounting.migrated++;
        console.log(`    accounting: linked PM Review → ${pmReviewId}`);
      } catch (err) {
        const reason =
          err instanceof AccountingFolderAmbiguous
            ? err.message
            : (err as Error).message;
        report.accounting.unmatched.push({
          slug: prop.slug,
          address: prop.address,
          reason,
        });
        console.log(`    accounting: ✗ ${reason}`);
      }
    }

    // ── Renovation ──────────────────────────────────────────────────────────
    if (!RENOVATION_STAGES.has(prop.stage)) {
      report.renovation.not_relevant++;
    } else if (prop.renovation_folder_id) {
      report.renovation.skipped++;
      console.log("    renovation: skip (already linked)");
    } else {
      try {
        const result = await findExistingRenovationFolder(prop.slug);
        if (result.status === "resolved") {
          await ensureRenovationSubfolders(result.folderId);
          await updatePropertyField(
            prop.slug,
            "renovation_folder_id",
            result.folderId,
          );
          report.renovation.migrated++;
          console.log(
            `    renovation: linked Active/ in ${result.year} → ${result.folderId}`,
          );
        } else if (result.status === "ambiguous") {
          const reason = `ambiguous (${result.candidates.length} candidates in ${result.searchedYears.join(", ")}): ${result.candidates.map((c) => c.name).join("; ")}`;
          report.renovation.unmatched.push({
            slug: prop.slug,
            address: prop.address,
            reason,
          });
          console.log(`    renovation: ✗ ${reason}`);
        } else {
          const reason = `no Active folder found in ${
            result.searchedYears.length === 0
              ? "any Renovations/<year> Renovations/Active/"
              : result.searchedYears.join(" or ") + " Renovations/Active/"
          }`;
          report.renovation.unmatched.push({
            slug: prop.slug,
            address: prop.address,
            reason,
          });
          console.log(`    renovation: ✗ ${reason}`);
        }
      } catch (err) {
        report.renovation.unmatched.push({
          slug: prop.slug,
          address: prop.address,
          reason: (err as Error).message,
        });
        console.log(`    renovation: ✗ ${(err as Error).message}`);
      }
    }
  }

  // ── Final report ──────────────────────────────────────────────────────────
  console.log("\n=== Final report ===\n");

  console.log("Accounting drive (PM Review under <address>/Acquisitions/):");
  console.log(`  migrated:  ${report.accounting.migrated}`);
  console.log(`  skipped:   ${report.accounting.skipped} (already linked)`);
  console.log(`  unmatched: ${report.accounting.unmatched.length}`);
  for (const u of report.accounting.unmatched) {
    console.log(`    • ${u.address} (${u.slug})`);
    console.log(`        ${u.reason}`);
  }

  console.log(
    "\nRenovation drive (Renovations/<year> Renovations/Active/<address>/):",
  );
  console.log(`  migrated:     ${report.renovation.migrated}`);
  console.log(`  skipped:      ${report.renovation.skipped} (already linked)`);
  console.log(
    `  not_relevant: ${report.renovation.not_relevant} (stage is pre-Contract Work)`,
  );
  console.log(`  unmatched:    ${report.renovation.unmatched.length}`);
  for (const u of report.renovation.unmatched) {
    console.log(`    • ${u.address} (${u.slug})`);
    console.log(`        ${u.reason}`);
  }

  console.log(
    "\nNext step for unmatched properties: open each property page, click the relevant Create button, and use the picker modal to paste the correct Drive folder URL.",
  );
}

main().catch((err) => {
  console.error("\nFailed:", err);
  process.exit(1);
});
