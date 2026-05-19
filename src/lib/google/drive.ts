import "server-only";

import type { drive_v3 } from "googleapis";
import { getDriveClient } from "./auth";
import type { MailboxKey } from "./mailboxes";
import {
  getPropertyBySlug,
  updatePropertyField,
} from "@/lib/db/properties";

export interface DriveFileResult {
  id: string;
  name: string;
  webViewLink: string;
}

export interface DriveFileRow extends DriveFileResult {
  mimeType: string;
  modifiedTime: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

function escapeQuery(s: string): string {
  return s.replace(/'/g, "\\'");
}

// ── Folder helpers (used by the OAuth-pivot Drive structure) ───────────────

let propertiesRootCache: string | null = null;
const docsFolderCache = new Map<string, string>();

async function findFolderByName(
  drive: drive_v3.Drive,
  name: string,
  parentId: string,
): Promise<string | null> {
  const q = [
    `name = '${escapeQuery(name)}'`,
    `mimeType = '${FOLDER_MIME}'`,
    `'${parentId}' in parents`,
    `trashed = false`,
  ].join(" and ");
  const { data } = await drive.files.list({
    q,
    fields: "files(id)",
    pageSize: 1,
  });
  return data.files?.[0]?.id ?? null;
}

async function createFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string,
): Promise<string> {
  const { data } = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: "id",
  });
  if (!data.id) throw new Error(`Drive create folder returned no id for '${name}'`);
  return data.id;
}

async function ensureFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId: string,
): Promise<string> {
  const existing = await findFolderByName(drive, name, parentId);
  if (existing) return existing;
  return createFolder(drive, name, parentId);
}

async function ensurePropertiesRoot(drive: drive_v3.Drive): Promise<string> {
  if (propertiesRootCache) return propertiesRootCache;
  const id = await ensureFolder(drive, "Properties", "root");
  propertiesRootCache = id;
  return id;
}

// Public: look up property's Drive folder, creating Properties/<address>/ on
// first call. Persists the folder ID to properties.drive_folder_id so future
// calls skip the Drive lookup. Lazy — no Drive call if a folder ID is already
// cached on the property.
export async function ensurePropertyFolder(slug: string): Promise<string> {
  const property = await getPropertyBySlug(slug);
  if (!property) throw new Error(`Property not found: ${slug}`);
  if (property.drive_folder_id) return property.drive_folder_id;

  const drive = await getDriveClient("tih-pm");
  const rootId = await ensurePropertiesRoot(drive);
  const folderId = await ensureFolder(drive, property.address, rootId);
  await updatePropertyField(slug, "drive_folder_id", folderId);
  return folderId;
}

// Public: find/create Docs/ inside a property folder, memoized per process.
export async function ensureDocsSubfolder(
  propertyFolderId: string,
): Promise<string> {
  const cached = docsFolderCache.get(propertyFolderId);
  if (cached) return cached;
  const drive = await getDriveClient("tih-pm");
  const id = await ensureFolder(drive, "Docs", propertyFolderId);
  docsFolderCache.set(propertyFolderId, id);
  return id;
}

// Public: look up a file by exact name inside a folder. Used by templating to
// dedupe — if "Remodel Bid - <addr>" already exists in the destination folder,
// reuse it. Mailbox arg lets us search either accounting@ (Comps + Bid) or
// pm@ (Project Tracker) since they own different destination folders.
export async function findFileByNameInFolder(
  folderId: string,
  name: string,
  mailbox: MailboxKey = "tih-pm",
): Promise<DriveFileResult | null> {
  const drive = await getDriveClient(mailbox);
  const q = [
    `name = '${escapeQuery(name)}'`,
    `'${folderId}' in parents`,
    `trashed = false`,
  ].join(" and ");
  const { data } = await drive.files.list({
    q,
    fields: "files(id, name, webViewLink)",
    pageSize: 1,
  });
  const f = data.files?.[0];
  if (!f?.id || !f.webViewLink) return null;
  return { id: f.id, name: f.name ?? name, webViewLink: f.webViewLink };
}

