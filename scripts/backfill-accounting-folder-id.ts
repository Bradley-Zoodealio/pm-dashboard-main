#!/usr/bin/env tsx
// Resolves properties.accounting_address_folder_id for every property
// by fuzzy-matching the property's address against the address subfolders
// directly under "2026 Acquisition & Disposition Files" in the
// tih-accounting Drive.
//
// Read-only by default; pass --write to apply.
//
// Why this exists: the field is otherwise only populated on first use of
// ensureAccountingAddressFolder (which fires when you click Create Comps
// Sheet / Remodel Bid). The Documents section's "Accounting Drive ↗" pill
// surfaces this folder for properties that haven't triggered that lazy
// path yet — this backfill lets the pill show up on day one.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import type { drive_v3 } from "googleapis";
import { slugify } from "@/lib/address";
import { getDriveClient } from "@/lib/google/auth";
import {
  listProperties,
  updatePropertyField,
} from "@/lib/db/properties";

const FOLDER_MIME = "application/vnd.google-apps.folder";

const DIRECTIONAL = new Set([
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
  "north",
  "south",
  "east",
  "west",
]);

const SUFFIX_SHORT: Record<string, string> = {
  circle: "cir",
  street: "st",
  drive: "dr",
  road: "rd",
  avenue: "ave",
  boulevard: "blvd",
  lane: "ln",
  court: "ct",
  cove: "cv",
  place: "pl",
  trail: "trl",
  parkway: "pkwy",
  highway: "hwy",
  terrace: "ter",
  crossing: "xing",
  mount: "mt",
};

const STREET_SUFFIX_RE =
  /\b(?:cir|circle|st|street|dr|drive|rd|road|ave|avenue|blvd|boulevard|ln|lane|way|ct|court|cv|cove|pl|place|trl|trail|pkwy|parkway|hwy|highway|ter|terrace|xing|crossing)\b/i;

function leadingStreet(raw: string): string {
  if (raw.includes(",")) return raw.split(",")[0];
  const m = raw.match(STREET_SUFFIX_RE);
  if (m && m.index !== undefined) return raw.slice(0, m.index + m[0].length);
  return raw;
}

function slugVariants(raw: string): string[] {
  const leading = leadingStreet(raw);
  const out = new Set<string>();
  const strict = slugify(leading);
  if (strict) out.add(strict);
  const tokens = leading
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const noDir = tokens.filter((t) => !DIRECTIONAL.has(t));
  if (noDir.length > 0 && noDir.length !== tokens.length) {
    out.add(noDir.join("-"));
  }
  const canonical = noDir.map((t) => SUFFIX_SHORT[t] ?? t);
  if (canonical.length > 0) out.add(canonical.join("-"));
  return [...out].filter(Boolean);
}

function addressesMatch(a: string, b: string): boolean {
  const va = slugVariants(a);
  const vb = slugVariants(b);
  for (const x of va) {
    for (const y of vb) {
      if (x === y) return true;
      if (x.startsWith(y + "-")) return true;
      if (y.startsWith(x + "-")) return true;
    }
  }
  return false;
}

async function findYearRoot(drive: drive_v3.Drive): Promise<string | null> {
  const { data } = await drive.files.list({
    q: `name = '2026 Acquisition & Disposition Files' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id, name)",
    corpora: "allDrives",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: 5,
  });
  const files = data.files ?? [];
  if (files.length === 0) return null;
  // Prefer one at the user's My Drive root if multiple matches.
  return files[0].id ?? null;
}

async function listAddressFolders(
  drive: drive_v3.Drive,
  parentId: string,
): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: "nextPageToken, files(id, name)",
      pageSize: 200,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of data.files ?? []) {
      if (f.id && f.name) out.push({ id: f.id, name: f.name });
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function main() {
  const write = process.argv.includes("--write");
  const drive = await getDriveClient("tih-accounting");
  const root = await findYearRoot(drive);
  if (!root) {
    console.error("Could not find '2026 Acquisition & Disposition Files' in accounting Drive.");
    process.exit(1);
  }
  console.log(`2026 root folder id: ${root}\n`);

  const folders = await listAddressFolders(drive, root);
  console.log(`Found ${folders.length} address subfolders under the 2026 root.\n`);

  const props = await listProperties();
  const missing = props.filter((p) => !p.accounting_address_folder_id);
  console.log(
    `${missing.length}/${props.length} properties have no accounting_address_folder_id.\n`,
  );

  const updates: Array<{ slug: string; address: string; folderId: string; folderName: string }> = [];
  const unmatched: typeof missing = [];
  const ambiguous: Array<{ address: string; matches: string[] }> = [];

  for (const p of missing) {
    const matches = folders.filter((f) => addressesMatch(f.name, p.address));
    if (matches.length === 0) {
      unmatched.push(p);
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push({ address: p.address, matches: matches.map((m) => m.name) });
      continue;
    }
    updates.push({
      slug: p.slug,
      address: p.address,
      folderId: matches[0].id,
      folderName: matches[0].name,
    });
  }

  console.log(`Updates proposed: ${updates.length}`);
  console.log(`Ambiguous:        ${ambiguous.length}`);
  console.log(`Unmatched:        ${unmatched.length}\n`);
  for (const u of updates) {
    console.log(`  ${u.address}`);
    console.log(`    → folder '${u.folderName}'   (${u.folderId})\n`);
  }
  if (ambiguous.length > 0) {
    console.log("Ambiguous (multiple matching folders — pick one manually):");
    for (const a of ambiguous) {
      console.log(`  ${a.address}`);
      for (const m of a.matches) console.log(`    - ${m}`);
    }
    console.log("");
  }
  if (unmatched.length > 0) {
    console.log("Unmatched (no folder under 2026 root):");
    for (const p of unmatched) console.log(`  - ${p.address}`);
    console.log("");
  }

  if (!write) {
    console.log("(read-only — pass --write to persist)");
    return;
  }
  let applied = 0;
  let failed = 0;
  for (const u of updates) {
    try {
      await updatePropertyField(u.slug, "accounting_address_folder_id", u.folderId);
      applied++;
    } catch (err) {
      console.error(`  FAIL ${u.slug}: ${(err as Error).message}`);
      failed++;
    }
  }
  console.log(`\nApplied: ${applied}   Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
