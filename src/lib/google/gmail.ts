import "server-only";

import type { gmail_v1 } from "googleapis";
import { getGmailClient } from "./auth";
import type { MailboxKey } from "./mailboxes";

export interface ThreadHeader {
  threadId: string;
  subject: string;
  date: string;
  from: string;
}

export async function verifyAccess(
  mailbox: MailboxKey,
): Promise<{ ok: boolean; emailAddress?: string; error?: string }> {
  try {
    const gmail = await getGmailClient(mailbox);
    const { data } = await gmail.users.getProfile({ userId: "me" });
    return { ok: true, emailAddress: data.emailAddress ?? undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function listThreads(
  q: string,
  mailbox: MailboxKey,
  cap = 500,
): Promise<ThreadHeader[]> {
  const gmail = await getGmailClient(mailbox);
  const out: ThreadHeader[] = [];
  let pageToken: string | undefined;
  // Page through results until we hit the cap. Gmail allows up to 500
  // threads per page; without pagination an inspection-report sweep at
  // sinceDays > 60 would silently miss older threads.
  do {
    const { data } = await gmail.users.threads.list({
      userId: "me",
      q,
      maxResults: Math.min(500, cap - out.length),
      pageToken,
    });
    for (const t of data.threads ?? []) {
      if (!t.id) continue;
      const detail = await gmail.users.threads.get({
        userId: "me",
        id: t.id,
        format: "metadata",
        metadataHeaders: ["Subject", "Date", "From"],
      });
      const firstMsg = detail.data.messages?.[0];
      if (!firstMsg) continue;
      const headers = firstMsg.payload?.headers ?? [];
      out.push({
        threadId: t.id,
        subject: header(headers, "subject"),
        date: header(headers, "date"),
        from: header(headers, "from"),
      });
      if (out.length >= cap) break;
    }
    pageToken = data.nextPageToken ?? undefined;
    if (out.length >= cap) break;
  } while (pageToken);
  return out;
}

export async function getThread(
  threadId: string,
  mailbox: MailboxKey,
): Promise<gmail_v1.Schema$Thread> {
  const gmail = await getGmailClient(mailbox);
  const { data } = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });
  return data;
}

export function header(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  if (!headers) return "";
  const target = name.toLowerCase();
  return headers.find((h) => h.name?.toLowerCase() === target)?.value ?? "";
}

export function decodeBase64Url(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

export function extractPlaintextBody(message: gmail_v1.Schema$Message): string {
  const walk = (part: gmail_v1.Schema$MessagePart): string | null => {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    for (const child of part.parts ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  if (message.payload) {
    const body = walk(message.payload);
    if (body) return body;
  }
  return "";
}

export function senderName(from: string): string {
  const m = from.match(/<([^>]+)>/);
  const email = m ? m[1] : from;
  return email.split("@")[0];
}