// ── Accounting drive helpers (company-wide artifacts: Comps + Remodel Bid) ─
//
// Layout in accounting@tradeinholdings.com's My Drive:
//   <year> Acquisition & Disposition/
//     └─ <address>/                ← fuzzy-matched (assume exists, created by deal team)
//          └─ Acquisitions/        ← assume exists
//               └─ PM Review/      ← we create this lazily

export interface FolderCandidate {
  id: string;
  name: string;
  webViewLink: string;
}

export class AccountingFolderAmbiguous extends Error {
  readonly address: string;
  readonly searchedYears: ReadonlyArray<number>;
  readonly searchedTokens: AddressTokens;
  readonly candidates: ReadonlyArray<FolderCandidate>;
  constructor(
    address: string,
    searchedYears: ReadonlyArray<number>,
    searchedTokens: AddressTokens,
    candidates: ReadonlyArray<FolderCandidate>,
  ) {
    super(
      candidates.length === 0
        ? `No accounting folder matched '${address}' in ${searchedYears.join(" or ")} Acquisition & Disposition Files/.`
        : `Multiple accounting folder candidates matched '${address}': ${candidates.map((c) => c.name).join(", ")}.`,
    );
    this.name = "AccountingFolderAmbiguous";
    this.address = address;
    this.searchedYears = searchedYears;
    this.searchedTokens = searchedTokens;
    this.candidates = candidates;
  }
}

async function findAccountingYearRoot(
  drive: drive_v3.Drive,
  year: number,
): Promise<string | null> {
  return findFolderByName(drive, `${year} Acquisition & Disposition Files`, "root");
}

