import "server-only";

import { getSupabase } from "./supabase";
import { BUCKETS, classifyLineItem, isFooterText } from "@/lib/services/bid-buckets";
import type { BidLineItemRow, BidRow } from "./bids";

export interface BucketSummary {
  name: string;
  itemCount: number;
  bidCount: number;
  totalSpend: number;
  avgPerItem: number;
  prices: number[];
}

export interface BucketPhrasing {
  description: string;
  n: number;
  avgTotal: number;
  minTotal: number | null;
  maxTotal: number | null;
  lastUsed: string | null;
}

export interface BucketDetail {
  summary: BucketSummary;
  phrasings: BucketPhrasing[];
}

interface ItemRowWithBid extends BidLineItemRow {
  bids: { id: string; modified_at: string | null } | null;
}

async function loadClassifiableItems(): Promise<
  Array<{ description: string; total: number | null; bidId: string; modifiedAt: string | null }>
> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bid_line_items")
    .select("description, total, is_footer, bids!inner(id, modified_at)")
    .eq("is_footer", false);
  if (error) throw error;

  return (data ?? [])
    .map((row) => {
      const r = row as unknown as ItemRowWithBid;
      const description = (r.description ?? "").trim();
      return {
        description,
        total: r.total != null ? Number(r.total) : null,
        bidId: r.bids?.id ?? "",
        modifiedAt: r.bids?.modified_at ?? null,
      };
    })
    .filter((r) => r.description.length > 0 && !isFooterText(r.description));
}

export async function listBucketSummaries(): Promise<BucketSummary[]> {
  const items = await loadClassifiableItems();

  const accum = new Map<string, { items: number; bids: Set<string>; prices: number[] }>();
  for (const bucket of BUCKETS) {
    accum.set(bucket.name, { items: 0, bids: new Set(), prices: [] });
  }

  for (const it of items) {
    const bucket = classifyLineItem(it.description);
    const entry = accum.get(bucket)!;
    entry.items += 1;
    if (it.bidId) entry.bids.add(it.bidId);
    if (it.total != null) entry.prices.push(it.total);
  }

  return BUCKETS.map((b) => {
    const entry = accum.get(b.name)!;
    const totalSpend = entry.prices.reduce((sum, p) => sum + p, 0);
    return {
      name: b.name,
      itemCount: entry.items,
      bidCount: entry.bids.size,
      totalSpend,
      avgPerItem: entry.prices.length > 0 ? totalSpend / entry.prices.length : 0,
      prices: entry.prices,
    };
  }).filter((s) => s.itemCount > 0);
}

export async function listBucketDetail(bucketName: string): Promise<BucketDetail> {
  const items = await loadClassifiableItems();
  const bucketItems = items.filter((it) => classifyLineItem(it.description) === bucketName);

  const summary: BucketSummary = {
    name: bucketName,
    itemCount: bucketItems.length,
    bidCount: new Set(bucketItems.map((i) => i.bidId)).size,
    totalSpend: bucketItems.reduce((s, i) => s + (i.total ?? 0), 0),
    avgPerItem: 0,
    prices: bucketItems.map((i) => i.total).filter((t): t is number => t != null),
  };
  summary.avgPerItem = summary.prices.length > 0 ? summary.totalSpend / summary.prices.length : 0;

  const phraseMap = new Map<string, { n: number; totals: number[]; lastUsed: string | null }>();
  for (const it of bucketItems) {
    const key = it.description.toLowerCase().trim();
    if (!phraseMap.has(key)) phraseMap.set(key, { n: 0, totals: [], lastUsed: null });
    const entry = phraseMap.get(key)!;
    entry.n += 1;
    if (it.total != null) entry.totals.push(it.total);
    if (it.modifiedAt && (!entry.lastUsed || it.modifiedAt > entry.lastUsed)) {
      entry.lastUsed = it.modifiedAt;
    }
  }

  const phrasings: BucketPhrasing[] = Array.from(phraseMap.entries())
    .map(([description, entry]) => ({
      description,
      n: entry.n,
      avgTotal:
        entry.totals.length > 0
          ? entry.totals.reduce((a, b) => a + b, 0) / entry.totals.length
          : 0,
      minTotal: entry.totals.length > 0 ? Math.min(...entry.totals) : null,
      maxTotal: entry.totals.length > 0 ? Math.max(...entry.totals) : null,
      lastUsed: entry.lastUsed,
    }))
    .sort((a, b) => b.n - a.n || b.avgTotal - a.avgTotal);

  return { summary, phrasings };
}

export interface LineItemOccurrence {
  bid: Pick<BidRow, "id" | "address_raw" | "drive_url" | "bid_year" | "tab_name">;
  total: number | null;
  position: number;
}

export async function listOccurrencesForPhrasing(
  phrasingLower: string,
): Promise<LineItemOccurrence[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bid_line_items")
    .select("position, total, description, bids!inner(id, address_raw, drive_url, bid_year, tab_name, modified_at)")
    .ilike("description", phrasingLower);
  if (error) throw error;

  return (data ?? [])
    .map((row) => {
      const r = row as unknown as {
        position: number;
        total: number | null;
        description: string;
        bids: { id: string; address_raw: string | null; drive_url: string; bid_year: number | null; tab_name: string; modified_at: string | null };
      };
      return {
        bid: {
          id: r.bids.id,
          address_raw: r.bids.address_raw,
          drive_url: r.bids.drive_url,
          bid_year: r.bids.bid_year,
          tab_name: r.bids.tab_name,
        },
        total: r.total != null ? Number(r.total) : null,
        position: r.position,
      };
    })
    .sort((a, b) => (b.bid.bid_year ?? 0) - (a.bid.bid_year ?? 0));
}
