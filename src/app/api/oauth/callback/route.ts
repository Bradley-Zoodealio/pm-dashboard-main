import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";

import { makeOAuth2Client } from "@/lib/google/auth";
import { upsertOAuthToken } from "@/lib/db/oauth-accounts";
import { MAILBOXES, type MailboxKey } from "@/lib/google/mailboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "oauth_state";

function redirectWithError(reqUrl: string, message: string) {
  const url = new URL("/admin/oauth", reqUrl);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    return redirectWithError(request.url, `Google returned: ${errorParam}`);
  }
  if (!code || !state) {
    return redirectWithError(request.url, "Missing code or state in callback URL.");
  }

  const c = await cookies();
  const cookieState = c.get(STATE_COOKIE)?.value;
  c.delete(STATE_COOKIE);

  if (!cookieState || cookieState !== state) {
    return redirectWithError(
      request.url,
      "State mismatch — possible CSRF or expired session. Try Connect again.",
    );
  }

  const mailbox = state.split(":")[1] as MailboxKey | undefined;
  if (!mailbox || !(mailbox in MAILBOXES)) {
    return redirectWithError(
      request.url,
      `Bad mailbox in state token: ${mailbox ?? "(none)"}`,
    );
  }
  const mb = MAILBOXES[mailbox];

  const oauth = makeOAuth2Client();
  let tokens;
  try {
    const exchange = await oauth.getToken(code);
    tokens = exchange.tokens;
  } catch (err) {
    return redirectWithError(
      request.url,
      `Token exchange failed: ${(err as Error).message}`,
    );
  }

  if (!tokens.refresh_token) {
    // No refresh_token means Google reused a prior consent. Force a fresh one
    // by revoking app access at myaccount.google.com/permissions and retrying.
    return redirectWithError(
      request.url,
      "Google did not return a refresh_token. Revoke app access at https://myaccount.google.com/permissions for this account, then click Connect again.",
    );
  }

  // Verify the consenting account matches what this mailbox slot expects.
  // Use whichever scope was granted to fetch the email — gmail.readonly and
  // drive both expose the authenticated user's email through their own APIs,
  // so we don't need to add a separate userinfo/openid scope.
  oauth.setCredentials(tokens);
  let grantedEmail = "";
  try {
    if (mb.scopes.some((s) => s.includes("/gmail"))) {
      const gmail = google.gmail({ version: "v1", auth: oauth });
      const { data } = await gmail.users.getProfile({ userId: "me" });
      grantedEmail = data.emailAddress ?? "";
    } else if (
      mb.scopes.some((s) => s.includes("/drive") || s.includes("/spreadsheets"))
    ) {
      const drive = google.drive({ version: "v3", auth: oauth });
      const { data } = await drive.about.get({ fields: "user(emailAddress)" });
      grantedEmail = data.user?.emailAddress ?? "";
    } else {
      return redirectWithError(
        request.url,
        `Cannot identify consenting account: mailbox '${mailbox}' has scopes [${mb.scopes.join(", ")}] with no compatible identity API.`,
      );
    }
  } catch (err) {
    return redirectWithError(
      request.url,
      `Could not read profile after consent: ${(err as Error).message}`,
    );
  }

  if (!grantedEmail) {
    return redirectWithError(
      request.url,
      "Identity API returned no email. Try Connect again.",
    );
  }

  if (grantedEmail.toLowerCase() !== mb.email.toLowerCase()) {
    return redirectWithError(
      request.url,
      `Wrong account — signed in as '${grantedEmail}', but '${mailbox}' expects '${mb.email}'. Sign out of that account, click Connect, and choose the right one.`,
    );
  }

  await upsertOAuthToken({
    mailboxKey: mailbox,
    email: grantedEmail,
    refreshToken: tokens.refresh_token,
    scopes: [...mb.scopes],
  });

  const successUrl = new URL("/admin/oauth", request.url);
  successUrl.searchParams.set("connected", mailbox);
  return NextResponse.redirect(successUrl);
}
