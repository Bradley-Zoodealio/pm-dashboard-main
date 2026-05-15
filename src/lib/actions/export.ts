"use server";

import { BUCKETS, classifyLineItem, isFooterText } from "@/lib/services/bid-buckets";
import { median } from "@/lib/services/median";
import { getSupabase } from "@/lib/db/supabase";

function csvCell(s: string | number | null): string {
  if (s == null) return "";
  const t = String(s);
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

// Returns a CSV string of every distinct phrasing across the library,
// grouped by bucket + group, with n/avg/median/min/max/last-used.
// Intended for download from the Items tab.
export async function exportPhrasingsCsvAction(): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bid_line_items")
    .select("description, total, is_footer, bids!inner(modified_at)")
    .eq("is_footer", false);
  if (error) throw error;

  interface PhraseAccum {
    description: string;
    bucket: string;
    group: string;
    totals: number[];
    lastUsed: string | null;
  }

  const map = new Map<string, PhraseAccum>();
  for (const row of data ?? []) {
    const r = row as unknown as {
      description: string;
      total: number | null;
      bids: { modified_at: string | null } | null;
    };
    const desc = (r.description ?? "").trim();
    if (!desc || isFooterText(desc)) continue;
    const key = desc.toLowerCase();
    const bucketName = classifyLineItem(desc);
    const bucket = BUCKETS.find((b) => b.name === bucketName);
    if (!map.has(key)) {
      map.set(key, {
        description: desc,
        bucket: bucketName,
        group: bucket?.group ?? bucketName,
        totals: [],
        lastUsed: null,
      });
    }
    const entry = map.get(key)!;
    if (r.total != null) entry.totals.push(Number(r.total));
    if (r.bids?.modified_at && (!entry.lastUsed || r.bids.modified_at > entry.lastUsed)) {
      entry.lastUsed = r.bids.modified_at;
    }
  }

  const rows = Array.from(map.values())
    .map((e) => {
      const n = e.totals.length;
      const sum = e.totals.reduce((a, b) => a + b, 0);
      const avg = n > 0 ? sum / n : 0;
      const med = median(e.totals);
      const min = n > 0 ? Math.min(...e.totals) : null;
      const max = n > 0 ? Math.max(...e.totals) : null;
      return {
        group: e.group,
        bucket: e.bucket,
        description: e.description,
        n: e.totals.length,
        avg: Math.round(avg),
        median: med != null ? Math.round(med) : null,
        min: min != null ? Math.round(min) : null,
        max: max != null ? Math.round(max) : null,
        last_used: e.lastUsed?.slice(0, 10) ?? null,
      };
    })
    .sort(
      (a, b) =>
        a.group.localeCompare(b.group) ||
        a.bucket.localeCompare(b.bucket) ||
        b.n - a.n ||
        b.avg - a.avg,
    );

  const header = ["group", "bucket", "description", "n", "avg", "median", "min", "max", "last_used"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.group, r.bucket, r.description, r.n, r.avg, r.median, r.min, r.max, r.last_used]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
