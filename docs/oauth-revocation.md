# OAuth Token Revocation Playbook

Concise recovery procedure for **suspected token compromise** or **encryption-key loss** in the pm-dashboard-main OAuth bootstrap flow. Full design context: [`CONVERSION_PLAN.md`](./CONVERSION_PLAN.md) §13 and [`OAUTH_PIVOT_PLAN.md`](./OAUTH_PIVOT_PLAN.md).

## Trust model recap

Two trust boundaries protect the refresh tokens:

1. **Ciphertext** in Supabase → `oauth_accounts.refresh_token_encrypted` (AES-256-GCM).
2. **Encryption key** in Vercel env → `OAUTH_TOKEN_ENCRYPTION_KEY` (32 random bytes, base64).

Compromise of either boundary alone yields useless data:
- DB leak without the key → opaque ciphertext.
- Key leak without DB access → nothing to decrypt.

The **strongest** security guarantee isn't the encryption — it's **Google's ability to revoke**. Any refresh token can be invalidated instantly from `myaccount.google.com/permissions` on the affected account. Recovery is bounded; **end-to-end re-bootstrap takes ~5 minutes**.

---

## Scenario A — suspected token leak

You think someone got a refresh token plaintext (e.g., it was logged, screenshotted, pasted into Slack, copied via a breached Supabase service-role key, or stolen from a developer's laptop).

### 1. Revoke at Google immediately

For each affected mailbox:

1. Log into Google as the mailbox owner (e.g., `contracts@tradeinholdings.com`).
2. Open <https://myaccount.google.com/permissions>.
3. Find **PPM-Dashboard** in the list.
4. Click **Remove access** → confirm.

Google immediately invalidates *every* refresh + access token issued to that mailbox for the PPM-Dashboard OAuth client. The leaked token is now dead.

### 2. Mark the row revoked in the DB

The app's auth client checks `oauth_accounts.revoked_at` before attempting to use a token. Setting this prevents accidental retries during the recovery window:

```sql
update oauth_accounts
   set revoked_at = now(),
       last_error = 'revoked at Google due to suspected leak'
 where mailbox_key = 'tih-contracts';  -- or whichever
```

Or use the **Revoke** button on `/admin/oauth`. Either does the same thing.

### 3. Re-bootstrap

1. Visit `http://localhost:3000/admin/oauth` (local) or the Vercel URL.
2. Click **Connect** (or **Reconnect**) on the revoked mailbox.
3. Sign in as the correct account → click through the unverified-app warning → **Allow**.
4. Callback validates the email matches the expected mailbox and writes a fresh encrypted token. `revoked_at` is cleared automatically by the upsert.

### 4. Verify

Hit **Run health check** on the admin page (or `/api/admin/oauth-verify`). Both mailboxes should show `ok: true` with `observedEmail` matching `MAILBOXES[key].email`.

**Total time: ~3 minutes per affected mailbox.**

---

## Scenario B — encryption key lost or rotated

You lost `OAUTH_TOKEN_ENCRYPTION_KEY` (or rotated it without re-encrypting in place). Every stored ciphertext is now unrecoverable.

### Symptoms

- Every API call throws decrypt errors: *"Unsupported state or unable to authenticate data"* or similar GCM-tag-mismatch messages.
- `/api/admin/oauth-verify` returns `failed` for every bootstrapped mailbox.

### Recovery

1. Generate a fresh key:
   ```bash
   openssl rand -base64 32
   ```
2. Set the new value in the affected environment:
   - **Local**: replace `OAUTH_TOKEN_ENCRYPTION_KEY=…` in `.env.local`. Restart the dev server.
   - **Vercel**: `vercel env rm OAUTH_TOKEN_ENCRYPTION_KEY production` then `vercel env add OAUTH_TOKEN_ENCRYPTION_KEY production`. Trigger a redeploy.
3. Wipe the orphaned ciphertext (otherwise re-bootstrap can't insert — the `oauth_accounts.mailbox_key` unique constraint conflicts):
   ```sql
   delete from oauth_accounts;
   ```
4. Re-bootstrap each mailbox via `/admin/oauth` as in Scenario A step 3.

**Total time: ~5 minutes** (most of it spent waiting for Vercel to redeploy with the new env).

### Why this is safe

The previous refresh tokens are not revoked at Google — they're just unreadable to the app. The user who consents during re-bootstrap issues a *new* refresh token that supersedes the old one in app state. The old tokens remain valid at Google's end (you could revoke them in Scenario A's step 1 for paranoia, but they have no value without the encryption key anyway).

---

## Scenario C — wrong account bootstrapped into a slot

E.g., someone clicked Connect on `tih-pm` and accidentally signed in with `bradley@zoodealio.com`. The callback's email check prevents this from being silently accepted — but if a check is bypassed in a future regression, here's the cleanup:

```sql
-- inspect:
select mailbox_key, email, granted_at from oauth_accounts;

-- delete the wrong slot:
delete from oauth_accounts where mailbox_key = 'tih-pm';
```

Then re-bootstrap normally. **Always sign out of the wrong Google account in the browser first** (or use the account chooser) — otherwise Google may auto-select the wrong account again.

---

## Scenario D — Google verification status change

Google has been known to retroactively restrict External-Production apps with Restricted scopes. If `gmail.readonly` or `drive` suddenly stops working for new consents:

- Existing refresh tokens **keep working** (Production-issued tokens don't auto-revoke).
- New bootstraps will fail with a hard verification wall.

Recovery paths in order of effort:

1. **Confirm the change** — check the GCP "Google Auth Platform" page for any new warnings or required actions.
2. **Submit for verification** — only path if you need to add more users. Requires a third-party security assessment (CASA) for Restricted scopes. Weeks-to-months process.
3. **Workaround** — create a new GCP project under the `tradeinholdings.com` Workspace (if accessible), set consent screen to Internal, and re-bootstrap there. Internal apps skip verification entirely.

This is theoretical for now (the OAuth Playground probe in May 2026 confirmed Restricted scopes work fine in External Production for our use case). Documented for future-you.

---

## Routine token health

The `/api/cron/token-health` route runs daily (07:00 UTC per `vercel.ts`). It hits a tiny no-op API on each bootstrapped mailbox and updates `oauth_accounts.last_used_at` / `last_error`. If something silently breaks (Google revokes the app, the key changes, etc.) this fails fast on the *next* day rather than only being noticed when a user tries to sync.

To poll on-demand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     "http://localhost:3000/api/admin/oauth-verify"
```

Output includes per-mailbox `bootstrapped` / `ok` / `error` / `observedEmail`. The dev server doesn't enforce auth on `/admin/*` pages but the verify route requires `CRON_SECRET` so this same curl works against Vercel.
