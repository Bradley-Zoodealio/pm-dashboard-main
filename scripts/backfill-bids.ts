#!/usr/bin/env tsx
// Self-contained 3-year bid backfill from contracts@'s Gmail sent folder.
//
// Runs OUTSIDE Next.js (plain tsx) so it bypasses the Turbopack/pdfjs worker
// resolution issue that breaks the equivalent admin route. All Supabase /
// Gmail calls go through their respective REST/SDK paths directly.
//
// Usage:
//   tsx scripts/backfill-bids.ts --since=2023-01-01 [--limit=10] [--dry-run]

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createDecipheriv, createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { google } from "googleapis";
import { PDFParse } from "pdf-parse";

// ── pdfjs-dist worker resolution (no Turbopack interference here) ────────────

const WORKER_PATH = path.join(
  process.cwd(),
  "node_modules",
  "pdfjs-dist",
  "legacy",
  "build",
  "pdf.worker.mjs",
);
PDFParse.setWorker(pathToFileURL(WORKER_PATH).href);

// ── Args ─────────────────────────────────────────────────────────────────────

interface Args {
  since: string;
  limit?: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args: Args = { since: "2023-01-01", dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--since=")) args.since = arg.slice("--since=".length);
    else if (arg.startsWith("--limit="))
      args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--dry-run") args.dryRun = true;
    else console.warn(`Unknown arg ignored: ${arg}`);
  }
  return args;
}

// ── Env + Supabase REST helpers ─────────────────────────────────────────────

function envOrFail(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env.local`);
  return v;
}

const SUPABASE_URL = envOrFail("SUPABASE_URL");
const SUPABASE_KEY = envOrFail("SUPABASE_SERVICE_ROLE_KEY");

async function sb(
  pathName: string,
  init: RequestInit & { params?: Record<string, string> } = {},
): Promise<Response> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${pathName}`);
  for (const [k, v] of Object.entries(init.params ?? {}))
    url.searchParams.set(k, v);
  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_KEY);
  headers.set("Authorization", `Bearer ${SUPABASE_KEY}`);
  headers.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers });
}

// ── Token decryption ─────────────────────────────────────────────────────────

interface OAuthRow {
  refresh_token_encrypted: string;
}

