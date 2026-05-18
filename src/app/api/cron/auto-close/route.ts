import { NextResponse } from "next/server";

import {
  closePropertyService,
  findAutoCloseCandidates,
} from "@/lib/services/property-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READY_FOR_LISTING_DAYS = 2;

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

  const cutoff = new Date(
    Date.now() - READY_FOR_LISTING_DAYS * 24 * 60 * 60 * 1000,
  );
  const candidates = await findAutoCloseCandidates(cutoff);

  const results: Array<{ slug: string; ok: boolean; error?: string }> = [];
  for (const { slug } of candidates) {
    try {
      await closePropertyService(slug);
      results.push({ slug, ok: true });
      console.log(`[auto-close] ✓ closed ${slug}`);
    } catch (err) {
      const message = (err as Error).message;
      results.push({ slug, ok: false, error: message });
      console.error(`[auto-close] ✗ ${slug}: ${message}`);
    }
  }

  return NextResponse.json({
    summary: {
      cutoff: cutoff.toISOString(),
      considered: candidates.length,
      closed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
    results,
  });
}
