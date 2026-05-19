#!/usr/bin/env tsx
// Read-only: walks <accounting>/<year>/<address>/Acquisitions/Seller Disclosures/
// for every property that has an accounting_address_folder_id set, and prints
// the file names found inside. Used to figure out the questionnaire's naming
// scheme so we can update questionnaire_url to point at Drive instead of Gmail.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import type { drive_v3 } from "googleapis";
import { getDriveClient } from "@/lib/google/auth";
import { listProperties } from "@/lib/db/properties";

const FOLDER_MIME = "application/vnd.google-apps.folder";

async function getDrive(): Promise<drive_v3.Drive> {
  return getDriveClient("tih-accounting");
}

function escapeQuery(s: string): string {
  return s.replace(/'/g, "\\'");
}

async function findChildFolderFuzzy(
  drive: drive_v3.Drive,
  candidateNames: string[],
  parentId: string,
): Promise<{ id: string; name: string } | null> {
  // Single query for all folders under the parent — cheaper than N exact-name
  // probes, and lets us match on case-insensitive / whitespace-tolerant names.
  const q = [
    `mimeType = '${FOLDER_MIME}'`,
    `'${parentId}' in parents`,
    `trashed = false`,
  ].join(" and ");
  const { data } = await drive.files.list({
    q,
    fields: "files(id, name)",
    pageSize: 200,
  });
  const files = data.files ?? [];
  const lowered = candidateNames.map((c) => c.toLowerCase());
  for (const f of files) {
    if (!f.name || !f.id) continue;
    if (lowered.includes(f.name.toLowerCase().trim())) {
      return { id: f.id, name: f.name };
    }
  }
  return null;
}

async function listFolderContents(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const out: Array<{ id: string; name: string; mimeType: string }> = [];
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q: `'${escapeQuery(folderId)}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageSize: 100,
      pageToken,
    });
    for (const f of data.files ?? []) {
      if (f.id && f.name && f.mimeType) {
        out.push({ id: f.id, name: f.name, mimeType: f.mimeType });
      }
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function main() {
  const drive = await getDrive();
  const props = await listProperties();
  const withFolder = props.filter((p) => p.accounting_address_folder_id);
  console.log(
    `${withFolder.length}/${props.length} properties have an accounting_address_folder_id.\n`,
  );

  for (const p of withFolder) {
    const addrFolderId = p.accounting_address_folder_id!;
    // Try Acquisitions/ → Seller Disclosures/
    const acq = await findChildFolderFuzzy(
      drive,
      ["Acquisitions"],
      addrFolderId,
    );
    if (!acq) {
      console.log(`  ${p.address}`);
      console.log(`    no Acquisitions/ subfolder\n`);
      continue;
    }
    const disc = await findChildFolderFuzzy(
      drive,
      [
        "Seller Disclosures",
        "Seller Disclosure",
        "Seller's Disclosures",
        "Sellers Disclosures",
      ],
      acq.id,
    );
    if (!disc) {
      console.log(`  ${p.address}`);
      console.log(`    Acquisitions/ exists but no Seller Disclosures subfolder\n`);
      continue;
    }
    const files = await listFolderContents(drive, disc.id);
    console.log(`  ${p.address}`);
    console.log(`    folder: '${disc.name}'`);
    if (files.length === 0) {
      console.log(`    (empty)\n`);
      continue;
    }
    for (const f of files) {
      const kind = f.mimeType === FOLDER_MIME ? "[dir]" : "";
      console.log(`    - ${f.name} ${kind}`);
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