async function searchAccountingCandidates(
  drive: drive_v3.Drive,
  parentId: string,
  tokens: AddressTokens,
): Promise<FolderCandidate[]> {
  if (!tokens.number || !tokens.primary) return [];
  const q = [
    `'${parentId}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    `trashed = false`,
    `name contains '${escapeQuery(tokens.number)}'`,
    `name contains '${escapeQuery(tokens.primary)}'`,
  ].join(" and ");
  const { data } = await drive.files.list({
    q,
    fields: "files(id, name, webViewLink)",
    pageSize: 10,
  });
  return (data.files ?? [])
    .filter((f) => f.id)
    .map((f) => ({
      id: f.id!,
      name: f.name ?? "",
      webViewLink: f.webViewLink ?? "",
    }));
}

// Resolve the property's <address>/ folder inside the accounting drive's
// "<year> Acquisition & Disposition/" tree. Searches current year first, then
// previous year. Persists the result so we never re-search once resolved.
// Throws AccountingFolderAmbiguous on 0 or 2+ matches — caller's job to
// surface the picker UX.
export async function ensureAccountingAddressFolder(
  slug: string,
): Promise<string> {
  const property = await getPropertyBySlug(slug);
  if (!property) throw new Error(`Property not found: ${slug}`);
  if (property.accounting_address_folder_id) {
    return property.accounting_address_folder_id;
  }

  const drive = await getDriveClient("tih-accounting");
  const tokens = extractAddressTokens(property.address);
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1];
  const triedYears: number[] = [];

  for (const year of years) {
    const yearRoot = await findAccountingYearRoot(drive, year);
    if (!yearRoot) continue;
    triedYears.push(year);
    const candidates = await searchAccountingCandidates(
      drive,
      yearRoot,
      tokens,
    );
    if (candidates.length === 1) {
      const id = candidates[0].id;
      await updatePropertyField(slug, "accounting_address_folder_id", id);
      return id;
    }
    if (candidates.length > 1) {
      throw new AccountingFolderAmbiguous(
        property.address,
        triedYears,
        tokens,
        candidates,
      );
    }
  }

  throw new AccountingFolderAmbiguous(
    property.address,
    triedYears.length > 0 ? triedYears : years,
    tokens,
    [],
  );
}

// Resolve (and create if missing) the property's PM Review/ subfolder, which
// lives at <address>/Acquisitions/PM Review/ in the accounting drive. The
// parent <address>/ folder is fuzzy-matched; Acquisitions/ must exist
// (created by the deal team); PM Review/ is ours to create.
export async function ensurePmReviewFolder(slug: string): Promise<string> {
  const property = await getPropertyBySlug(slug);
  if (!property) throw new Error(`Property not found: ${slug}`);
  if (property.pm_review_folder_id) return property.pm_review_folder_id;

  const addressFolderId = await ensureAccountingAddressFolder(slug);
  const drive = await getDriveClient("tih-accounting");

  const acquisitionsId = await findFolderByName(
    drive,
    "Acquisitions",
    addressFolderId,
  );
  if (!acquisitionsId) {
    throw new Error(
      `'Acquisitions/' subfolder not found under accounting folder for ${property.address}. Expected layout: <year> Acquisition & Disposition Files/<address>/Acquisitions/PM Review/`,
    );
  }

  const pmReviewId = await ensureFolder(drive, "PM Review", acquisitionsId);
  await updatePropertyField(slug, "pm_review_folder_id", pmReviewId);
  return pmReviewId;
}

// ── Renovation drive helpers (working files: Project Tracker + 6 bins) ─────
//
// Layout in pm@tradeinholdings.com's My Drive:
//   Renovations/
//     └─ <year> Renovations/
//          └─ Active/
//               └─ <address>/            ← match-or-create
//                    ├─ Project Tracker - <address>
//                    ├─ Change Orders/
//                    ├─ Contractor Bid/
//                    ├─ Photos/
//                    ├─ Contractor Agreement/
//                    ├─ Hola Bid/
//                    └─ Payment Receipts/

export const RENOVATION_SUBFOLDERS = [
  "Change Orders",
  "Contractor Bid",
  "Photos",
  "Contractor Agreement",
  "Hola Bid",
  "Payment Receipts",
] as const;

export class RenovationFolderAmbiguous extends Error {
  readonly address: string;
  readonly searchedYears: ReadonlyArray<number>;
  readonly searchedTokens: AddressTokens;
  readonly candidates: ReadonlyArray<FolderCandidate>;
  constructor(
    address: string,
    searchedYears: ReadonlyArray<number>,
    searchedTokens: AddressTokens,
    candidates: ReadonlyArray<FolderCandidate>,
  ) {
    super(
      `Multiple renovation folder candidates matched '${address}' in ${searchedYears.join(" or ")} Renovations/Active/: ${candidates.map((c) => c.name).join(", ")}.`,
    );
    this.name = "RenovationFolderAmbiguous";
    this.address = address;
    this.searchedYears = searchedYears;
    this.searchedTokens = searchedTokens;
    this.candidates = candidates;
  }
}

async function findRenovationYearActive(
  drive: drive_v3.Drive,
  year: number,
): Promise<string | null> {
  const renovationsId = await findFolderByName(drive, "Renovations", "root");
  if (!renovationsId) return null;
  const yearId = await findFolderByName(
    drive,
    `${year} Renovations`,
    renovationsId,
  );
  if (!yearId) return null;
  return findFolderByName(drive, "Active", yearId);
}

// Ensure the Renovations/<year> Renovations/Active/ chain exists, creating
// any missing level. Used on the "no match found, create new" path so the
// year folders bootstrap themselves on the first renovation of a new year.
async function ensureRenovationYearActive(
  drive: drive_v3.Drive,
  year: number,
): Promise<string> {
  const renovationsId = await ensureFolder(drive, "Renovations", "root");
  const yearId = await ensureFolder(
    drive,
    `${year} Renovations`,
    renovationsId,
  );
  return ensureFolder(drive, "Active", yearId);
}

async function searchRenovationCandidates(
  drive: drive_v3.Drive,
  parentId: string,
  tokens: AddressTokens,
): Promise<FolderCandidate[]> {
  if (!tokens.number || !tokens.primary) return [];
  const q = [
    `'${parentId}' in parents`,
    `mimeType = '${FOLDER_MIME}'`,
    `trashed = false`,
    `name contains '${escapeQuery(tokens.number)}'`,
    `name contains '${escapeQuery(tokens.primary)}'`,
  ].join(" and ");
  const { data } = await drive.files.list({
    q,
    fields: "files(id, name, webViewLink)",
    pageSize: 10,
  });
  return (data.files ?? [])
    .filter((f) => f.id)
    .map((f) => ({
      id: f.id!,
      name: f.name ?? "",
      webViewLink: f.webViewLink ?? "",
    }));
}

// Idempotently create the 6 renovation subfolders inside a property's
// Active/<address>/ folder. Existing folders are reused; missing ones are
// created. Safe to call repeatedly.
export async function ensureRenovationSubfolders(
  renovationFolderId: string,
): Promise<void> {
  const drive = await getDriveClient("tih-pm");
  for (const name of RENOVATION_SUBFOLDERS) {
    await ensureFolder(drive, name, renovationFolderId);
  }
}

// Resolve (and create if missing) the property's renovation folder at
// Renovations/<year> Renovations/Active/<address>/. Searches current year,
// then previous year. On a single match → reuse + persist. On 2+ matches →
// throw RenovationFolderAmbiguous (picker UX). On zero matches across both
// years → create a new folder in the current year using the property's
// address verbatim. Always ensures the 6 subfolders on the resolution path.
export async function ensureRenovationFolder(slug: string): Promise<string> {
  const property = await getPropertyBySlug(slug);
  if (!property) throw new Error(`Property not found: ${slug}`);
  if (property.renovation_folder_id) return property.renovation_folder_id;

  const drive = await getDriveClient("tih-pm");
  const tokens = extractAddressTokens(property.address);
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1];
  const triedYears: number[] = [];

  let resolvedId: string | null = null;
  for (const year of years) {
    const activeId = await findRenovationYearActive(drive, year);
    if (!activeId) continue;
    triedYears.push(year);
    const candidates = await searchRenovationCandidates(
      drive,
      activeId,
      tokens,
    );
    if (candidates.length === 1) {
      resolvedId = candidates[0].id;
      break;
    }
    if (candidates.length > 1) {
      throw new RenovationFolderAmbiguous(
        property.address,
        triedYears,
        tokens,
        candidates,
      );
    }
  }

  if (!resolvedId) {
    const activeId = await ensureRenovationYearActive(drive, currentYear);
    resolvedId = await createFolder(drive, property.address, activeId);
  }

  await ensureRenovationSubfolders(resolvedId);
  await updatePropertyField(slug, "renovation_folder_id", resolvedId);
  return resolvedId;
}

// Migration-only: search for an existing renovation folder WITHOUT creating
// one on miss. Used by scripts/migrate-drive-layout.ts so a missing folder
// surfaces as a punch-list entry rather than silently spawning a new one
// for a property that should already have a human-created Active folder.
export type FindRenovationResult =
  | { status: "resolved"; folderId: string; year: number }
  | { status: "not_found"; searchedYears: number[] }
  | { status: "ambiguous"; candidates: FolderCandidate[]; searchedYears: number[] };

export async function findExistingRenovationFolder(
  slug: string,
): Promise<FindRenovationResult> {
  const property = await getPropertyBySlug(slug);
  if (!property) throw new Error(`Property not found: ${slug}`);

  const drive = await getDriveClient("tih-pm");
  const tokens = extractAddressTokens(property.address);
  const currentYear = new Date().getFullYear();
  const triedYears: number[] = [];

  for (const year of [currentYear, currentYear - 1]) {
    const activeId = await findRenovationYearActive(drive, year);
    if (!activeId) continue;
    triedYears.push(year);
    const candidates = await searchRenovationCandidates(drive, activeId, tokens);
    if (candidates.length === 1) {
      return { status: "resolved", folderId: candidates[0].id, year };
    }
    if (candidates.length > 1) {
      return { status: "ambiguous", candidates, searchedYears: triedYears };
    }
  }
  return { status: "not_found", searchedYears: triedYears };
}

// ── Documents tab: aggregate files across both Drives ──────────────────────

export interface DriveFileGroup {
  // Display label, e.g. "PM Review", "Renovation", "Renovation: Photos".
  group: string;
  // Direct Drive URL for the folder so the section header can link out.
  // Null when the folder doesn't exist yet (e.g. pre-Contract-Work properties
  // for renovation groups).
  folderUrl: string | null;
  files: DriveFileRow[];
}

export function folderWebViewUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

async function listFilesInFolder(
  mailbox: MailboxKey,
  folderId: string,
  options: { excludeFolders?: boolean } = {},
): Promise<DriveFileRow[]> {
  const drive = await getDriveClient(mailbox);
  const qParts = [`'${folderId}' in parents`, "trashed = false"];
  if (options.excludeFolders) qParts.push(`mimeType != '${FOLDER_MIME}'`);
  const q = qParts.join(" and ");
  const out: DriveFileRow[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q,
      fields:
        "nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: 50,
      pageToken,
    });
    for (const f of data.files ?? []) {
      if (!f.id || !f.webViewLink) continue;
      out.push({
        id: f.id,
        name: f.name ?? "",
        webViewLink: f.webViewLink,
        mimeType: f.mimeType ?? "",
        modifiedTime: f.modifiedTime ?? "",
      });
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

// Aggregate every file a property "owns" across both Drives, grouped by the
// folder it came from. Reads PM Review (1 folder), then for properties with
// a renovation folder: the root (non-folder files only — Project Tracker etc.)
// plus each of the 6 subfolders. Up to 8 Drive calls; runs subfolder lookups
// in parallel. Folders that haven't been created yet are skipped silently.
export async function listPropertyDriveFiles(
  slug: string,
): Promise<DriveFileGroup[]> {
  const property = await getPropertyBySlug(slug);
  if (!property) throw new Error(`Property not found: ${slug}`);

  const groups: DriveFileGroup[] = [];

  if (property.pm_review_folder_id) {
    const files = await listFilesInFolder(
      "tih-accounting",
      property.pm_review_folder_id,
    );
    groups.push({
      group: "PM Review",
      folderUrl: folderWebViewUrl(property.pm_review_folder_id),
      files,
    });
  }

  if (property.renovation_folder_id) {
    const renovationFolderId = property.renovation_folder_id;
    const pmDrive = await getDriveClient("tih-pm");

    const [rootFiles, ...subResults] = await Promise.all([
      listFilesInFolder("tih-pm", renovationFolderId, { excludeFolders: true }),
      ...RENOVATION_SUBFOLDERS.map(async (name) => {
        const subId = await findFolderByName(pmDrive, name, renovationFolderId);
        if (!subId) {
          return {
            group: `Renovation: ${name}`,
            folderUrl: null,
            files: [] as DriveFileRow[],
          };
        }
        const files = await listFilesInFolder("tih-pm", subId);
        return {
          group: `Renovation: ${name}`,
          folderUrl: folderWebViewUrl(subId),
          files,
        };
      }),
    ]);

    groups.push({
      group: "Renovation",
      folderUrl: folderWebViewUrl(renovationFolderId),
      files: rootFiles,
    });
    groups.push(...subResults);
  }

  return groups;
}

// ── Template helpers + bid-scraper search ─────────────────────────────────

export async function copyTemplate(
  templateFileId: string,
  newName: string,
  destinationFolderId?: string,
  mailbox: MailboxKey = "tih-pm",
): Promise<DriveFileResult> {
  const drive = await getDriveClient(mailbox);
  const { data } = await drive.files.copy({
    fileId: templateFileId,
    requestBody: {
      name: newName,
      ...(destinationFolderId ? { parents: [destinationFolderId] } : {}),
    },
    fields: "id, name, webViewLink",
    supportsAllDrives: true,
  });
  if (!data.id || !data.webViewLink) {
    throw new Error("Drive copy did not return a usable file");
  }
  return {
    id: data.id,
    name: data.name ?? newName,
    webViewLink: data.webViewLink,
  };
}

// Legacy: used by old templating dedup. Kept for any callers still searching
// the entire Drive by name. New code uses findFileByNameInFolder.
export async function findTemplateCopiesForAddress(
  addressFragment: string,
  keyword: string,
  excludeFileId?: string,
  mailbox: MailboxKey = "tih-pm",
): Promise<DriveFileResult[]> {
  const drive = await getDriveClient(mailbox);
  const q = [
    `name contains '${escapeQuery(addressFragment)}'`,
    `name contains '${escapeQuery(keyword)}'`,
    `trashed = false`,
    `mimeType = 'application/vnd.google-apps.spreadsheet'`,
  ].join(" and ");

  const { data } = await drive.files.list({
    q,
    fields: "files(id, name, webViewLink, modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 20,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (data.files ?? [])
    .filter((f) => f.id && f.webViewLink && f.id !== excludeFileId)
    .map((f) => ({
      id: f.id!,
      name: f.name ?? "",
      webViewLink: f.webViewLink!,
    }));
}

export interface RemodelBidFile {
  id: string;
  name: string;
  webViewLink: string;
  modifiedTime: string | null;
}

export async function listRemodelBidSheets(
  opts: { since?: Date; pageSize?: number; excludeTemplateId?: string } = {},
  mailbox: MailboxKey = "tih-pm",
): Promise<RemodelBidFile[]> {
  const drive = await getDriveClient(mailbox);
  const templateId =
    opts.excludeTemplateId ?? process.env.DRIVE_REMODEL_BID_TEMPLATE_FILE_ID;
  const qParts = [
    `name contains 'Remodel Bid'`,
    `mimeType = 'application/vnd.google-apps.spreadsheet'`,
    `trashed = false`,
  ];
  if (opts.since) qParts.push(`modifiedTime >= '${opts.since.toISOString()}'`);
  const q = qParts.join(" and ");

  const out: RemodelBidFile[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q,
      fields: "nextPageToken, files(id, name, webViewLink, modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: opts.pageSize ?? 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of data.files ?? []) {
      if (!f.id || !f.webViewLink) continue;
      if (templateId && f.id === templateId) continue;
      out.push({
        id: f.id,
        name: f.name ?? "",
        webViewLink: f.webViewLink,
        modifiedTime: f.modifiedTime ?? null,
      });
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

// ── Address tokenization (used by gmail-sync to match emails to properties) ─

export interface AddressTokens {
  number: string | null;
  primary: string | null;
  secondary: string | null;
}

const ADDRESS_STOP_WORDS = new Set([
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
  "north", "south", "east", "west",
  "st", "dr", "cir", "ave", "rd", "ln", "way", "ct", "blvd", "pl", "xing", "hwy",
  "pkwy", "ter", "trl", "street", "drive", "circle", "avenue", "road", "lane",
  "court", "place", "crossing", "highway", "parkway", "terrace", "trail",
  "apt", "unit", "ste", "suite",
]);

export function extractAddressTokens(street: string): AddressTokens {
  const tokens = street
    .toLowerCase()
    .replace(/[#,]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let number: string | null = null;
  const words: string[] = [];
  for (const t of tokens) {
    if (number === null && /^\d+$/.test(t)) {
      number = t;
      continue;
    }
    if (ADDRESS_STOP_WORDS.has(t)) continue;
    if (/\d/.test(t)) continue;
    if (t.length < 2) continue;
    words.push(t);
  }
  return { number, primary: words[0] ?? null, secondary: words[1] ?? null };
}
