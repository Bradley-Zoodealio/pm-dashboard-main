import "server-only";

import { getSupabase } from "./supabase";

export interface BidRow {
  id: string;
  drive_file_id: string;
  tab_name: string;
  address_raw: string | null;
  address_street: string | null;
  bid_year: number | null;
  total_amount: number | null;
  drive_url: string;
  modified_at: string | null;
  scraped_at: string;
  source: string;
  source_account: string | null;
  authored_by: string | null;
  raw_text: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  subject: string | null;
}

export interface BidLineItemRow {
  id: string;
  bid_id: string;
  position: number;
  description: string;
  total: number | null;
  is_footer: boolean;
}

export interface BidUpsert {
  drive_file_id: string;
  tab_name: string;
  address_raw: string | null;
  address_street: string | null;
  bid_year: number | null;
  total_amount: number | null;
  drive_url: string;
  modified_at: string | null;
  source: string;
  source_account: string | null;
  authored_by?: string | null;
  raw_text?: string | null;
  gmail_message_id?: string | null;
  gmail_thread_id?: string | null;
  subject?: string | null;
}

export async function upsertBid(row: BidUpsert): Promise<string> {
  const { data, error } = await getSupabase()
    .from("bids")
    .upsert(row, { onConflict: "drive_file_id,tab_name" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function replaceLineItems(
  bidId: string,
  items: Array<{ position: number; description: string; total: number | null; is_footer: boolean }>,
): Promise<number> {
  const sb = getSupabase();
  const del = await sb.from("bid_line_items").delete().eq("bid_id", bidId);
  if (del.error) throw del.error;
  if (items.length === 0) return 0;
  const ins = await sb
    .from("bid_line_items")
    .insert(items.map((i) => ({ bid_id: bidId, ...i })));
  if (ins.error) throw ins.error;
  return items.length;
}

export async function startScrapeRun(): Promise<string> {
  const { data, error } = await getSupabase()
    .from("bid_scrape_runs")
    .insert({})
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export interface ScrapeRunUpdate {
  files_seen?: number;
  bids_upserted?: number;
  items_upserted?: number;
  finished_at?: string;
  errors?: unknown;
}

export async function updateScrapeRun(runId: string, patch: ScrapeRunUpdate): Promise<void> {
  const { error } = await getSupabase()
    .from("bid_scrape_runs")
    .update(patch)
    .eq("id", runId);
  if (error) throw error;
}

export async function appendScrapeRunError(
  runId: string,
  file: string,
  message: string,
): Promise<void> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bid_scrape_runs")
    .select("errors")
    .eq("id", runId)
    .single();
  if (error) throw error;
  const errs = Array.isArray(data?.errors) ? data!.errors : [];
  errs.push({ file, message, at: new Date().toISOString() });
  const upd = await sb.from("bid_scrape_runs").update({ errors: errs }).eq("id", runId);
  if (upd.error) throw upd.error;
}

export interface BidSearchHit {
  bid: BidRow;
  matchedDescriptions: BidLineItemRow[];
}

export async function searchBids(query: string, limit = 40): Promise<BidSearchHit[]> {
  const sb = getSupabase();
  const term = `%${query}%`;

  const [byAddress, byLineItem] = await Promise.all([
    sb
      .from("bids")
      .select("*")
      .or(`address_raw.ilike.${term},address_street.ilike.${term},subject.ilike.${term}`)
      .order("modified_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    sb
      .from("bid_line_items")
      .select("*, bids!inner(*)")
      .ilike("description", term)
      .limit(limit),
  ]);

  if (byAddress.error) throw byAddress.error;
  if (byLineItem.error) throw byLineItem.error;

  const map = new Map<string, BidSearchHit>();
  for (const b of (byAddress.data ?? []) as BidRow[]) {
    map.set(b.id, { bid: b, matchedDescriptions: [] });
  }
  for (const li of (byLineItem.data ?? []) as Array<BidLineItemRow & { bids: BidRow }>) {
    const bid = li.bids;
    const existing = map.get(bid.id);
    const { bids: _ignored, ...lineItem } = li;
    void _ignored;
    if (existing) existing.matchedDescriptions.push(lineItem);
    else map.set(bid.id, { bid, matchedDescriptions: [lineItem] });
  }
  return Array.from(map.values()).slice(0, limit);
}

export interface ScrapeRunSummary {
  finished_at: string | null;
  files_seen: number;
  bids_upserted: number;
  items_upserted: number;
  has_errors: boolean;
}

export async function getLastSuccessfulScrape(): Promise<ScrapeRunSummary | null> {
  const { data, error } = await getSupabase()
    .from("bid_scrape_runs")
    .select("finished_at, files_seen, bids_upserted, items_upserted, errors")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const errs = Array.isArray((data as { errors: unknown }).errors)
    ? ((data as { errors: unknown[] }).errors)
    : [];
  return {
    finished_at: (data as { finished_at: string | null }).finished_at,
    files_seen: (data as { files_seen: number }).files_seen,
    bids_upserted: (data as { bids_upserted: number }).bids_upserted,
    items_upserted: (data as { items_upserted: number }).items_upserted,
    has_errors: errs.length > 0,
  };
}

export async function listRecentBids(limit = 30): Promise<BidRow[]> {
  const { data, error } = await getSupabase()
    .from("bids")
    .select("*")
    .order("modified_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as BidRow[];
}

export async function listBidLineItems(bidId: string): Promise<BidLineItemRow[]> {
  const { data, error } = await getSupabase()
    .from("bid_line_items")
    .select("*")
    .eq("bid_id", bidId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BidLineItemRow[];
}
