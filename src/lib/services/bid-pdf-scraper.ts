import "server-only";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";

import { getGmailClient } from "@/lib/google/auth";

// pdfjs-dist's default worker resolution doesn't survive Next/Turbopack's
// bundling. We point setWorker at the real path on disk, but we have to build
// the string at *runtime* — any literal "pdfjs-dist/..." string that
// Turbopack can statically analyze gets rewritten into a bundler-internal id.
// path.join + process.cwd() is invisible to Turbopack and resolves at boot.
const WORKER_PATH = path.join(
  process.cwd(),
  "node_modules",
  "pdfjs-dist",
  "legacy",
  "build",
  "pdf.worker.mjs",
);
PDFParse.setWorker(pathToFileURL(WORKER_PATH).href);
import { extractPlaintextBody, header } from "@/lib/google/gmail";
import {
  appendScrapeRunError,
  insertGmailBid,
  replaceLineItems,
  startScrapeRun,
  updateScrapeRun,
} from "@/lib/db/bids";
import { extractAddressTokens } from "@/lib/google/drive";
import { MAILBOXES } from "@/lib/google/mailboxes";

// ── PDF parsing ──────────────────────────────────────────────────────────────

const MONEY_TAIL = /(.+?)\s+\$([\d,]+\.\d{2})\s*$/;
const FOOTER_KEYWORDS =
  /final clean|rekey|combo lockbox|per diem|gc management|management fee/i;
