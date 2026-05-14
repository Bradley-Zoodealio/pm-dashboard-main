import { NextResponse } from "next/server";
import { scrapeBidsFromDrive } from "@/lib/services/bid-scraper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  // Authorize with CRON_SECRET — same gate as the cron route so the admin trigger
  // can't be hit anonymously even when the app itself has no auth.
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
  const sinceDays = Number(url.searchParams.get("sinceDays") ?? 730);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const logs: string[] = [];
  const summary = await scrapeBidsFromDrive({
    sinceDays,
    dryRun,
    onProgress: (m) => {
      logs.push(m);
      console.log("[scrape-bids]", m);
    },
  });

  return NextResponse.json({ ok: true, summary, logs });
}
