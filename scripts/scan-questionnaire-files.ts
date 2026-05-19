#!/usr/bin/env tsx
// Read-only: searches the accounting Drive globally for any file whose name
// mentions "Seller Disclosure" or "Questionnaire". For each match, prints
// the file name and the parent-folder chain up to the year folder. Used to
// nail down the questionnaire naming pattern + folder layout before we
// write a backfill for properties.questionnaire_url.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import type { drive_v3 } from "googleapis";
import { getDriveClient } from "@/lib/google/auth";

const FOLDER_MIME = "application/vnd.google-apps.folder";

async function getDrive(): Promise<drive_v3.Drive> {
  return getDriveClient("tih-accounting");
}

async function nameById(
  drive: drive_v3.Drive,
  id: string,
): Promise<{ name: string; parents?: string[] }> {
  try {
    const { data } = await drive.files.get({
      fileId: id,
      fields: "id, name, parents",
      supportsAllDrives: true,
    });
    return { name: data.name ?? "(unknown)", parents: data.parents ?? undefined };
  } catch {
    return { name: "(inaccessible)" };
  }
}

async function pathFor(
  drive: drive_v3.Drive,
  startId: string,
  maxDepth = 6,
): Promise<string[]> {
  const out: string[] = [];
  let cur = startId;
  for (let i = 0; i < maxDepth; i++) {
    const meta = await nameById(drive, cur);
    out.unshift(meta.name);
    if (!meta.parents || meta.parents.length === 0) break;
    cur = meta.parents[0];
    if (cur === "root") break;
  }
  return out;
}

async function main() {
  const drive = await getDrive();
  const queries = [
    `(name contains 'Seller Disclosure' or name contains 'Questionnaire') and mimeType != '${FOLDER_MIME}' and trashed = false`,
  ];
  const all: Array<{ id: string; name: string; parents?: string[]; mimeType?: string }> = [];
  for (const q of queries) {
    let pageToken: string | undefined;
    do {
      const { data } = await drive.files.list({
        q,
        fields: "nextPageToken, files(id, name, parents, mimeType)",
        pageSize: 200,
        pageToken,
        // Include items in Shared Drives the accounting@ account can see —
        // the 2026 Acquisition & Disposition Files folder likely lives in
        // a shared drive, not the user's My Drive.
        corpora: "allDrives",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      });
      for (const f of data.files ?? []) {
        if (f.id && f.name)
          all.push({
            id: f.id,
            name: f.name,
            parents: f.parents ?? undefined,
            mimeType: f.mimeType ?? undefined,
          });
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  console.log(`Found ${all.length} candidate files. Filtering for 2026 paths.\n`);
  const cache = new Map<string, { name: string; parents?: string[] }>();
  let shown = 0;

  for (const f of all) {
    if (!f.parents || f.parents.length === 0) continue;
    const parentId = f.parents[0];
    // Resolve path with manual memoization for parent walks.
    let cur = parentId;
    const path: string[] = [];
    for (let i = 0; i < 6; i++) {
      let meta = cache.get(cur);
      if (!meta) {
        meta = await nameById(drive, cur);
        cache.set(cur, meta);
      }
      path.unshift(meta.name);
      if (!meta.parents || meta.parents.length === 0) break;
      cur = meta.parents[0];
      if (cur === "root") break;
    }
    const joined = path.join(" / ");
    if (!/2026 Acquisition/i.test(joined)) continue;
    console.log(`  ${f.name}`);
    console.log(`    parents: ${joined}\n`);
    shown++;
  }
  console.log(`Shown ${shown} of ${all.length} matches (2026 only).`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
