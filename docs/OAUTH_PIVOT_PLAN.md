# OAuth Pivot — Implementation Plan

> Companion to [`CONVERSION_PLAN.md`](./CONVERSION_PLAN.md). Read this first if you are about to start (or resume) the OAuth pivot work. CONVERSION_PLAN.md still describes the broader rewrite; this doc supersedes its §2 locked decisions 3, 4, and 5 and adds new sections for OAuth bootstrap, Drive folder structure, terminal pipeline states, and PDF-first bid backfill.

**Status:** locked 2026-05-15 grilling. OAuth Playground probe passed (refresh token issued for `pm@tradeinholdings.com` in External + Production mode, unverified app warning bypass available). Path is unblocked — ready to implement.

---

## 1. Why this pivot

The conversion plan locked Service Account + Domain-Wide Delegation as the only backend auth. DWD requires Workspace admin cooperation on `tradeinholdings.com`, which has been blocked for months ([`memory/project_tih_workspace_dwd_followup.md`](../../.claude/projects/-Users-bradleymeyer-Desktop-coding-pm-dashboard-main/memory/project_tih_workspace_dwd_followup.md)). User OAuth with a bootstrap pattern sidesteps that dependency because Bradley has direct logins to the two TIH accounts the app needs to act as (`contracts@`, `pm@`). The wall on OAuth itself — Google's Restricted-scope verification policy — was probed in OAuth Playground on 2026-05-15 and confirmed open via the standard "unverified app" warning bypass.

## 2. Locked decisions (quick reference)

| Area | Decision |
|---|---|
| GCP project | Existing `PPM-Dashboard` (zoodealio.com), do not change Audience or Internal/External settings |
| Consent screen | External + Production. Refresh tokens persist. Unverified — users see one-time "Advanced → Continue" warning per account |
| Scopes — `contracts@tih` | `gmail.readonly` only |
| Scopes — `pm@tih` | `drive` (full), `spreadsheets` |
| Scopes — `accounting@tih` | Dropped from v1 |
| Scopes — `bradley@zoodealio` | Deferred (future login + Gmail write) |
| Token storage | Envelope encryption — ciphertext in Supabase `oauth_accounts`, key in `OAUTH_TOKEN_ENCRYPTION_KEY` Vercel env (separate per environment) |
| Bootstrap UX | `/admin/oauth` page in the app with per-mailbox Connect/Reconnect buttons |
| Drive root | `Properties/` in `pm@tih`'s My Drive |
| Property folder name | Full address (e.g. `8834 Judwin St, Houston TX/`), looked up by ID not name |
| Per-property subfolder | `Docs/` kept (future per-property assets planned outside `Docs/`) |
| Folder creation | Lazy via `ensurePropertyFolder(slug)` |
| Template location | `Properties/_Templates/` under `pm@tih`, file IDs preserved across ownership transfer |
| CMA delivery | Contracts shares CMA Sheet with `pm@tradeinholdings.com`; Gmail Sync detects + proposes copy into `Properties/<addr>/Docs/` |
| Cancellation | Property page button + required reason modal → `stage='cancelled'`, Drive folder auto-moves to `Properties/Cancelled/`. Reversible. |
| Closing | Manual "Mark Closed" button (fast path) + daily cron auto-closes after 2 days in `ready-for-listing`. Drive folder auto-moves to `Properties/Closed/`. |
| Closing-confirmed detection | Dropped from Gmail Sync (Slack-only signal from Joseph). Future Slack integration deferred. |
| Gmail Sync source | All queries run as `contracts@tih` from sent + inbox folders |
| Bid backfill | One-time `scripts/backfill-bids.ts --since=2023-01-01`, PDF-first via `pdf-parse`. Source-split partial uniques in `bids` table. Daily cron handles ongoing. |
| Bradley@ Drive bootstrap | Discarded — `contracts@` Gmail PDF coverage is wider than any single PM's Drive |

## 3. Pre-flight (your manual steps before code starts)

### 3.1 Generate the encryption key

```bash
openssl rand -base64 32
```

