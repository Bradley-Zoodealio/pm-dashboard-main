#!/usr/bin/env tsx
// Re-points properties.questionnaire_url at the seller-disclosure
// questionnaire PDF in the accounting Drive, replacing the legacy Gmail
// thread URL. Inspection thread tracking is preserved on
// inspection_thread_id (set up in migration 0014).
//
// Read-only by default. Pass --write to apply.
//
// Algorithm:
//   1. Drive-wide search for "Seller Disclosure Questionnaire" PDFs in the
//      tih-accounting Drive (allDrives corpora, in case the folder is
//      shared rather than owned).
//   2. Walk each file's parent chain. We only keep files at the exact
//      depth `2026 Acquisition & Disposition Files / <address> /
//      Acquisitions / [Sellers Disclosures | Seller Disclosures]`.
//   3. For each file, slugify both the address-folder name and the DB
//      property's address (with directional-strip + suffix-canonicalize
//      variants, same as gmail-sync's matcher) and pick the best match.
//   4. Prefer files whose name contains "(TEMPLATE)" — that's the
//      standard pre-fill our Acquisitions team uses. Falls back to any
//      "Seller Disclosure Questionnaire*" match, then to
//      "questionnaire.pdf".
//   5. Print a diff. With --write, persist questionnaire_url.

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
  // Crossing ↔ Xing equivalence — TASKS.md uses the abbreviation, Acquisitions
  // tends to spell it out.
  crossing: "xing",
  // Mount ↔ Mt — Acquisitions abbreviates in the folder name even when the
  // file inside spells it out.
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

type FileMeta = {
  id: string;
  name: string;
  parents?: string[];
  webViewLink?: string;
  mimeType?: string;
};

async function listAllCandidates(
  drive: drive_v3.Drive,
): Promise<FileMeta[]> {
  // Broad search: any PDF whose name contains either the standard
  // "Seller Disclosure Questionnaire" header OR the bare word
  // "questionnaire" — the latter catches one-off renames like
  // "questionnaire.pdf" in 2981 Irondale's folder.
  const q = `(name contains 'Seller Disclosure Questionnaire' or name contains 'questionnaire') and mimeType = 'application/pdf' and trashed = false`;
  const out: FileMeta[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q,
      fields: "nextPageToken, files(id, name, parents, webViewLink, mimeType)",
      pageSize: 200,
      pageToken,
      corpora: "allDrives",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    for (const f of data.files ?? []) {
      if (f.id && f.name && !seen.has(f.id)) {
        seen.add(f.id);
        out.push({
          id: f.id,
          name: f.name,
          parents: f.parents ?? undefined,
          webViewLink: f.webViewLink ?? undefined,
          mimeType: f.mimeType ?? undefined,
        });
      }
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

async function getParentChain(
  drive: drive_v3.Drive,
  startId: string,
  cache: Map<string, { name: string; parents?: string[] }>,
  maxDepth = 6,
): Promise<string[]> {
  const out: string[] = [];
  let cur = startId;
  for (let i = 0; i < maxDepth; i++) {
    let meta = cache.get(cur);
    if (!meta) {
      try {
        const { data } = await drive.files.get({
          fileId: cur,
          fields: "id, name, parents",
          supportsAllDrives: true,
        });
        meta = { name: data.name ?? "(unknown)", parents: data.parents ?? undefined };
      } catch {
        meta = { name: "(inaccessible)" };
      }
      cache.set(cur, meta);
    }
    out.unshift(meta.name);
    if (!meta.parents || meta.parents.length === 0) break;
    cur = meta.parents[0];
    if (cur === "root") break;
  }
  return out;
}

async function main() {
  const write = process.argv.includes("--write");
  const drive = await getDriveClient("tih-accounting");
  const candidates = await listAllCandidates(drive);
  console.log(`Drive returned ${candidates.length} questionnaire candidates.\n`);

  const chainCache = new Map<string, { name: string; parents?: string[] }>();

  // Build a "best file per address-folder" map. Address-folder lives at
  // depth 1 below "2026 Acquisition & Disposition Files".
  type Hit = {
    file: FileMeta;
    addressFolder: string;
    chain: string[];
  };
  const hits: Hit[] = [];
  for (const f of candidates) {
    if (!f.parents || f.parents.length === 0) continue;
    const chain = await getParentChain(drive, f.parents[0], chainCache);
    const idx = chain.findIndex((n) =>
      /2026 Acquisition & Disposition Files/i.test(n),
    );
    if (idx < 0) continue;
    const addressFolder = chain[idx + 1];
    if (!addressFolder) continue;
    // Require the Acquisitions/Sellers Disclosures path so we don't grab
    // duplicates from ContractAddendums/ or other neighboring subfolders.
    const subfolder = chain[idx + 3] ?? "";
    if (!/sellers? disclosures?/i.test(subfolder)) continue;
    hits.push({ file: f, addressFolder, chain });
  }
  console.log(`Filtered to ${hits.length} hits in the canonical path.\n`);

  // Group hits by address-folder; pick the best file per folder.
  const byFolder = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = byFolder.get(h.addressFolder) ?? [];
    list.push(h);
    byFolder.set(h.addressFolder, list);
  }

  function pickBest(list: Hit[]): Hit {
    // 1. Prefer "(TEMPLATE)" files — Acquisitions' standard pre-fill.
    const tmpl = list.filter((h) => /\(TEMPLATE\)/i.test(h.file.name));
    if (tmpl.length > 0) return preferShortest(tmpl);
    return preferShortest(list);
  }
  function preferShortest(list: Hit[]): Hit {
    return [...list].sort((a, b) => a.file.name.length - b.file.name.length)[0];
  }

  const props = await listProperties();
  const updates: Array<{ slug: string; address: string; oldUrl: string | null; newUrl: string; folder: string; fileName: string }> = [];
  const unmatched: typeof props = [];

  for (const p of props) {
    let best: Hit | null = null;
    for (const [folder, list] of byFolder) {
      if (addressesMatch(folder, p.address)) {
        const candidate = pickBest(list);
        if (!best || candidate.file.name.length < best.file.name.length) {
          best = candidate;
        }
      }
    }
    if (!best || !best.file.webViewLink) {
      unmatched.push(p);
      continue;
    }
    if (p.questionnaire_url === best.file.webViewLink) continue;
    updates.push({
      slug: p.slug,
      address: p.address,
      oldUrl: p.questionnaire_url,
      newUrl: best.file.webViewLink,
      folder: best.addressFolder,
      fileName: best.file.name,
    });
  }

  console.log(`Updates proposed: ${updates.length}`);
  console.log(`Unmatched properties: ${unmatched.length}\n`);
  for (const u of updates) {
    console.log(`  ${u.address}`);
    console.log(`    folder: ${u.folder}`);
    console.log(`    file:   ${u.fileName}`);
    console.log(`    →       ${u.newUrl}\n`);
  }
  if (unmatched.length > 0) {
    console.log("Unmatched (no canonical questionnaire found):");
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
      await updatePropertyField(u.slug, "questionnaire_url", u.newUrl);
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
