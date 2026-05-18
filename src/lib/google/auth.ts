import "server-only";

import { google, type gmail_v1, type drive_v3, type sheets_v4 } from "googleapis";
import { decrypt } from "@/lib/crypto/envelope";
import { getOAuthAccountByKey } from "@/lib/db/oauth-accounts";
import { MAILBOXES, type MailboxKey } from "./mailboxes";

interface ClientCreds {
  id: string;
  secret: string;
  redirect: string;
}

function loadClientCreds(): ClientCreds {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect = process.env.GOOGLE_REDIRECT_URI;
  if (!id || !secret || !redirect) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI must all be set in .env.local for the OAuth flow.",
    );
  }
  return { id, secret, redirect };
}

// Construct a bare OAuth2 client — used both by the bootstrap flow (where
// no refresh token exists yet) and by the per-mailbox factories below.
export function makeOAuth2Client(opts?: { refreshToken?: string }) {
  const { id, secret, redirect } = loadClientCreds();
  const client = new google.auth.OAuth2(id, secret, redirect);
  if (opts?.refreshToken) {
    client.setCredentials({ refresh_token: opts.refreshToken });
  }
  return client;
}

async function authForMailbox(mailbox: MailboxKey) {
  const row = await getOAuthAccountByKey(mailbox);
  if (!row) {
    throw new Error(
      `Mailbox '${mailbox}' is not bootstrapped. Connect it at /admin/oauth.`,
    );
  }
  if (row.revoked_at) {
    throw new Error(
      `Mailbox '${mailbox}' was revoked (${row.revoked_at}). Reconnect at /admin/oauth.`,
    );
  }
  const expected = MAILBOXES[mailbox].email;
  if (row.email.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `Mailbox '${mailbox}' is bootstrapped with '${row.email}', expected '${expected}'. Reconnect at /admin/oauth.`,
    );
  }
  return makeOAuth2Client({ refreshToken: decrypt(row.refresh_token_encrypted) });
}

export async function getGmailClient(
  mailbox: MailboxKey,
): Promise<gmail_v1.Gmail> {
  return google.gmail({ version: "v1", auth: await authForMailbox(mailbox) });
}

export async function getDriveClient(
  mailbox: MailboxKey,
): Promise<drive_v3.Drive> {
  return google.drive({ version: "v3", auth: await authForMailbox(mailbox) });
}

export async function getSheetsClient(
  mailbox: MailboxKey,
): Promise<sheets_v4.Sheets> {
  return google.sheets({ version: "v4", auth: await authForMailbox(mailbox) });
}