Paste output into `.env.local` after `OAUTH_TOKEN_ENCRYPTION_KEY=`. The line is already added with explanatory comments — just paste the value. No quotes. Different value per environment; never reuse the local key in Vercel.

### 3.2 Add the new redirect URI in GCP

GCP Console → `PPM-Dashboard` project → APIs & Services → **Google Auth Platform** → **Clients** → click the Web Application client whose ID matches `GOOGLE_CLIENT_ID` in `.env.local` (starts with `309176418621-`).

Under **Authorized redirect URIs**, add this exact string:
```
http://localhost:3000/api/oauth/callback
```

Save. The Playground URI `https://developers.google.com/oauthplayground` can stay for now.

### 3.3 Confirm Supabase project is the new one

The CONVERSION_PLAN calls for a fresh Supabase project. Confirm `SUPABASE_URL` in `.env.local` points at the new project (not the old `cowork/PPMDashboard` Supabase). Migrations in Task #1 will be applied here.

### 3.4 What you do NOT need to do yet

- Don't bootstrap any mailbox in OAuth Playground — those tokens were probe-only and won't be reused.
- Don't move templates yet — wait until Task #4 hands off.
- Don't touch Vercel env vars — production cutover is the final section.

---

## 4. Task-by-task breakdown

Each task has: scope, files touched, schema/code shape, verification, and any manual steps. Tasks are ordered to keep the app runnable at each checkpoint.

### Task #1 — Schema migrations + encryption helper

**Scope:** All database schema changes the pivot requires + the AES-256-GCM helper used by every refresh-token read/write.

**Files:**
- `supabase/migrations/0002_oauth_accounts.sql` — new
- `supabase/migrations/0003_terminal_states.sql` — new
- `supabase/migrations/0004_bids_source_split.sql` — new
- `supabase/migrations/0005_drive_folder_id.sql` — new
- `src/lib/crypto/envelope.ts` — new

**`0002_oauth_accounts.sql`:**
```sql
create table oauth_accounts (
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
```

**`0003_terminal_states.sql`:**
```sql
alter table properties
  add column stage_changed_at timestamptz not null default now(),
  add column cancelled_at     timestamptz,
  add column cancelled_reason text,
  add column closed_at        timestamptz;

create or replace function set_stage_changed_at() returns trigger as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

create trigger properties_stage_changed_at
  before update on properties
  for each row execute function set_stage_changed_at();
```

**`0004_bids_source_split.sql`:**
```sql
alter table bids drop constraint if exists bids_drive_file_id_tab_name_key;

create unique index bids_sheet_uniq on bids (drive_file_id, tab_name)
  where source = 'sheet';
create unique index bids_gmail_uniq on bids (gmail_message_id, drive_url)
  where source = 'gmail';

alter table bids add column original_drive_url text;
```

**`0005_drive_folder_id.sql`:**
```sql
alter table properties add column drive_folder_id text;
```

**`src/lib/crypto/envelope.ts`:**
```ts
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("encryption key must be 32 bytes");
  return buf;
}

// Format: base64(iv || tag || ciphertext) — single string per token.
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
```

**Verification:** Apply migrations via Supabase CLI or dashboard SQL editor. Confirm tables/columns exist. Write a unit test or quick script that round-trips `encrypt(decrypt(...))`.

---

### Task #2 — Refactor `auth.ts` from JWT/DWD to OAuth2 client

**Scope:** Replace Service Account JWT impersonation with OAuth2-client-with-refresh-token. Mailbox catalog stays as a typed registry but loses DWD semantics.

**Files:**
- `src/lib/google/auth.ts` — rewrite
- `src/lib/google/mailboxes.ts` — trim (`accounting` dropped, scopes per-account)
- `src/lib/db/oauth-accounts.ts` — new repo

