import { NextResponse } from "next/server";

import { getDriveClient, getGmailClient } from "@/lib/google/auth";
import {
  listOAuthAccounts,
  markOAuthAccountError,
  markOAuthAccountUsed,
} from "@/lib/db/oauth-accounts";
import { MAILBOXES, MAILBOX_KEYS, type MailboxKey } from "@/lib/google/mailboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VerifyResult {
  mailbox: MailboxKey;
  email: string;
  bootstrapped: boolean;
  ok: boolean;
  detail?: string;
  error?: string;
  observedEmail?: string;
}

async function verifyMailbox(key: MailboxKey): Promise<VerifyResult> {
  const mb = MAILBOXES[key];
  const base = { mailbox: key, email: mb.email } as const;

  if (mb.scopes.length === 0) {
    return { ...base, bootstrapped: false, ok: false, detail: "deferred (no scopes)" };
  }

  try {
    const observed: string[] = [];
    if (mb.scopes.some((s) => s.includes("/gmail"))) {
      const gmail = await getGmailClient(key);
      const { data } = await gmail.users.getProfile({ userId: "me" });
      if (data.emailAddress) observed.push(data.emailAddress);
    }
    if (mb.scopes.some((s) => s.includes("/drive") || s.includes("/spreadsheets"))) {
      const drive = await getDriveClient(key);
      const { data } = await drive.about.get({ fields: "user(emailAddress)" });
      const e = data.user?.emailAddress;
      if (e) observed.push(e);
    }
    await markOAuthAccountUsed(key);
    return {
      ...base,
      bootstrapped: true,
      ok: true,
      observedEmail: observed[0],
    };
  } catch (err) {
    const message = (err as Error).message;
    // Heuristic: errors from the DB-side "not bootstrapped" check don't deserve
    // to clobber last_error — only Google-side failures do.
    if (!message.includes("not bootstrapped")) {
      await markOAuthAccountError(key, message);
    }
    return { ...base, bootstrapped: !message.includes("not bootstrapped"), ok: false, error: message };
  }
}

export async function GET(request: Request) {
  // Matches the auth model of the rest of /api/admin/* and /api/cron/* — the
  // app deliberately has no board-level gate, so admin routes lean on
  // CRON_SECRET Bearer auth instead. Curl it with:
  //   curl -H "Authorization: Bearer $CRON_SECRET" /api/admin/oauth-verify
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

  // Touch listOAuthAccounts so any DB-side error surfaces early.
  await listOAuthAccounts();
  const results = await Promise.all(MAILBOX_KEYS.map(verifyMailbox));
  const summary = {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => r.bootstrapped && !r.ok).length,
    deferred: results.filter((r) => !r.bootstrapped && r.detail === "deferred (no scopes)").length,
    notConnected: results.filter((r) => !r.bootstrapped && r.detail !== "deferred (no scopes)").length,
  };
  return NextResponse.json({ summary, results });
}

