import { NextResponse } from "next/server";
import { checkAllMailboxes } from "@/lib/services/mailbox-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const checks = await checkAllMailboxes();
  for (const c of checks) {
    if (c.ok) {
      console.log(`[token-health] ✓ ${c.key} (${c.emailAddress ?? c.email})`);
    } else {
      console.error(`[token-health] ✗ ${c.key} (${c.email}): ${c.error}`);
    }
  }
  return NextResponse.json({
    summary: {
      total: checks.length,
      ok: checks.filter((c) => c.ok).length,
      failed: checks.filter((c) => !c.ok).length,
    },
    checks,
  });
}