**New `auth.ts` shape:**
```ts
import "server-only";
import { google, type gmail_v1, type drive_v3, type sheets_v4 } from "googleapis";
import { getOAuthAccountByMailbox } from "@/lib/db/oauth-accounts";
import { decrypt } from "@/lib/crypto/envelope";
import type { MailboxKey } from "./mailboxes";

async function makeOAuth2Client(mailbox: MailboxKey) {
  const row = await getOAuthAccountByMailbox(mailbox);
  if (!row) throw new Error(`Mailbox '${mailbox}' not bootstrapped — visit /admin/oauth`);
  if (row.revoked_at) throw new Error(`Mailbox '${mailbox}' was revoked`);

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
  client.setCredentials({ refresh_token: decrypt(row.refresh_token_encrypted) });
  return client;
}

export async function getGmailClient(m: MailboxKey): Promise<gmail_v1.Gmail> {
  return google.gmail({ version: "v1", auth: await makeOAuth2Client(m) });
}
// drive + sheets identical shape
```

**`oauth-accounts.ts` repo:**
- `getByMailboxKey(key): Promise<OAuthAccount | null>`
- `upsertToken(key, email, refreshToken, scopes): Promise<void>` — encrypts before write
- `markUsed(key)` — updates `last_used_at`
- `markError(key, error)` — updates `last_error`
- `markRevoked(key)` — sets `revoked_at`

**`mailboxes.ts` final shape:**
```ts
export type MailboxKey = "bradley" | "tih-contracts" | "tih-pm";

export const MAILBOXES = {
  bradley:         { email: "bradley@zoodealio.com",         label: "Bradley",       scopes: [] /* deferred */ },
  "tih-contracts": { email: "contracts@tradeinholdings.com", label: "TIH Contracts", scopes: ["https://www.googleapis.com/auth/gmail.readonly"] },
  "tih-pm":        { email: "pm@tradeinholdings.com",        label: "TIH PM",        scopes: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets"] },
} as const;
```

**Verification:** Existing call sites (`getGmailClient('tih-contracts')` etc.) keep working syntactically. Runtime calls will throw "not bootstrapped" until Task #3 lands — that's expected.

---

### Task #3 — OAuth bootstrap routes + `/admin/oauth` page

**Scope:** Build the UI and routes that actually capture refresh tokens. After this lands, manual handoff (you bootstrap mailboxes via browser).

**Files:**
- `src/app/api/oauth/start/route.ts` — new
- `src/app/api/oauth/callback/route.ts` — new
- `src/app/admin/oauth/page.tsx` — new
- `src/app/api/admin/oauth-verify/route.ts` — new (health check)

**Flow:**
1. User visits `/admin/oauth` — server component reads `oauth_accounts` rows + renders one row per `MailboxKey` with status (`granted_at`, `last_used_at`, scopes, error).
2. Click "Connect tih-pm" → `GET /api/oauth/start?mailbox=tih-pm` → server generates `state` (signed nonce in cookie), builds Google consent URL with `access_type=offline`, `prompt=consent` (forces refresh token issue), `scope=...`, `redirect_uri=GOOGLE_REDIRECT_URI`, `response_type=code`.
3. Google → unverified app warning → click Advanced → Continue → Allow.
4. Google redirects to `GET /api/oauth/callback?code=...&state=...` → verify state cookie → exchange code → confirm `tokens.refresh_token` present + email matches expected mailbox → encrypt → upsert into `oauth_accounts` → redirect to `/admin/oauth?bootstrap=success&mailbox=...`.
5. Page re-renders with "Connected" status.

**Health check:** `/api/admin/oauth-verify` hits a tiny API per mailbox (`gmail.users.getProfile` for tih-contracts; `drive.about.get` for tih-pm) and reports per-mailbox status. Useful for "did anything break?" diagnostics.

**Verification:** After deploying, you (manual step) bootstrap both mailboxes. See §5.1 below.

---

### Task #4 — Drive folder helpers + template move

**Scope:** The Drive utilities that every server action depends on, plus refactoring existing Create-Comps/Bid/Tracker actions to use the new folder structure.

**Files:**
- `src/lib/google/drive.ts` — extend
- `src/lib/services/drive-templating.ts` — refactor
- `src/lib/services/property-pipeline.ts` — extend (folder ID persistence)
- `src/components/property/PropertyDocuments.tsx` — refactor Documents tab

