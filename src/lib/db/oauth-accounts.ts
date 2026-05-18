import "server-only";

import { encrypt } from "@/lib/crypto/envelope";
import { getSupabase } from "./supabase";

export interface OAuthAccountRow {
  id: string;
  mailbox_key: string;
  email: string;
  refresh_token_encrypted: string;
  scopes: string[];
  granted_at: string;
  last_used_at: string | null;
  last_error: string | null;
  revoked_at: string | null;
}

export async function getOAuthAccountByKey(
  key: string,
): Promise<OAuthAccountRow | null> {
  const { data, error } = await getSupabase()
    .from("oauth_accounts")
    .select("*")
    .eq("mailbox_key", key)
    .maybeSingle();
  if (error) throw new Error(`oauth_accounts read failed: ${error.message}`);
  return (data as OAuthAccountRow | null) ?? null;
}

export async function listOAuthAccounts(): Promise<OAuthAccountRow[]> {
  const { data, error } = await getSupabase()
    .from("oauth_accounts")
    .select("*")
    .order("mailbox_key");
  if (error) throw new Error(`oauth_accounts list failed: ${error.message}`);
  return (data ?? []) as OAuthAccountRow[];
}

export async function upsertOAuthToken(args: {
  mailboxKey: string;
  email: string;
  refreshToken: string;
  scopes: string[];
}): Promise<void> {
  const { error } = await getSupabase()
    .from("oauth_accounts")
    .upsert(
      {
        mailbox_key: args.mailboxKey,
        email: args.email,
        refresh_token_encrypted: encrypt(args.refreshToken),
        scopes: args.scopes,
        granted_at: new Date().toISOString(),
        last_used_at: null,
        last_error: null,
        revoked_at: null,
      },
      { onConflict: "mailbox_key" },
    );
  if (error) throw new Error(`oauth_accounts upsert failed: ${error.message}`);
}

export async function markOAuthAccountUsed(key: string): Promise<void> {
  await getSupabase()
    .from("oauth_accounts")
    .update({ last_used_at: new Date().toISOString(), last_error: null })
    .eq("mailbox_key", key);
}

export async function markOAuthAccountError(
  key: string,
  message: string,
): Promise<void> {
  await getSupabase()
    .from("oauth_accounts")
    .update({ last_error: message })
    .eq("mailbox_key", key);
}

export async function markOAuthAccountRevoked(key: string): Promise<void> {
  await getSupabase()
    .from("oauth_accounts")
    .update({ revoked_at: new Date().toISOString() })
    .eq("mailbox_key", key);
}
