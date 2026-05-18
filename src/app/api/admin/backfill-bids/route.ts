import { NextResponse } from "next/server";

import { backfillBidsFromGmail } from "@/lib/services/bid-pdf-scraper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on this deployment" },
      { status: 500 },
    );
  }
  const header = request.headers.get("authorization") ?? "";
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : new Date("2023-01-01");
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json(
      { error: `Invalid "since" date: ${sinceParam}` },
      { status: 400 },
    );
  }
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, parseInt(limitParam, 10)) : undefined;
  const dryRun = url.searchParams.get("dryRun") === "1";

  const logs: string[] = [];
  const summary = await backfillBidsFromGmail({
    since,
    limit,
    dryRun,
    onProgress: (m) => {
      logs.push(m);
      console.log("[backfill-bids]", m);
    },
  });

  return NextResponse.json({
    ok: true,
    sinceParsed: since.toISOString(),
    limit: limit ?? null,
    dryRun,
    summary,
    logs,
  });
}
