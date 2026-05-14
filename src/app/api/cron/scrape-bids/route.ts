import { NextResponse } from "next/server";
import { scrapeBidsFromDrive } from "@/lib/services/bid-scraper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
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

  const summary = await scrapeBidsFromDrive({
    sinceDays: 730,
    onProgress: (m) => console.log("[cron/scrape-bids]", m),
  });

  return NextResponse.json({ ok: true, summary });
}
