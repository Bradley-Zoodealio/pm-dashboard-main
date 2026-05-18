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

// Public: move a property folder into Properties/Cancelled/ or Properties/Closed/.
// folder ID stays the same; only the parent changes.
export async function moveFolderToBucket(
  folderId: string,
  bucket: "Cancelled" | "Closed",
): Promise<void> {
  const drive = await getDriveClient("tih-pm");
  const rootId = await ensurePropertiesRoot(drive);
  const bucketId = await ensureFolder(drive, bucket, rootId);

  const { data: current } = await drive.files.get({
    fileId: folderId,
    fields: "parents",
  });
  const oldParents = (current.parents ?? []).join(",");
  await drive.files.update({
    fileId: folderId,
    addParents: bucketId,
    removeParents: oldParents,
    fields: "id, parents",
  });
}

// Public: list every file directly inside a property's Docs/ subfolder.
// Replaces findFilesForAddress in the Documents tab.
export async function listFilesInDocsFolder(
  propertyFolderId: string,
): Promise<DriveFileRow[]> {
  const drive = await getDriveClient("tih-pm");
  const docsId = await ensureDocsSubfolder(propertyFolderId);
  const q = `'${docsId}' in parents and trashed = false`;
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

// Public: look up a file by exact name inside a folder. Used by templating to
// dedupe — if "Remodel Bid - <addr>" already exists in Docs/, reuse it.
export async function findFileByNameInFolder(
  folderId: string,
  name: string,
): Promise<DriveFileResult | null> {
  const drive = await getDriveClient("tih-pm");
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

// ── Template + legacy helpers ──────────────────────────────────────────────

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

// Legacy: name-based search across the entire mailbox's Drive. Replaced by
// listFilesInDocsFolder. Kept for any caller that doesn't yet have a
// property folder ID resolved.
export async function findFilesForAddress(
  addressFragment: string,
  excludeIds: ReadonlyArray<string> = [],
  mailbox: MailboxKey = "tih-pm",
): Promise<DriveFileRow[]> {
  const drive = await getDriveClient(mailbox);
  const excludeSet = new Set(excludeIds);
  const q = [
    `name contains '${escapeQuery(addressFragment)}'`,
    `trashed = false`,
  ].join(" and ");

  const out: DriveFileRow[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q,
      fields:
        "files(id, name, mimeType, webViewLink, modifiedTime), nextPageToken",
      orderBy: "modifiedTime desc",
      pageSize: 50,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of data.files ?? []) {
      if (!f.id || !f.webViewLink) continue;
      if (excludeSet.has(f.id)) continue;
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
