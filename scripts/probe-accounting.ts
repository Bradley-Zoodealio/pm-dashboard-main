#!/usr/bin/env tsx
// Probe: end-to-end verification of Task #3 (tih-accounting) + Task #4
// (tih-pm renovation) Drive helpers. Dry-run by default (no DB writes, no
// folder creation). Pass --commit to actually create folders + persist IDs.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import {
  AccountingFolderAmbiguous,
  ensurePmReviewFolder,
  extractAddressTokens,
} from "@/lib/google/drive";
import { getDriveClient } from "@/lib/google/auth";
import { getSupabase } from "@/lib/db/supabase";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function escapeQuery(s: string): string {
  return s.replace(/'/g, "\\'");
}

async function main() {
  const commit = process.argv.includes("--commit");
  console.log(commit ? "MODE: --commit (writes enabled)\n" : "MODE: dry-run (read-only)\n");

  // ── 1. Auth smoke: tih-accounting Drive token works on a non-callback path ─
  console.log("=== 1. Auth smoke: tih-accounting ===");
  const drive = await getDriveClient("tih-accounting");
  const about = await drive.about.get({ fields: "user" });
  console.log(`  Authenticated as: ${about.data.user?.emailAddress ?? "(unknown)"}\n`);

  // ── 2. Year root lookup ────────────────────────────────────────────────────
  console.log("=== 2. Year root lookup ===");
  const year = new Date().getFullYear();
  const yearName = `${year} Acquisition & Disposition Files`;
  const yearList = await drive.files.list({
    q: [
      `name = '${escapeQuery(yearName)}'`,
      `mimeType = '${FOLDER_MIME}'`,
      `'root' in parents`,
      `trashed = false`,
    ].join(" and "),
    fields: "files(id, name)",
    pageSize: 1,
  });
  const yearRootId = yearList.data.files?.[0]?.id ?? null;
  if (yearRootId) {
    console.log(`  Found "${yearName}" → ${yearRootId}\n`);
  } else {
    console.log(`  "${yearName}" NOT FOUND at My Drive root — bailing.\n`);
    process.exit(1);
  }

  // ── 3. Real properties: 5010 Redbud + 129 Bryan Ct ────────────────────────
  const targets = ["5010 Redbud", "129 Bryan Ct"];
  const supabase = getSupabase();

  for (const fragment of targets) {
    console.log(`=== 3. Property: "${fragment}" ===`);
    const { data, error } = await supabase
      .from("properties")
      .select("slug, address, accounting_address_folder_id, pm_review_folder_id")
      .ilike("address", `%${fragment}%`);
    if (error) {
      console.log(`  DB error: ${error.message}\n`);
      continue;
    }
    if (!data || data.length === 0) {
      console.log(`  No property in DB matching "${fragment}"\n`);
      continue;
    }
    if (data.length > 1) {
      console.log(`  ${data.length} matches in DB — picking first:`);
    }
    const prop = data[0];
    console.log(`  DB row: ${prop.address}`);
    console.log(`    slug: ${prop.slug}`);
    console.log(`    accounting_address_folder_id: ${prop.accounting_address_folder_id ?? "(null)"}`);
    console.log(`    pm_review_folder_id: ${prop.pm_review_folder_id ?? "(null)"}`);
    const tokens = extractAddressTokens(prop.address);
    console.log(`  Tokens: number=${tokens.number} primary=${tokens.primary} secondary=${tokens.secondary}`);

    // Always do the candidate search (read-only)
    const candidates = await searchCandidates(drive, yearRootId, tokens.number, tokens.primary);
    console.log(`  Candidates in ${yearName}: ${candidates.length}`);
    candidates.forEach((c) => console.log(`    • ${c.name} (${c.id})`));

    if (commit) {
      try {
        const pmReviewId = await ensurePmReviewFolder(prop.slug);
        console.log(`  ✓ ensurePmReviewFolder → ${pmReviewId}\n`);
      } catch (err) {
        if (err instanceof AccountingFolderAmbiguous) {
          console.log(`  ✗ Ambiguous: ${err.message}`);
          err.candidates.forEach((c) => console.log(`    candidate: ${c.name} (${c.id})`));
          console.log();
        } else {
          console.log(`  ✗ ${(err as Error).message}\n`);
        }
      }
    } else {
      console.log("  (dry-run; pass --commit to create PM Review/ + persist IDs)\n");
    }
  }

  // ── 4. Negative test: fake address that should not match anything ─────────
  console.log("=== 4. Negative test: false address ===");
  const fake = "99999 Fakestreet Ave";
  const fakeTokens = extractAddressTokens(fake);
  console.log(`  Address: "${fake}"`);
  console.log(`  Tokens: number=${fakeTokens.number} primary=${fakeTokens.primary}`);
  const fakeCandidates = await searchCandidates(drive, yearRootId, fakeTokens.number, fakeTokens.primary);
  console.log(`  Candidates in ${yearName}: ${fakeCandidates.length}`);
  if (fakeCandidates.length === 0) {
    console.log(`  ✓ Negative test passed (0 candidates → AccountingFolderAmbiguous would be thrown)\n`);
  } else {
    console.log(`  ✗ Unexpected matches:`);
    fakeCandidates.forEach((c) => console.log(`    • ${c.name} (${c.id})`));
    console.log();
  }

  // ── 5. Renovation drive: pm@ Renovations/<year>/Active/ ───────────────────
  console.log("=== 5. Renovation drive layout: pm@ ===");
  const pmDrive = await getDriveClient("tih-pm");
  const renovationsRoot = await pmDrive.files.list({
    q: `name = 'Renovations' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
  });
  const renId = renovationsRoot.data.files?.[0]?.id;
  if (!renId) {
    console.log("  ✗ Renovations/ not found at pm@ root — bailing.\n");
    return;
  }
  const yearList2 = await pmDrive.files.list({
    q: `name = '${year} Renovations' and mimeType = '${FOLDER_MIME}' and '${renId}' in parents and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
  });
  const ynId = yearList2.data.files?.[0]?.id;
  if (!ynId) {
    console.log(`  ✗ "${year} Renovations" not found inside Renovations/ — bailing.\n`);
    return;
  }
  const activeList = await pmDrive.files.list({
    q: `name = 'Active' and mimeType = '${FOLDER_MIME}' and '${ynId}' in parents and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
  });
  const activeId = activeList.data.files?.[0]?.id;
  if (!activeId) {
    console.log(`  ✗ Active/ not found inside ${year} Renovations/ — bailing.\n`);
    return;
  }
  console.log(`  Found Renovations/${year} Renovations/Active/ → ${activeId}\n`);

  // For each target property, do a renovation-side candidate search
  for (const fragment of targets) {
    console.log(`=== 5. Renovation match: "${fragment}" ===`);
    const { data: rows } = await supabase
      .from("properties")
      .select("slug, address, renovation_folder_id, stage")
      .ilike("address", `%${fragment}%`);
    if (!rows || rows.length === 0) {
      console.log(`  (no DB row for "${fragment}" — skipping)\n`);
      continue;
    }
    const prop = rows[0];
    console.log(`  ${prop.address} (stage: ${prop.stage})`);
    console.log(`    renovation_folder_id: ${prop.renovation_folder_id ?? "(null)"}`);
    const tokens = extractAddressTokens(prop.address);
    const cands = await searchCandidates(pmDrive, activeId, tokens.number, tokens.primary);
    console.log(`  Candidates in Active/: ${cands.length}`);
    cands.forEach((c) => console.log(`    • ${c.name} (${c.id})`));
    if (cands.length === 0) {
      console.log(`  → would create a new folder named "${prop.address}" in Active/\n`);
    } else {
      console.log();
    }
  }
}

async function searchCandidates(
  drive: Awaited<ReturnType<typeof getDriveClient>>,
  parentId: string,
  num: string | null,
  primary: string | null,
): Promise<Array<{ id: string; name: string }>> {
  if (!num || !primary) return [];
  const q = [
    `'${parentId}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    `trashed = false`,
    `name contains '${escapeQuery(num)}'`,
    `name contains '${escapeQuery(primary)}'`,
  ].join(" and ");
  const { data } = await drive.files.list({
    q,
    fields: "files(id, name)",
    pageSize: 10,
  });
  return (data.files ?? [])
    .filter((f) => f.id)
    .map((f) => ({ id: f.id!, name: f.name ?? "" }));
}

main().catch((err) => {
  console.error("\nFailed:", err);
  process.exit(1);
});
