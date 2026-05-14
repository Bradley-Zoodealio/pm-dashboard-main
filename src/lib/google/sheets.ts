import "server-only";

import { getSheetsClient } from "./auth";
import type { MailboxKey } from "./mailboxes";

const LINE_ITEM_START_ROW = 19;
const LINE_ITEM_MAX_ROW = 58;
const FOOTER_MAX_ROW = 65;
const DESC_COL = "B";
const TOTAL_COL = "H";

export interface LineItem {
  description: string;
  total: number;
}

export interface ScrapedLineItem {
  position: number;
  description: string;
  total: number | null;
  isFooter: boolean;
}

export interface SheetTab {
  title: string;
  index: number;
  sheetId: number;
}

export function extractSpreadsheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function rangePrefix(tabName?: string): string {
  return tabName ? `'${tabName.replace(/'/g, "''")}'!` : "";
}

function parseMoneyCell(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export async function listSheetTabs(
  spreadsheetId: string,
  mailbox: MailboxKey = "bradley",
): Promise<SheetTab[]> {
  const sheets = getSheetsClient(mailbox);
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title,index)",
  });
  return (data.sheets ?? []).map((s) => ({
    sheetId: s.properties!.sheetId!,
    title: s.properties!.title ?? "",
    index: s.properties!.index ?? 0,
  }));
}

export async function writeLineItemsToSheet(
  spreadsheetId: string,
  items: LineItem[],
  tabName?: string,
  mailbox: MailboxKey = "bradley",
): Promise<number> {
  const sheets = getSheetsClient(mailbox);
  const pfx = rangePrefix(tabName);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${pfx}A${LINE_ITEM_START_ROW}:H${LINE_ITEM_MAX_ROW}`,
  });

  if (items.length === 0) return 0;

  const startRow = LINE_ITEM_START_ROW;
  const endRow = startRow + items.length - 1;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: `${pfx}${DESC_COL}${startRow}:${DESC_COL}${endRow}`,
          values: items.map((i) => [i.description]),
        },
        {
          range: `${pfx}${TOTAL_COL}${startRow}:${TOTAL_COL}${endRow}`,
          values: items.map((i) => [
            `$${i.total.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`,
          ]),
        },
      ],
    },
  });

  return items.length;
}

export async function readLineItemsFromSheet(
  spreadsheetId: string,
  tabName?: string,
  mailbox: MailboxKey = "bradley",
): Promise<ScrapedLineItem[]> {
  const sheets = getSheetsClient(mailbox);
  const pfx = rangePrefix(tabName);
  const { data } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [
      `${pfx}${DESC_COL}${LINE_ITEM_START_ROW}:${DESC_COL}${FOOTER_MAX_ROW}`,
      `${pfx}${TOTAL_COL}${LINE_ITEM_START_ROW}:${TOTAL_COL}${FOOTER_MAX_ROW}`,
    ],
  });
  const descCol = data.valueRanges?.[0]?.values ?? [];
  const totalCol = data.valueRanges?.[1]?.values ?? [];
  const rowCount = FOOTER_MAX_ROW - LINE_ITEM_START_ROW + 1;
  const out: ScrapedLineItem[] = [];
  for (let i = 0; i < rowCount; i++) {
    const desc = (descCol[i]?.[0] ?? "").toString().trim();
    const total = parseMoneyCell(totalCol[i]?.[0]);
    if (!desc && total == null) continue;
    out.push({
      position: i,
      description: desc,
      total,
      isFooter: i >= LINE_ITEM_MAX_ROW - LINE_ITEM_START_ROW + 1,
    });
  }
  return out;
}

export async function ensureOptionsTabs(
  spreadsheetId: string,
  mailbox: MailboxKey = "bradley",
): Promise<void> {
  const sheets = getSheetsClient(mailbox);
  const tabs = await listSheetTabs(spreadsheetId, mailbox);
  const hasOption1 = tabs.some((t) => t.title === "Option 1");
  const hasOption2 = tabs.some((t) => t.title === "Option 2");

  const requests: object[] = [];

  if (!hasOption1) {
    const firstTab = tabs.find((t) => t.index === 0) ?? tabs[0];
    if (firstTab) {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId: firstTab.sheetId, title: "Option 1" },
          fields: "title",
        },
      });
    }
  }

  if (!hasOption2) {
    const source = hasOption1
      ? tabs.find((t) => t.title === "Option 1")
      : tabs.find((t) => t.index === 0) ?? tabs[0];
    if (source) {
      requests.push({
        duplicateSheet: {
          sourceSheetId: source.sheetId,
          newSheetName: "Option 2",
          insertSheetIndex: 1,
        },
      });
    }
  }

  if (requests.length === 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}
