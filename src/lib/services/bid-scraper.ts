import "server-only";

import {
  listRemodelBidSheets,
  extractAddressTokens,
  type RemodelBidFile,
} from "@/lib/google/drive";
import {
  listSheetTabs,
  readLineItemsFromSheet,
  type ScrapedLineItem,
} from "@/lib/google/sheets";
import {
  appendScrapeRunError,
  replaceLineItems,
  startScrapeRun,
  updateScrapeRun,
  upsertBid,
} from "@/lib/db/bids";
import { MAILBOXES } from "@/lib/google/mailboxes";

export function parseAddressFromBidName(name: string): string | null {
  if (!name) return null;
  const clean = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const stripped = clean
    .replace(/\b(?:Optional\s+)?Remodel\s+Bid\b/i, "")
    .replace(/^\s*[-–:]\s*/, "")
    .replace(/\s*[-–:]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return stripped || null;
}

function pickTabsToScrape(tabs: Array<{ title: string; index: number }>): string[] {
  if (tabs.length === 0) return [];
  const options = tabs
    .filter((t) => /^Option\s*\d+$/i.test(t.title))
    .map((t) => t.title);
  if (options.length > 0) return options;
  return [tabs.slice().sort((a, b) => a.index - b.index)[0].title];
}

function inferYear(modifiedTime: string | null | undefined): number | null {
  if (!modifiedTime) return null;
  const d = new Date(modifiedTime);
  return Number.isNaN(d.getTime()) ? null : d.getFullYear();
}

function sumLineItemTotals(items: ScrapedLineItem[]): number | null {
  const totals = items.map((i) => i.total).filter((x): x is number => x != null);
  if (totals.length === 0) return null;
  return totals.reduce((a, b) => a + b, 0);
}

function isQuotaError(e: unknown): boolean {
  const msg = (e as { message?: string })?.message ?? "";
  return /quota|rate.?limit|429/i.test(msg);
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  onProgress?: (m: string) => void,
): Promise<T> {
  const delays = [2000, 5000, 15000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      onProgress?.(`quota hit on ${label}, retrying in ${delays[attempt]}ms…`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  return fn();
}

export interface ScrapeOptions {
  sinceDays?: number;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
  perFileDelayMs?: number;
}

export interface ScrapeSummary {
  runId: string | null;
  filesSeen: number;
  bidsUpserted: number;
  itemsUpserted: number;
  errors: Array<{ file: string; message: string }>;
}

async function ingestDriveSheet(
  file: RemodelBidFile,
  opts: ScrapeOptions,
  ctx: {
    progress: (m: string) => void;
    runId: string | null;
    errors: Array<{ file: string; message: string }>;
    counters: { bidsUpserted: number; itemsUpserted: number };
  },
): Promise<void> {
  const { progress, runId, errors, counters } = ctx;
  const addressRaw = parseAddressFromBidName(file.name);
  const addressStreet = addressRaw
    ? extractAddressTokens(addressRaw.split(",")[0] ?? addressRaw).primary
    : null;

  try {
    const tabs = await withRetry(
      () => listSheetTabs(file.id),
      `tabs(${file.name})`,
      progress,
    );
    const tabNames = pickTabsToScrape(tabs);
    for (const tabName of tabNames) {
      const items = await withRetry(
        () => readLineItemsFromSheet(file.id, tabName),
        `read(${file.name}/${tabName})`,
        progress,
      );
      const total = sumLineItemTotals(items);

      if (opts.dryRun) {
        progress(
          `[dry-run] ${file.name} · ${tabName} → ${items.length} items · total ${total ?? "-"}`,
        );
        continue;
      }

      const bidId = await upsertBid({
        drive_file_id: file.id,
        tab_name: tabName,
        address_raw: addressRaw,
        address_street: addressStreet,
        bid_year: inferYear(file.modifiedTime),
        total_amount: total,
        drive_url: file.webViewLink,
        modified_at: file.modifiedTime,
        source: "sheet",
        source_account: MAILBOXES.bradley.email,
      });

      const writtenCount = await replaceLineItems(
        bidId,
        items.map((i) => ({
          position: i.position,
          description: i.description,
          total: i.total,
          is_footer: i.isFooter,
        })),
      );
      counters.bidsUpserted++;
      counters.itemsUpserted += writtenCount;
      progress(`OK ${file.name} · ${tabName} → ${writtenCount} items`);
    }
  } catch (e) {
    const message = (e as Error).message;
    errors.push({ file: file.name, message });
    progress(`ERR ${file.name}: ${message}`);
    if (runId) await appendScrapeRunError(runId, file.name, message);
  }
}

export async function scrapeBidsFromDrive(
  opts: ScrapeOptions = {},
): Promise<ScrapeSummary> {
  const sinceDays = opts.sinceDays ?? 730;
  const since = new Date(Date.now() - sinceDays * 86_400 * 1000);
  const progress = opts.onProgress ?? (() => {});

  let runId: string | null = null;
  if (!opts.dryRun) runId = await startScrapeRun();

  const errors: Array<{ file: string; message: string }> = [];
  const counters = { bidsUpserted: 0, itemsUpserted: 0 };
  let filesSeen = 0;
  const perFileDelay = opts.perFileDelayMs ?? 1200;

  let files: RemodelBidFile[] = [];
  try {
    files = await listRemodelBidSheets({ since });
    progress(
      `Drive: ${files.length} Remodel Bid sheets since ${since.toISOString().slice(0, 10)}.`,
    );
  } catch (e) {
    progress(`Drive listing failed: ${(e as Error).message}`);
    if (runId) await updateScrapeRun(runId, { finished_at: new Date().toISOString() });
    throw e;
  }

  filesSeen += files.length;
  for (const file of files) {
    await ingestDriveSheet(file, opts, { progress, runId, errors, counters });
    if (perFileDelay > 0) await new Promise((r) => setTimeout(r, perFileDelay));
  }

  if (runId) {
    await updateScrapeRun(runId, {
      files_seen: filesSeen,
      bids_upserted: counters.bidsUpserted,
      items_upserted: counters.itemsUpserted,
      finished_at: new Date().toISOString(),
      errors,
    });
  }

  return {
    runId,
    filesSeen,
    bidsUpserted: counters.bidsUpserted,
    itemsUpserted: counters.itemsUpserted,
    errors,
  };
}