**Helpers added to `drive.ts`:**
- `ensurePropertyFolder(slug: string, address: string): Promise<string>` — looks up `properties.drive_folder_id`; if null, creates `Properties/<address>/` under `pm@tih`'s `Properties/` root, persists ID, returns it. Creates `Properties/` itself if missing on first run.
- `ensureDocsSubfolder(propertyFolderId: string): Promise<string>` — finds or creates `Docs/` inside the property folder.
- `moveFolderToBucket(folderId: string, bucket: "Cancelled" | "Closed"): Promise<void>` — Drive `files.update` with `addParents` / `removeParents`. Creates the bucket folder if missing.
- `listFilesInDocsFolder(propertyFolderId: string)` — replaces `findFilesForAddress` for the Documents tab.

**Refactored Create actions:**
- Each Create-Comps / Bid / Tracker server action now calls `ensurePropertyFolder` → `ensureDocsSubfolder` → `drive.files.copy(templateId, { parents: [docsFolderId], name: `<Artifact> - <address>` })`.
- The previous "search Drive by name to dedupe" logic stays as a fallback inside `Docs/`.

**Manual handoff after this task:** §5.2 — you move templates into `Properties/_Templates/` under `pm@tih`.

**Verification:** Click Create Comps for an existing property → folder structure appears in pm@tih's Drive → Documents tab on the property page lists the new sheet.

---

### Task #5 — Terminal-state lifecycle (Cancel + Close) + auto-close cron

**Scope:** Schema-backed terminal states + UI + cron.

**Files:**
- `src/lib/actions/property-lifecycle.ts` — new server actions
- `src/components/property/CancelZone.tsx` — new
- `src/components/property/CloseButton.tsx` — new
- `src/components/board/Board.tsx` — filter out terminal stages
- `src/app/api/cron/auto-close/route.ts` — new
- `vercel.ts` — register the cron

**Server actions:**
- `cancelProperty(slug: string, reason: string)` — updates `stage='cancelled'`, `cancelled_at`, `cancelled_reason`; moves Drive folder to `Properties/Cancelled/`; appends Activity event; `revalidatePath`.
- `closeProperty(slug: string)` — updates `stage='closed'`, `closed_at`; moves Drive folder to `Properties/Closed/`; appends Activity event.
- `restoreFromCancelled(slug: string, newStage: string)` — clears `stage`, moves Drive folder back to `Properties/`; audit columns persist.

**UI:**
- Property page: red destructive zone at bottom — "Cancel Property" button → confirmation modal with required reason textarea (min 5 chars).
- Property page: "Mark Closed" button visible only when `stage === 'ready-for-listing'`.
- Board: terminal stages hidden from default view; new filter chips for "Cancelled" / "Closed" reveal those rows.

**Cron:**
```ts
// /api/cron/auto-close runs daily
const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const candidates = await supabase.from('properties')
  .select('slug')
  .eq('stage', 'ready-for-listing')
  .lt('stage_changed_at', cutoff.toISOString());
for (const { slug } of candidates.data ?? []) await closeProperty(slug);
```

`vercel.ts` cron entry:
```ts
{ path: '/api/cron/auto-close', schedule: '0 7 * * *' }  // daily 03:00 ET
```

**Verification:** Cancel a test property → DB reflects, Drive folder is under `Properties/Cancelled/`, Activity timeline shows event, Board filters it out. Mark a `ready-for-listing` property as Closed manually → same checks against `Properties/Closed/`.

---

### Task #6 — Gmail Sync query pivot to `contracts@` + CMA detection

**Scope:** Rewrite all sync queries to run as `tih-contracts`, add CMA detector, drop closing detector.

**Files:**
- `src/lib/services/gmail-sync.ts` — rewrite query layer
- `src/components/board/SyncModal.tsx` — render new CMA-copy proposal row

**Query rewrites** (run as `tih-contracts`):

