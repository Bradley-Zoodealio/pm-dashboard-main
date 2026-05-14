import "server-only";

import { google, type gmail_v1, type drive_v3, type sheets_v4 } from "googleapis";
import { MAILBOXES, type MailboxKey } from "./mailboxes";

// These must match the scopes authorized in Workspace Admin → Domain-Wide
// Delegation. Adding a scope here without also adding it in admin.google.com
// will break ALL google calls with `unauthorized_client`.
// Currently authorized for the zoodealio.com workspace:
//   drive, spreadsheets, gmail.readonly
// Future scopes (e.g. gmail.send) require a DWD update first.
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
];

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function loadServiceAccountKey(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set. Paste the service account JSON (raw or base64) into .env.local.",
    );
  }

  const trimmed = raw.trim();
  const decoded = trimmed.startsWith("{")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf-8");

  let parsed: ServiceAccountKey;
  try {
    parsed = JSON.parse(decoded) as ServiceAccountKey;
  } catch (err) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is missing required fields (client_email, private_key).",
    );
  }

  parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

let cachedKey: ServiceAccountKey | null = null;
function getServiceAccountKey(): ServiceAccountKey {
  cachedKey ??= loadServiceAccountKey();
  return cachedKey;
}

function makeAuth(mailbox: MailboxKey) {
  const key = getServiceAccountKey();
  const mb = MAILBOXES[mailbox];
  return new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
    subject: mb.email,
  });
}

export function getGmailClient(mailbox: MailboxKey): gmail_v1.Gmail {
  return google.gmail({ version: "v1", auth: makeAuth(mailbox) });
}

export function getDriveClient(mailbox: MailboxKey): drive_v3.Drive {
  return google.drive({ version: "v3", auth: makeAuth(mailbox) });
}

export function getSheetsClient(mailbox: MailboxKey): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: makeAuth(mailbox) });
}
