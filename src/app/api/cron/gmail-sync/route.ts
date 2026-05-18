import { NextResponse } from "next/server";
import {
  runGmailSync,
  scanForPipelineChanges,
} from "@/lib/services/gmail-sync";

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

  const { searchParams } = new URL(request.url);
  const sinceDaysParam = searchParams.get("sinceDays");
  const sinceDays = sinceDaysParam ? Math.max(1, Math.min(365, parseInt(sinceDaysParam, 10))) : 30;
  const dry = searchParams.get("dry") === "true";

  if (dry) {
    const scan = await scanForPipelineChanges({ sinceDays });
    return NextResponse.json({ ok: true, dry: true, sinceDays, ...scan });
  }

  const result = await runGmailSync({ sinceDays });
  return NextResponse.json({ ok: true, sinceDays, ...result });
}