| Signal | Query | Action proposed |
|---|---|---|
| Inspection report | `subject:"Inspection Report Ready" in:sent newer_than:30d` | Add property to `inspection-received` |
| Remodel Bid email | `subject:"Remodel Bid" in:inbox newer_than:30d` | Move property to `exec-final-review` |
| Signed addendum | `from:dse@docusign.net OR from:noreply@hellosign.com "signed" in:inbox newer_than:30d` | Move property to `addendum-sent` |
| **CMA delivered (new)** | `subject:CMA in:sent newer_than:30d` AND body matches `docs.google.com/spreadsheets/d/[A-Za-z0-9_-]+` | Copy CMA Sheet to `Properties/<addr>/Docs/CMA - <addr>` |

**Closing-confirmed detector deleted.** No replacement — manual stage drag for now.

**CMA copy mechanism:**
- Parse first `docs.google.com/spreadsheets/d/<ID>` from body.
- Match property by thread / subject address heuristics.
- Sync modal row: "Copy CMA for `<address>` from `<source URL>`" with Approve / Skip.
- On approve: server action runs as `tih-pm` → `drive.files.copy(sourceId, { parents: [docsFolderId], name: 'CMA - <address>' })` → persists `properties.cma_url`.
- If pm@tih lacks read access on source: modal row shows error "Ask Contracts to share with pm@tradeinholdings.com" + Retry button.

**Verification:** Click Sync → see proposals based on contracts@'s mailbox. Approve an inspection-report-add → property appears in `inspection-received`. Approve a CMA copy (or trigger one manually for a known-good email) → file appears in property's `Docs/` folder.

---

### Task #7 — Bid backfill script + daily cron

**Scope:** One-time historical PDF scrape of `contracts@`'s sent folder + the ongoing cron that handles new bids.

**Files:**
- `scripts/backfill-bids.ts` — new, run via `tsx`
- `src/lib/services/bid-scraper.ts` — new (shared logic for backfill + cron)
- `src/app/api/cron/scrape-bids/route.ts` — new
- `vercel.ts` — register the cron

**Backfill script flow:**
```bash
tsx scripts/backfill-bids.ts --since=2023-01-01 [--dry-run] [--limit=N]
```
1. Query `tih-contracts` Gmail: `in:sent has:attachment newer_than:1095d` (or `after:<since>`).
2. For each message: pull PDF attachments via `gmail.users.messages.attachments.get`. Filter to attachments whose filename matches bid heuristics (`*Remodel Bid*.pdf`, `*Bid*.pdf`).
3. Extract text with `pdf-parse`.
4. Parse line items: regex like `^(.{10,80}?)\s+\$([\d,]+\.\d{2})$` against each PDF line. Footer items (`Final clean`, `Rekey...`, `30 Day Per Diem`) detected by keyword whitelist.
5. Detect address from subject (`Remodel Bid - <address>` pattern) or fallback to body first-line match.
6. Detect total: largest dollar amount on the page, or explicit `Total: $X,XXX` if present.
7. Upsert into `bids` (source='gmail', gmail_message_id, gmail_thread_id, subject, raw_text, total_amount, address_raw, address_street, original_drive_url from body Sheets link if present, bid_year from message date).
8. Upsert into `bid_line_items` for each parsed line.
9. Log result row to `bid_scrape_runs` (files_seen, bids_upserted, items_upserted, errors).

**Idempotency:** `bids_gmail_uniq (gmail_message_id, drive_url)` partial index. Re-runs are safe.

**Dry-run mode:** prints what would be inserted, no DB writes.

**Cron (registered after backfill validates):**
```ts
// /api/cron/scrape-bids — daily 02:00 ET, walks last 30 days
{ path: '/api/cron/scrape-bids', schedule: '0 6 * * *' }
```
Same `bidScraperRun({ since: 30daysAgo })` function call as the script — shared logic.

**Verification:** Dry-run with `--limit=10` first — eyeball the parsed line items against the actual PDF. Iterate the heuristics until samples look right. Then real run with no limit. Final check: open `/bids` page — historical bids appear, full-text search works.

**Manual handoff after this task:** §5.3 — you run the backfill locally.

---

### Task #8 — Update `CONVERSION_PLAN.md` + revocation playbook

**Scope:** Documentation cleanup.

**Files:**
- `docs/CONVERSION_PLAN.md` — edit
- `docs/oauth-revocation.md` — new