const SKIP_KEYWORDS = /^(total|subtotal|grand total|sum|page \d+)/i;
const SHEET_URL_IN_BODY = /https?:\/\/docs\.google\.com\/spreadsheets\/[^\s<>"']+/i;

export interface PdfBidParse {
  rawText: string;
  total: number | null;
  address: string | null;
  lineItems: Array<{
    position: number;
    description: string;
    total: number | null;
    isFooter: boolean;
  }>;
}

export async function parseBidPdf(
  buf: Buffer,
  fallbackAddress: string | null,
): Promise<PdfBidParse> {
  // pdf-parse v2 wants a Uint8Array. The class wraps pdfjs-dist and frees
  // resources via destroy() — important for long runs that process many files.
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    const text = result.text ?? "";

    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const lineItems: PdfBidParse["lineItems"] = [];
    let pos = 0;
    for (const line of lines) {
      const m = line.match(MONEY_TAIL);
      if (!m) continue;
      const description = m[1].trim();
      const totalStr = m[2].replace(/,/g, "");
      const total = parseFloat(totalStr);
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

    // Total: explicit "Grand Total: $X" wins; else sum of line items.
    const explicit = text.match(/(?:Grand\s+)?Total[:\s]+\$([\d,]+\.\d{2})/i);
    const sum = lineItems.reduce((a, b) => a + (b.total ?? 0), 0);
    const total = explicit
      ? parseFloat(explicit[1].replace(/,/g, ""))
      : sum > 0
        ? sum
        : null;

    // Address fallback: first line that looks like a street address.
    const inferredAddress =
      fallbackAddress ??
      lines.find(
        (l) =>
          /^\d{1,6}\s+[A-Za-z]/.test(l) && !MONEY_TAIL.test(l) && l.length < 80,
      ) ??
      null;

    return { rawText: text, total, address: inferredAddress, lineItems };
  } finally {
    await parser.destroy();
  }
}

// ── Gmail walker ─────────────────────────────────────────────────────────────

interface PdfTarget {
  messageId: string;
  threadId: string;
  attachmentId: string;
  filename: string;
  subject: string;
  date: string;
  fromEmail: string;
  bodySheetUrl: string | null;
}

const SUBJECT_ADDRESS_RE = /Remodel\s+Bid\s*[-–:]\s*(.+?)\s*$/i;

function extractAddressFromSubject(subject: string): string | null {
  const cleaned = subject.replace(/^Re:\s*/gi, "").trim();
  const m = cleaned.match(SUBJECT_ADDRESS_RE);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

function filenameLooksLikeBid(filename: string): boolean {
  return /remodel|bid/i.test(filename) && /\.pdf$/i.test(filename);
}

function findPdfPartsInPayload(
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

export interface BackfillOptions {
  since: Date;
  limit?: number;
  dryRun?: boolean;
  onProgress?: (m: string) => void;
}

export interface BackfillSummary {
  runId: string | null;
  scanned: number;
  pdfsProcessed: number;
  bidsInserted: number;
  duplicatesSkipped: number;
  itemsInserted: number;
  errors: Array<{ filename: string; message: string }>;
}

export async function backfillBidsFromGmail(
  opts: BackfillOptions,
): Promise<BackfillSummary> {
  const progress = opts.onProgress ?? (() => {});
  const gmail = await getGmailClient("tih-contracts");

  const sinceStr = opts.since.toISOString().slice(0, 10).replace(/-/g, "/");
  const query = `subject:"Remodel Bid" has:attachment filename:pdf after:${sinceStr}`;

  progress(`Gmail query: ${query}`);

  // 1. Page through matching message IDs.
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
      if (opts.limit && messageIds.length >= opts.limit) break;
    }
    pageToken = data.nextPageToken ?? undefined;
    if (opts.limit && messageIds.length >= opts.limit) break;
  } while (pageToken);

  progress(`Matched ${messageIds.length} messages.`);

  // 2. For each message, fetch metadata + PDFs.
  const targets: PdfTarget[] = [];
  for (const id of messageIds) {
    try {
      const { data } = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });
      const headers = data.payload?.headers ?? undefined;
      const subject = header(headers, "subject");
      const date = header(headers, "date");
      const from = header(headers, "from");
      const fromEmail =
        from.match(/<([^>]+)>/)?.[1] ?? from.split(" ")[0] ?? "";
      const body = extractPlaintextBody(data);
      const sheetUrl = body.match(SHEET_URL_IN_BODY)?.[0] ?? null;

      const pdfParts = findPdfPartsInPayload(data.payload).filter((p) =>
        filenameLooksLikeBid(p.filename),
      );

      for (const p of pdfParts) {
        targets.push({
          messageId: id,
          threadId: data.threadId ?? id,
          attachmentId: p.attachmentId,
          filename: p.filename,
          subject,
          date,
          fromEmail,
          bodySheetUrl: sheetUrl,
        });
      }
    } catch (err) {
      progress(`ERR message ${id}: ${(err as Error).message}`);
    }
  }
  progress(`Found ${targets.length} candidate PDF attachments.`);

  // 3. Set up scrape run row (skipped on dry-run).
  let runId: string | null = null;
  if (!opts.dryRun) runId = await startScrapeRun();

  const errors: BackfillSummary["errors"] = [];
  let bidsInserted = 0;
  let duplicatesSkipped = 0;
  let itemsInserted = 0;
  let pdfsProcessed = 0;

  // 4. For each target: fetch PDF, parse, insert.
  for (const t of targets) {
    try {
      const { data: att } = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: t.messageId,
        id: t.attachmentId,
      });
      if (!att.data) {
        progress(`SKIP ${t.filename}: empty attachment data`);
        continue;
      }
      const buf = Buffer.from(
        att.data.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      );

      const fallbackAddress = extractAddressFromSubject(t.subject);
      const parsed = await parseBidPdf(buf, fallbackAddress);
      pdfsProcessed++;

      const bidYear = (() => {
        const d = new Date(t.date);
        return Number.isFinite(d.getTime()) ? d.getFullYear() : null;
      })();
      const street = parsed.address
        ? (extractAddressTokens(parsed.address.split(",")[0]).primary ?? null)
        : null;

      if (opts.dryRun) {
        progress(
          `[dry-run] ${t.filename} → addr=${parsed.address ?? "?"} total=${parsed.total ?? "?"} items=${parsed.lineItems.length}`,
        );
        continue;
      }

      const { id: bidId, duplicate } = await insertGmailBid({
        drive_file_id: null as never,
        tab_name: t.filename,
        address_raw: parsed.address,
        address_street: street,
        bid_year: bidYear,
        total_amount: parsed.total,
        drive_url: null as never,
        modified_at: new Date(t.date).toISOString(),
        source: "gmail",
        source_account: MAILBOXES["tih-contracts"].email,
        authored_by: t.fromEmail,
        raw_text: parsed.rawText,
        gmail_message_id: t.messageId,
        gmail_thread_id: t.threadId,
        subject: t.subject,
      });

      if (duplicate) {
        duplicatesSkipped++;
        progress(`DUP ${t.filename}`);
        continue;
      }
      bidsInserted++;

      if (bidId && parsed.lineItems.length > 0) {
        const written = await replaceLineItems(
          bidId,
          parsed.lineItems.map((i) => ({
            position: i.position,
            description: i.description,
            total: i.total,
            is_footer: i.isFooter,
          })),
        );
        itemsInserted += written;
      }
      progress(
        `OK ${t.filename} → ${parsed.lineItems.length} items, total ${parsed.total ?? "?"}`,
      );
    } catch (err) {
      const message = (err as Error).message;
      errors.push({ filename: t.filename, message });
      progress(`ERR ${t.filename}: ${message}`);
      if (runId) await appendScrapeRunError(runId, t.filename, message);
    }
  }

  if (runId) {
    await updateScrapeRun(runId, {
      files_seen: targets.length,
      bids_upserted: bidsInserted,
      items_upserted: itemsInserted,
      finished_at: new Date().toISOString(),
      errors,
    });
  }

  return {
    runId,
    scanned: messageIds.length,
    pdfsProcessed,
    bidsInserted,
    duplicatesSkipped,
    itemsInserted,
    errors,
  };
}
