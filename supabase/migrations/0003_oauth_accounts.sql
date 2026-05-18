-- OAuth pivot: per-mailbox encrypted refresh token storage.
-- mailbox_key matches the typed catalog in src/lib/google/mailboxes.ts
-- (e.g. 'tih-contracts', 'tih-pm'). refresh_token_encrypted is AES-256-GCM
-- ciphertext produced by src/lib/crypto/envelope.ts using
-- OAUTH_TOKEN_ENCRYPTION_KEY. The key never enters Postgres.

create table if not exists oauth_accounts (
  id                      uuid primary key default gen_random_uuid(),
  mailbox_key             text unique not null,
  email                   text not null,
  refresh_token_encrypted text not null,
  scopes                  text[] not null,
  granted_at              timestamptz not null default now(),
  last_used_at            timestamptz,
  last_error              text,
  revoked_at              timestamptz
);