**`CONVERSION_PLAN.md` edits:**
- §2 locked decisions: flip 3 (now: OAuth bootstrap, not "none"), 4 (URL still private but `/admin/*` routes get a token check — see §11 below), 5 (multi-mailbox via OAuth, not SA impersonation).
- §7 "Multi-mailbox SA layer" → renamed to "Multi-mailbox OAuth layer," content rewritten.
- §8 env vars: remove `GOOGLE_SERVICE_ACCOUNT_JSON`, add `OAUTH_TOKEN_ENCRYPTION_KEY`, document existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` purpose.
- New §13: Drive folder structure (mirror of this doc's locked decisions).
- New §14: Terminal pipeline states.
- New §15: Bid backfill from Gmail PDFs.
- §11 risks: add "no `/admin/*` gate" — see below.

**`docs/oauth-revocation.md`:**
- If suspected compromise: revoke at https://myaccount.google.com/permissions on the affected TIH account → `markRevoked` in `oauth_accounts` (manual SQL or `/admin/oauth` button) → rotate `OAUTH_TOKEN_ENCRYPTION_KEY` in Vercel → re-bootstrap all mailboxes via `/admin/oauth`.
- Recovery time: ~5 minutes end-to-end.
- Why this matters: Google's revocation is the real security guarantee; encryption is the defense against passive leak.

---

## 5. Manual handoff moments

Three points where my work pauses for you to do something in a browser or terminal. None take more than ~10 minutes.

### 5.1 After Task #3 — bootstrap the two TIH accounts (~3 min)

```bash
npm run dev
```

1. Open `http://localhost:3000/admin/oauth`.
2. You see three rows: `tih-contracts` (Not connected), `tih-pm` (Not connected), `bradley` (Deferred).
3. Click **Connect** on `tih-contracts`. Browser redirects to Google.
4. Sign in as `contracts@tradeinholdings.com`. On the unverified-app warning page, click **Advanced** → **Go to PPM-Dashboard (unsafe)**.
5. Consent screen lists `gmail.readonly`. Click **Allow**. Browser returns to `/admin/oauth` showing `tih-contracts: Connected, granted_at: <timestamp>`.
6. Click **Connect** on `tih-pm`. Sign in as `pm@tradeinholdings.com`. Same warning + Allow flow. Returns showing both rows Connected.
7. Click the **Verify** button on the page (calls `/api/admin/oauth-verify`) → both rows show "OK — last call succeeded."

Leave `bradley` row alone.

### 5.2 After Task #4 — move templates into `Properties/_Templates/` (~5 min)

Goal: file IDs stay the same so `.env.local` values still work.

**Path A (preferred — ownership transfer):**
1. Log into Drive as the template owner (probably your `bradley@zoodealio.com` account).
2. For each of the 3 templates (Comps, Remodel Bid, Project Tracker): right-click → **Share** → enter `pm@tradeinholdings.com` → set as **Editor** → click their name's dropdown → **Transfer ownership** → confirm. Google sends an invite; pm@tih must accept (you can log in as pm@ and accept immediately).
3. After all three transfers settle, log into Drive as `pm@tradeinholdings.com`.
4. Drag the three files from "My Drive" into `My Drive/Properties/_Templates/` (create `Properties/_Templates/` if it doesn't exist).
5. File IDs are preserved. No `.env.local` update needed.

**Path B (fallback — copy, if ownership transfer is blocked between Workspaces):**
1. As pm@tih, share-view each template from its current owner.
2. Open each in Sheets → **File → Make a copy → Destination: Properties/_Templates/**.
3. Copies get new file IDs. Update `.env.local`:
   ```
   DRIVE_TEMPLATE_FILE_ID=<new comps copy ID>
   DRIVE_REMODEL_BID_TEMPLATE_FILE_ID=<new bid copy ID>
   DRIVE_PROJECT_TRACKER_TEMPLATE_FILE_ID=<new tracker copy ID>
   ```
4. Restart `npm run dev` so the new env vars load.

### 5.3 After Task #7 — run the bid backfill (~5–15 min depending on volume)

```bash
tsx scripts/backfill-bids.ts --since=2023-01-01 --dry-run --limit=10
```

Terminal output shows ~10 parsed bid records with their line items. Eyeball the line items against one of the source PDFs (open the Gmail thread by message ID in the output) — verify descriptions and totals roughly match.

If parsing looks broken on a class of bids, tell me what you see and I'll iterate the heuristics. When it looks good:

```bash
tsx scripts/backfill-bids.ts --since=2023-01-01
```

Real run. Idempotent — safe to re-run if anything misbehaves. Final check: `/bids` page shows the new historical rows; full-text search works.

---

## 6. Vercel deployment (after everything works locally)

Don't deploy until §5.1, §5.2, §5.3 all pass.

### 6.1 Generate a separate production encryption key

```bash
openssl rand -base64 32
```

Different value than your local one.

### 6.2 Add Vercel env vars

In Vercel project settings → Environment Variables → Production scope:

| Variable | Value | Sensitive? |
|---|---|---|
| `OAUTH_TOKEN_ENCRYPTION_KEY` | new prod value from §6.1 | ✅ Yes |
| `GOOGLE_CLIENT_ID` | same as local | No |
| `GOOGLE_CLIENT_SECRET` | same as local | ✅ Yes |
| `GOOGLE_REDIRECT_URI` | `https://<your-vercel-url>/api/oauth/callback` | No |
| `SUPABASE_URL` | same as local | No |
| `SUPABASE_SERVICE_ROLE_KEY` | same as local | ✅ Yes |
| `DRIVE_TEMPLATE_FILE_ID` | same as local | No |
| `DRIVE_REMODEL_BID_TEMPLATE_FILE_ID` | same as local | No |
| `DRIVE_PROJECT_TRACKER_TEMPLATE_FILE_ID` | same as local | No |
| `CRON_SECRET` | same as local (or generate new) | ✅ Yes |

Do NOT add `GOOGLE_SERVICE_ACCOUNT_JSON` — fully deprecated post-pivot.

### 6.3 Add the Vercel callback URI to GCP

GCP → Google Auth Platform → Clients → your Web Application client → Authorized redirect URIs → add `https://<your-vercel-url>/api/oauth/callback` → Save.

### 6.4 Deploy and bootstrap production

```bash
git push  # if Vercel auto-deploys from main
```

After deploy, visit `https://<your-vercel-url>/admin/oauth`. **Bootstrap both TIH mailboxes again** — production has its own encryption key, so the local refresh tokens don't decrypt. Same flow as §5.1.

Verify: `/api/admin/oauth-verify` returns OK for both mailboxes.

### 6.5 Sanity-check the Vercel cron

Cron jobs run automatically on Vercel. After 24 hours, check Vercel logs for `/api/cron/auto-close` and `/api/cron/scrape-bids` invocations. If a cron 500s, the `oauth_accounts.last_error` column captures the reason.

---

## 7. Risks + rollback

### 7.1 `/admin/oauth` has no app gate

The CONVERSION_PLAN locked "no app-level auth." That means anyone with the Vercel URL can hit `/admin/oauth` and (re)bootstrap mailboxes. Mitigations:

- The dashboard URL is treated as a shared secret per [`memory/feedback_no_app_gate.md`](../../.claude/projects/-Users-bradleymeyer-Desktop-coding-pm-dashboard-main/memory/feedback_no_app_gate.md).
- A bootstrap action issues a Google consent flow — an attacker can't supply someone else's refresh token without going through Google's auth. The damage they could do: bootstrap *their own* Google account into the slot, which would (a) fail the `email` sanity check in the callback (compare against expected `MAILBOXES[key].email`) and (b) be detectable in `oauth_accounts.email`.
- The callback handler validates the consenting email matches the mailbox catalog. If you try to consent as `random@gmail.com` to the `tih-pm` slot, the callback rejects.

Optional follow-up (post-pivot): gate `/admin/*` routes with a shared `ADMIN_TOKEN` env var + URL query param. Trivial, not in v1.

### 7.2 Token decryption failure breaks every Google call

If `OAUTH_TOKEN_ENCRYPTION_KEY` is lost or accidentally rotated without re-bootstrap, all stored refresh tokens become unrecoverable. Recovery: re-bootstrap all mailboxes via `/admin/oauth`. Same effective process as `oauth-revocation.md`. **~5 minutes downtime**, no data loss.

### 7.3 Verification wall (would have been blocker — already cleared)

The OAuth Playground probe on 2026-05-15 confirmed Google allows Restricted scopes via the "Advanced → Continue" bypass. If Google's policy changes and this stops working: fallback is asking a TIH admin to create an Internal-mode GCP project under `tradeinholdings.com` — smaller ask than DWD, larger than the current path. See [`memory/project_tih_workspace_dwd_followup.md`](../../.claude/projects/-Users-bradleymeyer-Desktop-coding-pm-dashboard-main/memory/project_tih_workspace_dwd_followup.md) for the historical context.

### 7.4 Bid parser misfires

The PDF line-item regex is heuristic. Some historical bids may not parse cleanly. Mitigation:
- `bid_scrape_runs.errors` captures per-message failures with reasons.
- Dry-run mode catches most issues before any DB writes.
- The full PDF text is always stored in `bids.raw_text`, so full-text search works even if structured line items are missing.

### 7.5 Rollback path per task

Each task is committed atomically. To rollback:
- Task #1: drop the four migrations and the encryption helper file. Reverts DB to pre-pivot.
- Task #2: revert `auth.ts` to the JWT/DWD version. Old `GOOGLE_SERVICE_ACCOUNT_JSON` still in `.env.local` makes this work.
- Task #3+: pure additive — rolling back means deleting routes/components.

Hard rollback to DWD if every probe path closes: `git revert` the OAuth-pivot commits, restore `GOOGLE_SERVICE_ACCOUNT_JSON` value in Vercel, escalate the DWD followup ([`memory/project_tih_workspace_dwd_followup.md`](../../.claude/projects/-Users-bradleymeyer-Desktop-coding-pm-dashboard-main/memory/project_tih_workspace_dwd_followup.md)).

---

## 8. Environment variable reference

Final state of `.env.local` after the pivot:

| Variable | Purpose | Set by |
|---|---|---|
| `OAUTH_TOKEN_ENCRYPTION_KEY` | AES-256-GCM key for refresh token encryption | You (Pre-flight §3.1) |
| `GOOGLE_CLIENT_ID` | OAuth client ID, same value across all envs | Already set |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | Already set |
| `GOOGLE_REDIRECT_URI` | Callback URL (different per env) | Already updated |
| `SUPABASE_URL` | DB URL | Already set |
| `SUPABASE_SERVICE_ROLE_KEY` | DB service-role key | Already set |
| `DRIVE_TEMPLATE_FILE_ID` | Comps template file ID | Already set |
| `DRIVE_REMODEL_BID_TEMPLATE_FILE_ID` | Bid template file ID | Already set |
| `DRIVE_PROJECT_TRACKER_TEMPLATE_FILE_ID` | Tracker template file ID | Already set |
| `CRON_SECRET` | Auth header for cron routes | Already set |
| ~~`GOOGLE_SERVICE_ACCOUNT_JSON`~~ | DWD service account | **Remove after Task #2** |

---

## 9. Task list reference

| # | Task | Manual handoff after? |
|---|---|---|
| 1 | Schema migrations + encryption helper | — |
| 2 | Refactor `auth.ts` from JWT/DWD to OAuth2 client | — |
| 3 | OAuth bootstrap routes + `/admin/oauth` page | §5.1 bootstrap both mailboxes |
| 4 | Drive folder helpers + template move | §5.2 move templates |
| 5 | Terminal-state lifecycle + auto-close cron | — |
| 6 | Gmail Sync query pivot to `contracts@` + CMA detection | smoke test |
| 7 | Bid backfill script + daily cron | §5.3 run backfill |
| 8 | Update `CONVERSION_PLAN.md` + revocation playbook | — |

After Task #8: §6 Vercel deployment.

---

**Ready signal:** When you've read through this and want me to proceed, reply "go" and I'll claim Task #1.