async function loadRefreshToken(mailboxKey: string): Promise<string> {
  const res = await sb("oauth_accounts", {
    params: { mailbox_key: `eq.${mailboxKey}`, select: "refresh_token_encrypted" },
  });
  if (!res.ok) throw new Error(`oauth_accounts read failed: ${res.status}`);
  const rows = (await res.json()) as OAuthRow[];
  const row = rows[0];
  if (!row) throw new Error(`${mailboxKey} not bootstrapped`);

  const key = Buffer.from(envOrFail("OAUTH_TOKEN_ENCRYPTION_KEY").trim(), "base64");
  if (key.length !== 32) throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");

  const buf = Buffer.from(row.refresh_token_encrypted, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

function makeOAuth(refreshToken: string) {
  const oauth = new google.auth.OAuth2(
    envOrFail("GOOGLE_CLIENT_ID"),
    envOrFail("GOOGLE_CLIENT_SECRET"),
    envOrFail("GOOGLE_REDIRECT_URI"),
  );
  oauth.setCredentials({ refresh_token: refreshToken });
  return oauth;
}

// ── Gmail walker ─────────────────────────────────────────────────────────────

type Gmail = ReturnType<typeof google.gmail>;
type Drive = ReturnType<typeof google.drive>;

interface MessageMeta {
  messageId: string;
  threadId: string;
  subject: string;
  date: string;
  fromEmail: string;
  body: string;
}

interface PdfTarget {
  meta: MessageMeta;
  attachmentId: string;
  filename: string;
}

interface SheetTarget {
  meta: MessageMeta;
  url: string;
  fileId: string;
}

const SHEET_URL_RE =
  /https?:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/g;

function extractSheetUrls(body: string): Array<{ url: string; fileId: string }> {
  const out: Array<{ url: string; fileId: string }> = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(SHEET_URL_RE)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({
      url: `https://docs.google.com/spreadsheets/d/${m[1]}/edit`,
      fileId: m[1],
    });
  }
  return out;
}

function extractPlaintextBody(payload: unknown): string {
  const walk = (p: unknown): string | null => {
    const part = p as {
      mimeType?: string;
      body?: { data?: string };
      parts?: unknown[];
    };
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(
        part.body.data.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8");
    }
    for (const child of part.parts ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(payload) ?? "";
}

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string {
  if (!headers) return "";
  const target = name.toLowerCase();
  return headers.find((h) => h.name?.toLowerCase() === target)?.value ?? "";
}

function findPdfParts(
  payload: unknown,
): Array<{ filename: string; attachmentId: string }> {
  const out: Array<{ filename: string; attachmentId: string }> = [];
  const visit = (p: unknown) => {
    const part = p as {
      filename?: string;
      mimeType?: string;
      body?: { attachmentId?: string };
      parts?: unknown[];
    };
    if (
      part.filename &&
      part.body?.attachmentId &&
      part.mimeType?.includes("pdf")
    ) {
      out.push({ filename: part.filename, attachmentId: part.body.attachmentId });
    }
    for (const child of part.parts ?? []) visit(child);
  };
  visit(payload);
  return out;
}

interface ScannedMessage {
  meta: MessageMeta;
  pdfs: Array<{ attachmentId: string; filename: string }>;
  sheets: Array<{ url: string; fileId: string }>;
}

async function listAllCandidates(
  gmail: Gmail,
  args: Args,
): Promise<ScannedMessage[]> {
  const sinceStr = args.since.replace(/-/g, "/");
  // "has the words: remodel bid" → unquoted AND match on body+subject+filenames.
  // No has:attachment / filename:pdf filter so we also catch emails that only
  // contain a Sheets link.
  const query = `remodel bid after:${sinceStr}`;
  console.log(`Gmail query: ${query}`);

  const messageIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: query,
      pageToken,
      maxResults: 100,
    });
    for (const m of data.messages ?? []) {
      if (m.id) messageIds.push(m.id);
      if (args.limit && messageIds.length >= args.limit) break;
    }
    pageToken = data.nextPageToken ?? undefined;
    if (args.limit && messageIds.length >= args.limit) break;
  } while (pageToken);

  console.log(`Matched ${messageIds.length} messages.`);

  const out: ScannedMessage[] = [];
  for (const id of messageIds) {
    try {
      const { data } = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });
      const headers = (data.payload?.headers ?? undefined) as
        | Array<{ name?: string | null; value?: string | null }>
        | undefined;
      const subject = getHeader(headers, "subject");
      const date = getHeader(headers, "date");
      const from = getHeader(headers, "from");
      const fromEmail =
        from.match(/<([^>]+)>/)?.[1] ?? from.split(" ")[0] ?? "";
      const body = extractPlaintextBody(data.payload);

      const pdfs = findPdfParts(data.payload).filter((p) =>
        /remodel|bid/i.test(p.filename),
      );
      const sheets = extractSheetUrls(body);

      if (pdfs.length === 0 && sheets.length === 0) continue;

      out.push({
        meta: {
          messageId: id,
          threadId: data.threadId ?? id,
          subject,
          date,
          fromEmail,
          body,
        },
        pdfs,
        sheets,
      });
    } catch (err) {
      console.warn(`  WARN message ${id}: ${(err as Error).message}`);
    }
  }
  const totalPdfs = out.reduce((a, m) => a + m.pdfs.length, 0);
  const totalSheets = out.reduce((a, m) => a + m.sheets.length, 0);
  console.log(
    `${out.length} messages with bid-shaped content (${totalPdfs} PDFs, ${totalSheets} sheet URLs).\n`,
  );
  return out;
}

// ── PDF parsing ──────────────────────────────────────────────────────────────

const MONEY_TAIL = /(.+?)\s+\$([\d,]+\.\d{2})\s*$/;
const FOOTER_KEYWORDS =
  /final clean|rekey|combo lockbox|per diem|gc management|management fee/i;
const SKIP_KEYWORDS = /^(total|subtotal|grand total|sum|page \d+)/i;
const SUBJECT_ADDRESS_RE = /Remodel\s+Bid\s*[-–:]\s*(.+?)\s*$/i;
const ADDRESS_NOISE_SUFFIX_RE =
  /\s*[-–]\s*(?:Invoice|Revised|Updated|Final|Draft|v\d+|Copy|Optional)\b.*$/i;
const ADDRESS_TRAILING_PAREN_RE = /\s*\([^)]*\)\s*$/;

function cleanAddressString(raw: string): string | null {
  let addr = raw.replace(/\s+/g, " ").trim();
  while (ADDRESS_TRAILING_PAREN_RE.test(addr))
    addr = addr.replace(ADDRESS_TRAILING_PAREN_RE, "").trim();
  addr = addr.replace(ADDRESS_NOISE_SUFFIX_RE, "").trim();
  return addr || null;
}

