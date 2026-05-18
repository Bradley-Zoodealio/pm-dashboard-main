import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";

import { makeOAuth2Client } from "@/lib/google/auth";
import { MAILBOXES, type MailboxKey } from "@/lib/google/mailboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "oauth_state";
const STATE_TTL_SECONDS = 600;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mailbox = searchParams.get("mailbox") as MailboxKey | null;

  if (!mailbox || !(mailbox in MAILBOXES)) {
    return NextResponse.json(
      { error: `unknown mailbox: ${mailbox ?? "(missing)"}` },
      { status: 400 },
    );
  }

  const mb = MAILBOXES[mailbox];
  if (mb.scopes.length === 0) {
    return NextResponse.json(
      {
        error: `mailbox '${mailbox}' has no scopes configured — bootstrap is deferred.`,
      },
      { status: 400 },
    );
  }

  // state = <random>:<mailbox-key>. The random half prevents CSRF; the mailbox
  // half lets the callback know which slot to populate without an extra DB hit.
  const state = `${crypto.randomBytes(16).toString("hex")}:${mailbox}`;

  const c = await cookies();
  c.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });

  const oauth = makeOAuth2Client();
  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...mb.scopes],
    state,
    // Helps Google pre-select the right account if the user is signed into multiple.
    login_hint: mb.email,
    // Defensive: include the email in the consent screen so the user double-checks.
    include_granted_scopes: true,
  });

  return NextResponse.redirect(authUrl);
}
