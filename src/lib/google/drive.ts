import "server-only";

import { getDriveClient } from "./auth";
import type { MailboxKey } from "./mailboxes";

export interface DriveFileResult {
  id: string;
  name: string;
  webViewLink: string;
}

export interface DriveFileRow extends DriveFileResult {
  mimeType: string;
  modifiedTime: string;
}

function escapeQuery(s: string): string {
  return s.replace(/'/g, "\\'");
}

export async function copyTemplate(
  templateFileId: string,
  newName: string,
  mailbox: MailboxKey = "bradley",
): Promise<DriveFileResult> {
  const drive = getDriveClient(mailbox);
  const { data } = await drive.files.copy({
    fileId: templateFileId,
    requestBody: { name: newName },
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

export async function findTemplateCopiesForAddress(
  addressFragment: string,
  keyword: string,
  excludeFileId?: string,
  mailbox: MailboxKey = "bradley",
): Promise<DriveFileResult[]> {
  const drive = getDriveClient(mailbox);
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

export async function findFilesForAddress(
  addressFragment: string,
  excludeIds: ReadonlyArray<string> = [],
  mailbox: MailboxKey = "bradley",
): Promise<DriveFileRow[]> {
  const drive = getDriveClient(mailbox);
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
      fields: "files(id, name, mimeType, webViewLink, modifiedTime), nextPageToken",
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
  mailbox: MailboxKey = "bradley",
): Promise<RemodelBidFile[]> {
  const drive = getDriveClient(mailbox);
  const templateId = opts.excludeTemplateId ?? process.env.DRIVE_REMODEL_BID_TEMPLATE_FILE_ID;
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