function extractAddressFromSubject(subject: string): string | null {
  const cleaned = subject
    .replace(/^Re:\s*/gi, "")
    .replace(/^Fwd?:\s*/gi, "")
    .trim();
  const m = cleaned.match(SUBJECT_ADDRESS_RE);
  if (!m) return null;
  return cleanAddressString(m[1]);
}

function extractAddressFromFilename(filename: string): string | null {
  // Filenames usually carry the property address most reliably. Normalize
  // underscores to spaces and strip the extension before applying the same
  // regex used on subjects.
  const norm = filename
    .replace(/\.pdf$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = norm.match(SUBJECT_ADDRESS_RE);
  if (!m) return null;
  return cleanAddressString(m[1]);
}

// Sheet display names are often the bare address (e.g. "1387 Cooper Drive...").
// Use the structured "Remodel Bid - X" pattern first, then fall back to
// "starts with a digit" as a cheap address heuristic.
function deriveAddressFromSheetName(name: string | null): string | null {
  if (!name) return null;
  const parsed = extractAddressFromFilename(name);
  if (parsed) return parsed;
  const trimmed = name.trim();
  if (/^\d{1,6}\s+[A-Za-z]/.test(trimmed)) return trimmed;
  return null;
}

interface PdfBidParse {
  rawText: string;
  total: number | null;
  address: string | null;
  lineItems: Array<{ position: number; description: string; total: number | null; isFooter: boolean }>;
}

async function parseBidPdf(buf: Buffer, fallback: string | null): Promise<PdfBidParse> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    const text = result.text ?? "";
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    const lineItems: PdfBidParse["lineItems"] = [];
    let pos = 0;
    for (const line of lines) {
      const m = line.match(MONEY_TAIL);
      if (!m) continue;
      const description = m[1].trim();
      const total = parseFloat(m[2].replace(/,/g, ""));
      if (!Number.isFinite(total)) continue;
      if (description.length < 3) continue;
      if (SKIP_KEYWORDS.test(description)) continue;
      lineItems.push({
        position: pos++,
        description,
        total,
        isFooter: FOOTER_KEYWORDS.test(description),
      });
    }

    const explicit = text.match(/(?:Grand\s+)?Total[:\s]+\$([\d,]+\.\d{2})/i);
    const sum = lineItems.reduce((a, b) => a + (b.total ?? 0), 0);
    const total = explicit ? parseFloat(explicit[1].replace(/,/g, "")) : sum > 0 ? sum : null;

    const address =
      fallback ??
      lines.find((l) => /^\d{1,6}\s+[A-Za-z]/.test(l) && !MONEY_TAIL.test(l) && l.length < 80) ??
      null;

    return { rawText: text, total, address, lineItems };
  } finally {
    await parser.destroy();
  }
}

// ── Address tokenizer (for address_street column) ────────────────────────────

const ADDRESS_STOP = new Set([
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
  "north", "south", "east", "west",
  "st", "dr", "cir", "ave", "rd", "ln", "way", "ct", "blvd", "pl",
  "street", "drive", "circle", "avenue", "road", "lane", "court", "place",
]);

