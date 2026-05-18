"use server";

import { revalidatePath } from "next/cache";

import { markOAuthAccountRevoked } from "@/lib/db/oauth-accounts";
import type { MailboxKey } from "@/lib/google/mailboxes";

export async function revokeMailbox(mailbox: MailboxKey): Promise<void> {
  await markOAuthAccountRevoked(mailbox);
  revalidatePath("/admin/oauth");
}
