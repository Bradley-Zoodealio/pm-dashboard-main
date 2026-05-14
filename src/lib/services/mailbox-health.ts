import "server-only";

import { verifyAccess } from "@/lib/google/gmail";
import { MAILBOXES, MAILBOX_KEYS, type MailboxKey } from "@/lib/google/mailboxes";

export interface MailboxHealth {
  key: MailboxKey;
  email: string;
  domain: string;
  ok: boolean;
  emailAddress?: string;
  error?: string;
}

export async function checkAllMailboxes(): Promise<MailboxHealth[]> {
  const checks = MAILBOX_KEYS.map(async (key) => {
    const mb = MAILBOXES[key];
    const result = await verifyAccess(key);
    return {
      key,
      email: mb.email,
      domain: mb.domain,
      ok: result.ok,
      emailAddress: result.emailAddress,
      error: result.error,
    };
  });
  return Promise.all(checks);
}
