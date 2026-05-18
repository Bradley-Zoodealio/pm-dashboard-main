-- Per-environment oauth tokens. Without this, prod and local share the same
-- oauth_accounts row by mailbox_key, but each environment encrypts with a
-- different OAUTH_TOKEN_ENCRYPTION_KEY — so whichever environment wrote last
-- is the only one that can decrypt. Splitting on (environment, mailbox_key)
-- lets each env hold its own row encrypted with its own key.
--
-- Existing rows get environment='local' since they were created during local
-- bootstrap. Prod will then start with no rows and require its own bootstrap;
-- local keeps working uninterrupted.

alter table oauth_accounts
  drop constraint if exists oauth_accounts_mailbox_key_key;

alter table oauth_accounts
  add column if not exists environment text not null default 'local';

create unique index if not exists oauth_accounts_env_mailbox_uniq
  on oauth_accounts (environment, mailbox_key);

-- Drop the default once existing rows have been backfilled — going forward
-- the application layer always sets environment explicitly via currentEnvironment().
alter table oauth_accounts alter column environment drop default;