function primaryAddressToken(s: string): string | null {
  const tokens = s.toLowerCase().split(/[\s,#]+/).filter(Boolean);
  for (const t of tokens) {
    if (/^\d+$/.test(t)) continue;
    if (ADDRESS_STOP.has(t)) continue;
    if (/\d/.test(t)) continue;
    if (t.length < 2) continue;
    return t;
  }
  return null;
}

// ── Insert + dedup via Supabase REST ─────────────────────────────────────────

interface BidInsert {
  drive_file_id: string | null;
  tab_name: string;
  address_raw: string | null;
  address_street: string | null;
  bid_year: number | null;
  total_amount: number | null;
  drive_url: string | null;
  modified_at: string | null;
  source: "gmail" | "sheet";
  source_account: string;
  authored_by: string | null;
  raw_text: string;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  subject: string | null;
  original_drive_url?: string | null;
}

async function insertBid(row: BidInsert): Promise<{ id: string | null; duplicate: boolean }> {
  const res = await sb("bids", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (res.status === 409) return { id: null, duplicate: true };
  if (!res.ok) {
    const text = await res.text();
    if (text.includes("23505") || text.toLowerCase().includes("duplicate key")) {
      return { id: null, duplicate: true };
    }
    throw new Error(`bid insert failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as Array<{ id: string }>;
  return { id: data[0]?.id ?? null, duplicate: false };
}

interface LineItemInsert {
  bid_id: string;
  position: number;
  description: string;
  total: number | null;
  is_footer: boolean;
}

async function insertLineItems(items: LineItemInsert[]): Promise<number> {
  if (items.length === 0) return 0;
  const res = await sb("bid_line_items", {
    method: "POST",
    body: JSON.stringify(items),
  });
  if (!res.ok) throw new Error(`line items insert failed: ${res.status} ${await res.text()}`);
  return items.length;
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function processPdf(args: {
  meta: MessageMeta;
  pdf: { attachmentId: string; filename: string };
  sheetUrlHint: string | null;
  gmail: Gmail;
  dryRun: boolean;
  seenHashes: Set<string>;
}): Promise<{ status: "inserted" | "duplicate" | "skip" | "error"; items?: number; total?: number | null; address?: string | null; message?: string }> {
  const { data: att } = await args.gmail.users.messages.attachments.get({
    userId: "me",
    messageId: args.meta.messageId,
    id: args.pdf.attachmentId,
  });
  if (!att.data) return { status: "skip", message: "empty attachment" };

  const buf = Buffer.from(
    att.data.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );

  // Content-hash dedup catches the "same PDF re-attached in multiple emails"
  // case that the (gmail_message_id, tab_name) partial unique can't see.
  const hash = createHash("sha256").update(buf).digest("hex");
  if (args.seenHashes.has(hash)) {
    return { status: "duplicate", message: "content-hash-dup" };
  }
  args.seenHashes.add(hash);

  const fallback =
    extractAddressFromFilename(args.pdf.filename) ??
    extractAddressFromSubject(args.meta.subject);
  const parsed = await parseBidPdf(buf, fallback);

  const bidYear = (() => {
    const d = new Date(args.meta.date);
    return Number.isFinite(d.getTime()) ? d.getFullYear() : null;
  })();
  const street = parsed.address
    ? primaryAddressToken(parsed.address.split(",")[0])
    : null;

  if (args.dryRun) {
    return {
      status: "inserted",
      items: parsed.lineItems.length,
      total: parsed.total,
      address: parsed.address,
    };
  }

  const { id: bidId, duplicate } = await insertBid({
    drive_file_id: null,
    tab_name: args.pdf.filename,
    address_raw: parsed.address,
    address_street: street,
    bid_year: bidYear,
    total_amount: parsed.total,
    drive_url: null,
    modified_at: new Date(args.meta.date).toISOString(),
    source: "gmail",
    source_account: "contracts@tradeinholdings.com",
    authored_by: args.meta.fromEmail,
    raw_text: parsed.rawText,
    gmail_message_id: args.meta.messageId,
    gmail_thread_id: args.meta.threadId,
    subject: args.meta.subject,
    original_drive_url: args.sheetUrlHint,
  });

  if (duplicate) return { status: "duplicate" };
  if (bidId && parsed.lineItems.length > 0) {
    await insertLineItems(
      parsed.lineItems.map((i) => ({
        bid_id: bidId,
        position: i.position,
        description: i.description,
        total: i.total,
        is_footer: i.isFooter,
      })),
    );
  }
  return {
    status: "inserted",
    items: parsed.lineItems.length,
    total: parsed.total,
    address: parsed.address,
  };
}

async function processSheet(args: {
  meta: MessageMeta;
  sheet: { url: string; fileId: string };
  drive: Drive;
  dryRun: boolean;
}): Promise<{ status: "inserted" | "duplicate" | "skip" | "error"; sheetName?: string | null; address?: string | null; accessible?: boolean; message?: string }> {
  // Try to fetch the sheet's metadata via pm@. If pm@ doesn't have read
  // access, we still record the bid with just the URL + email body so the
  // bid library has a pointer.
  let sheetName: string | null = null;
  let accessible = false;
  try {
    const { data } = await args.drive.files.get({
      fileId: args.sheet.fileId,
      fields: "name",
    });
    sheetName = data.name ?? null;
    accessible = true;
  } catch {
    accessible = false;
  }

  const subjectAddress = extractAddressFromSubject(args.meta.subject);
  const nameAddress = deriveAddressFromSheetName(sheetName);
  const address = nameAddress ?? subjectAddress;
  const street = address ? primaryAddressToken(address.split(",")[0]) : null;
  const bidYear = (() => {
    const d = new Date(args.meta.date);
    return Number.isFinite(d.getTime()) ? d.getFullYear() : null;
  })();

  if (args.dryRun) {
    return {
      status: "inserted",
      sheetName,
      address,
      accessible,
    };
  }

  const { id: _bidId, duplicate } = await insertBid({
    drive_file_id: args.sheet.fileId,
    tab_name: sheetName ?? "primary",
    address_raw: address,
    address_street: street,
    bid_year: bidYear,
    total_amount: null,
    drive_url: args.sheet.url,
    modified_at: new Date(args.meta.date).toISOString(),
    source: "sheet",
    source_account: accessible
      ? "pm@tradeinholdings.com"
      : "contracts@tradeinholdings.com",
    authored_by: args.meta.fromEmail,
    raw_text: args.meta.body,
    gmail_message_id: args.meta.messageId,
    gmail_thread_id: args.meta.threadId,
    subject: args.meta.subject,
    original_drive_url: args.sheet.url,
  });
  void _bidId;

  if (duplicate) return { status: "duplicate", accessible };
  return { status: "inserted", sheetName, address, accessible };
}

async function main() {
  const args = parseArgs();
  console.log(
    `Backfilling bids since ${args.since}${args.limit ? `, limit ${args.limit}` : ""}${args.dryRun ? " [DRY RUN]" : ""}\n`,
  );

  const [contractsToken, pmToken] = await Promise.all([
    loadRefreshToken("tih-contracts"),
    loadRefreshToken("tih-pm"),
  ]);
  const gmail = google.gmail({ version: "v1", auth: makeOAuth(contractsToken) });
  const drive = google.drive({ version: "v3", auth: makeOAuth(pmToken) });

  const scanned = await listAllCandidates(gmail, args);

  let pdfInserted = 0;
  let pdfDup = 0;
  let pdfErr = 0;
  let sheetInserted = 0;
  let sheetDup = 0;
  let sheetErr = 0;
  let sheetsAccessible = 0;
  const errors: Array<{ what: string; message: string }> = [];
  const seenHashes = new Set<string>();

  for (const msg of scanned) {
    const sheetUrlHint = msg.sheets[0]?.url ?? null;

    // PDFs first — they carry the most data (full parsed line items).
    for (const pdf of msg.pdfs) {
      try {
        const r = await processPdf({
          meta: msg.meta,
          pdf,
          sheetUrlHint,
          gmail,
          dryRun: args.dryRun,
          seenHashes,
        });
        if (r.status === "inserted") {
          pdfInserted++;
          console.log(
            `  OK  pdf  ${pdf.filename} → addr=${r.address ?? "?"}, total=${r.total ?? "?"}, items=${r.items ?? 0}`,
          );
        } else if (r.status === "duplicate") {
          pdfDup++;
          console.log(`  DUP pdf  ${pdf.filename}`);
        } else {
          console.log(`  SKIP pdf ${pdf.filename}: ${r.message}`);
        }
      } catch (err) {
        pdfErr++;
        const message = (err as Error).message;
        errors.push({ what: `pdf ${pdf.filename}`, message });
        console.log(`  ERR pdf  ${pdf.filename}: ${message}`);
      }
    }

    // Sheets — only when there's no usable PDF for the same message, so the
    // PDF's already-parsed line items don't get shadowed by a fields-only
    // sheet row pointing at the same logical bid.
    if (msg.pdfs.length > 0) continue;
    for (const sheet of msg.sheets) {
      try {
        const r = await processSheet({
          meta: msg.meta,
          sheet,
          drive,
          dryRun: args.dryRun,
        });
        if (r.status === "inserted") {
          sheetInserted++;
          if (r.accessible) sheetsAccessible++;
          console.log(
            `  OK  sheet ${sheet.fileId.slice(0, 10)}… → addr=${r.address ?? "?"}, ${r.accessible ? `name="${r.sheetName ?? "?"}"` : "no-access"}`,
          );
        } else if (r.status === "duplicate") {
          sheetDup++;
          console.log(`  DUP sheet ${sheet.fileId.slice(0, 10)}…`);
        }
      } catch (err) {
        sheetErr++;
        const message = (err as Error).message;
        errors.push({ what: `sheet ${sheet.fileId}`, message });
        console.log(`  ERR sheet ${sheet.fileId.slice(0, 10)}…: ${message}`);
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  PDFs:    ${pdfInserted} inserted, ${pdfDup} dup, ${pdfErr} err`);
  console.log(
    `  Sheets:  ${sheetInserted} inserted (${sheetsAccessible} with pm@ access), ${sheetDup} dup, ${sheetErr} err`,
  );
  console.log(`  Errors:  ${errors.length}`);
  for (const e of errors) console.log(`    ${e.what}: ${e.message}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
