# PPM Dashboard — Conversion Plan

Clean rewrite of `../../cowork/PPMDashboard` into this Next.js 16 project. Source decisions captured during the 2026-05-14 grilling session.

> **Status (2026-05-18):** post-OAuth pivot. Tasks #1–#7 from [`OAUTH_PIVOT_PLAN.md`](./OAUTH_PIVOT_PLAN.md) are complete. The pivot reversed locked decisions 3, 4, and 5 in §2 below — those rows are annotated. New sections **§13–§16** describe the OAuth bootstrap, Drive folder structure, terminal pipeline states, and Gmail-PDF bid backfill that the pivot added. See [`oauth-revocation.md`](./oauth-revocation.md) for the token revocation playbook.

---

## 1. Goal

Replace the accreted (HTML → JS → Supabase → Google Cloud → Next.js) old app with a from-scratch rewrite on proper layered standards:

- **All TypeScript**, all inside one Next.js app. No standalone JS/HTML/Python.
- **Postgres (Supabase) is the source of truth** for both property pipeline state and the bid library. `TASKS.md` is no longer a served data source.
- ~~**Service Account + Workspace Domain-Wide Delegation** is the only backend auth.~~ **Replaced by user OAuth (2026-05-15)** — see §13. The app holds AES-256-GCM-encrypted refresh tokens for `contracts@tradeinholdings.com` and `pm@tradeinholdings.com` and acts as those accounts directly. No DWD step.
- **Layered code**: route handlers → services → (Google clients | DB repos). Each layer has one job; nothing reaches across.

## 2. Locked decisions

| # | Decision | Resolution |
|---|---|---|
| 1 | Property data source | Postgres in Supabase (no served `TASKS.md`) |
| 2 | DB choice | New Supabase project (already provisioned) |
| 3 | ~~App user auth~~ **Server-side OAuth bootstrap** | **Reversed 2026-05-15** — see §13. Encrypted refresh tokens for `tih-contracts` + `tih-pm` stored in Supabase. No user login flow. |
| 4 | App gating | None for the board; `/admin/*` and `/api/cron/*` protected by `CRON_SECRET` Bearer auth. URL still treated as a shared secret. |
| 5 | ~~Multi-mailbox via SA~~ **Multi-mailbox via OAuth bootstrap** | **Reversed 2026-05-15** — `MAILBOXES` is now a typed registry of OAuth-bootstrapped identities; each mailbox has its own encrypted refresh token. |
| 6 | ~~TIH DWD setup~~ | **Abandoned 2026-05-15** — the OAuth pivot removes the need entirely. |
| 7 | Scope | All 12 surfaces port; `memory/` carries as dev-context files (not in UI) |
| 8 | Module layout | Standard Next.js: `src/app/`, `src/components/`, `src/lib/{google,db,services}` |
| 9 | Mutations | Server Actions for UI; API routes for crons + external triggers |
| 10 | UI library | shadcn/ui only; drop `@base-ui/react` |
| 11 | Cutover | Hard cutover: parity build → one-shot `TASKS.md` migration → bid-scraper backfill → switch over → archive old repo |
| 12 | Realtime | None on Day 1; refresh-on-focus + explicit Refresh button |
| 13 | Cron config | `vercel.ts` (replaces `vercel.json`) |
| 14 | DnD library | `@dnd-kit` |
| 15 | Client state | Plain React + Server Actions; no TanStack/SWR |
| 16 | Drive template file IDs | Env vars (same as today) |
| 17 | Multi-mailbox config | Typed const in `src/lib/google/mailboxes.ts` |

## 3. Target file layout

```
pm-dashboard-main/
├── docs/
│   └── CONVERSION_PLAN.md         (this file)
├── memory/                         (dev-context, not exposed in UI)
├── public/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                Board (default view; all stages)
│   │   ├── properties/
│   │   │   └── [slug]/page.tsx     Property detail
│   │   ├── bids/
│   │   │   └── page.tsx            Bid Library search
│   │   └── api/
│   │       ├── properties/
│   │       │   ├── route.ts        GET (list), POST (create)
│   │       │   └── [slug]/
│   │       │       ├── route.ts
│   │       │       ├── field/route.ts
│   │       │       ├── activity/route.ts
│   │       │       ├── documents/route.ts
│   │       │       ├── comps/route.ts
│   │       │       ├── remodel-bid/route.ts
│   │       │       ├── remodel-bid/lines/route.ts
│   │       │       └── project-tracker/route.ts
│   │       ├── bids/route.ts
│   │       ├── bid-line-items/route.ts
│   │       ├── sync/gmail/route.ts
│   │       ├── sync/gmail/verify/route.ts
│   │       ├── admin/scrape-bids/route.ts
│   │       ├── admin/mailbox-verify/route.ts   (new — sanity check DWD)
│   │       └── cron/
│   │           ├── gmail-sync/route.ts
│   │           ├── scrape-bids/route.ts
│   │           └── token-health/route.ts
│   ├── components/
│   │   ├── ui/                     shadcn primitives (keep current)
│   │   ├── board/                  Board, Column, PropertyCard, FilterBar, SyncButton
│   │   ├── property/               PropertyHeader, InlineEdit, Activity, Documents, OfferScenarios, BidLibrary, ListItem
│   │   ├── bid-library/            search UI for /bids
│   │   └── common/                 Modal, AssigneePicker
│   └── lib/
│       ├── google/
│       │   ├── auth.ts             SA + DWD client factory; impersonate(mailbox) helper
│       │   ├── mailboxes.ts        typed Mailbox catalog
│       │   ├── gmail.ts            list / get / extract attachments
│       │   ├── drive.ts            copy template, rename, listByName, fetchPdf
│       │   └── sheets.ts           read/write line items
│       ├── db/
│       │   ├── supabase.ts         server-only client (service role)
│       │   ├── properties.ts       repo: list, get, update, updateField, move stage
│       │   ├── property-notes.ts   repo: append/list per-property notes
│       │   └── bids.ts             repo: search, upsert, with bid_line_items
│       ├── services/
│       │   ├── gmail-sync.ts       scan → propose diff → apply
│       │   ├── bid-scraper.ts      walk Drive → extract → upsert
│       │   ├── property-pipeline.ts move stage, field updates with side effects
│       │   ├── drive-templating.ts copy + rename + persist URL
│       │   └── offer-math.ts       pure calculation, no I/O
│       ├── address.ts              slugify, parse, normalize
│       └── utils.ts                cn() etc.
├── supabase/
│   └── migrations/
│       ├── 0001_init.sql           properties + property_notes + bids + bid_line_items + bid_scrape_runs
│       └── (further migrations as needed)
├── scripts/
│   └── migrate-tasks-md.ts         one-shot: parse old TASKS.md → insert into properties
├── vercel.ts                       crons + function configs (replaces vercel.json)
├── package.json
├── tsconfig.json
├── next.config.ts
└── CLAUDE.md / AGENTS.md           (already in repo)
```

## 4. Module-by-module port mapping

| Old (PPMDashboard) | New (pm-dashboard-main) | Notes |
|---|---|---|
| `lib/tasks.ts` (parsing TASKS.md) | `scripts/migrate-tasks-md.ts` (one-shot) | The parser still exists, but only as a migration tool. App code never parses markdown. |
| `lib/storage.ts` (TASKS.md ⇄ KV) | **DELETED** | Properties live in Postgres. No KV. |
| `lib/supabase.ts` + `lib/supabase-bids.ts` | `src/lib/db/supabase.ts` + `src/lib/db/bids.ts` | Service-role client, server-only. Repo functions return typed rows. |
| `lib/gmail.ts` + `lib/gmail-sync.ts` + `lib/gmail-bid-scanner.ts` | `src/lib/google/gmail.ts` + `src/lib/services/gmail-sync.ts` + `src/lib/services/bid-scraper.ts` | Split thin client (google/gmail.ts) from business logic (services/*) |
| `lib/google-drive.ts` + `lib/drive-scraper.ts` | `src/lib/google/drive.ts` + `src/lib/services/bid-scraper.ts` | Drive scraping is a service, not a low-level helper |
| `lib/sheets.ts` | `src/lib/google/sheets.ts` | Thin wrapper; no business logic |
| `lib/pdf-extract.ts` | `src/lib/google/drive.ts` (extract helpers) | Stays npm `pdf-parse`-based |
| `lib/offer-math.ts` | `src/lib/services/offer-math.ts` | Pure functions |
| `app/api/properties/[slug]/route.ts` | `src/app/api/properties/[slug]/route.ts` | Thin: parse → call `db/properties` repo → return |
| `app/api/sync/gmail/route.ts` | same | Calls `services/gmail-sync.ts` |
| `app/api/cron/*/route.ts` (×3) | same; `vercel.ts` registers schedules | `CRON_SECRET` verification stays |
| `app/properties/[slug]/PropertyClient.tsx` | broken up into focused components under `components/property/` | Inline edits switch to Server Actions |
| `components/Board.tsx` / `Column.tsx` / `TaskCard.tsx` | `components/board/*` | DnD switches to `@dnd-kit` |
| `components/CalendarView.tsx` / `ListView.tsx` / `PipelineView.tsx` | same | Carried over; still inside `components/board/` |
| `components/AssigneePicker.tsx` / `Modal.tsx` / `InlineEdit.tsx` | `components/common/*` | Inline edits call server actions |
| `components/PropertyDocuments.tsx` / `PropertyActivity.tsx` / `OfferScenarios.tsx` / `BidLibrary.tsx` | `components/property/*` | Server components where possible |
| `components/SyncButton.tsx` + Gmail sync modal | `components/board/SyncButton.tsx` | Calls server action; renders proposed diff |

## 5. Database schema (new Supabase, all migrations from scratch)

`supabase/migrations/0001_init.sql`:

```sql
create extension if not exists "pgcrypto";
create extension if not exists pg_trgm;

-- ── Property pipeline ────────────────────────────────────────────────────────

create table properties (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,                  -- slug(address)
  address         text not null,
  stage           text not null,                          -- inspection-received | inspection-under-review | exec-final-review | addendum-sent | contract-work | ready-for-listing | (open for new)
  purchase_cents  bigint,                                 -- nullable for "TBD"
  clr_cents       bigint,
  reserve_pct     numeric(5,2),
  inspect_date    date,
  assignee        text,                                   -- 'Bradley' | 'Ethan' | 'Colton' | 'Chris' | 'Christina' | 'Unassigned'
  inspect_url     text,
  redfin_url      text,
  cma_url         text,
  comps_url       text,
  questionnaire_url text,
  remodel_bid_url text,
  project_tracker_url text,
  arv_cents       bigint,
  est_repair_cents bigint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on properties (stage);
create index on properties (assignee);
create index on properties (inspect_date);

create table property_notes (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  body          text not null,
  checked       boolean not null default false,
  position      int not null default 0,
  created_at    timestamptz not null default now()
);

create index on property_notes (property_id, position);

-- ── Historical bid library (lifted from old 0001+0002, consolidated) ─────────

create table bids (
  id              uuid primary key default gen_random_uuid(),
  drive_file_id   text not null,
  tab_name        text not null,
  address_raw     text,
  address_street  text,
  bid_year        int,
  total_amount    numeric,
  drive_url       text not null,
  modified_at     timestamptz,
  scraped_at      timestamptz not null default now(),
  source          text not null default 'sheet',
  source_account  text,
  authored_by     text,
  raw_text        text,
  gmail_message_id text,
  gmail_thread_id text,
  subject         text,
  unique (drive_file_id, tab_name)
);

create index on bids (address_street);
create index on bids (bid_year);
create index on bids (source);
create index on bids (authored_by);
create index on bids (modified_at desc);
create index on bids using gin (raw_text gin_trgm_ops);

create table bid_line_items (
  id            uuid primary key default gen_random_uuid(),
  bid_id        uuid not null references bids(id) on delete cascade,
  position      int not null,
  description   text not null,
  total         numeric,
  is_footer     boolean not null default false
);

create index on bid_line_items (bid_id);
create index on bid_line_items using gin (description gin_trgm_ops);

create table bid_scrape_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  files_seen      int not null default 0,
  bids_upserted   int not null default 0,
  items_upserted  int not null default 0,
  errors          jsonb not null default '[]'::jsonb
);

create index on bid_scrape_runs (started_at desc);

create or replace view bid_preferred as
select distinct on (coalesce(address_street, address_raw)) *
from bids
where address_raw is not null
order by
  coalesce(address_street, address_raw),
  case when authored_by ilike any (array['%jason%', '%kala%', '%eliot%']) then 0 else 1 end,
  modified_at desc nulls last;
```

Money is stored as `bigint cents` to avoid float drift; expose dollars only at the edges.

## 6. Data migration plan (one-shot)

`scripts/migrate-tasks-md.ts`:

1. Reads `../cowork/PPMDashboard/TASKS.md` (or path passed as `--source`).
2. Reuses the old `parseTaskMarkdown` logic (copied as a one-time utility — not part of `src/lib/`).
3. For each task:
   - `slug = slugify(title)`.
   - Map section name → `stage` id.
   - Parse the inline `key: value | …` note string into typed columns.
   - Convert dollar strings (`"$330,000"`, `"TBD"`, `"$0"`) → `bigint cents` or `null`.
   - Insert into `properties`. Subtasks → `property_notes` rows in order.
4. `--dry-run` flag prints a diff without writing.
5. `--reset` flag truncates `properties` + `property_notes` before insert.
6. Exits non-zero on parse error per row; logs which rows failed.

Run order on cutover:
1. Apply `0001_init.sql` to new Supabase.
2. `tsx scripts/migrate-tasks-md.ts --source ../cowork/PPMDashboard/TASKS.md --dry-run` → review.
3. Real run.
4. Hit `/api/admin/scrape-bids` to backfill the bid library from Drive.
5. Spot-check property pages.
6. Done.

## 7. Multi-mailbox OAuth layer (reversed from SA+DWD on 2026-05-15)

`src/lib/google/mailboxes.ts` is now a typed registry of identities the app acts as via stored refresh tokens. No `domain` field — there's no longer a per-domain auth boundary.

```ts
export type MailboxKey = "bradley" | "tih-contracts" | "tih-pm";

export const MAILBOXES: Record<MailboxKey, {
  email: string;
  label: string;
  purposes: ReadonlyArray<MailboxPurpose>;
  scopes: ReadonlyArray<string>;
}> = {
  bradley:         { email: "bradley@zoodealio.com",         label: "Bradley",       purposes: ["personal-thread"],                                          scopes: [] /* deferred — future login + Gmail write */ },
  "tih-contracts": { email: "contracts@tradeinholdings.com", label: "TIH Contracts", purposes: ["inspection-reports","status-updates","bid-attachments"],   scopes: ["https://www.googleapis.com/auth/gmail.readonly"] },
  "tih-pm":        { email: "pm@tradeinholdings.com",        label: "TIH PM",        purposes: ["drive-operations"],                                         scopes: ["https://www.googleapis.com/auth/drive","https://www.googleapis.com/auth/spreadsheets"] },
};
```

`src/lib/google/auth.ts` exposes async client factories — they look up the encrypted refresh token, decrypt it, and hand it to a `google.auth.OAuth2` client:

```ts
export async function getGmailClient(mailbox: MailboxKey):  Promise<gmail_v1.Gmail>  { … }
export async function getDriveClient(mailbox: MailboxKey):  Promise<drive_v3.Drive>  { … }
export async function getSheetsClient(mailbox: MailboxKey): Promise<sheets_v4.Sheets>{ … }
```

These are async (they hit Supabase). All call sites in `src/lib/google/gmail.ts`, `drive.ts`, `sheets.ts` use `await`.

**Token lifecycle:**
- Bootstrap once per mailbox at `/admin/oauth`. Refresh tokens issued by Google in Production mode don't expire.
- Tokens persist in `oauth_accounts.refresh_token_encrypted` (AES-256-GCM, key in `OAUTH_TOKEN_ENCRYPTION_KEY` env var — separate value per environment, never stored in Supabase).
- Access tokens refresh in-memory per request via `googleapis`' built-in handling.
- `/api/admin/oauth-verify` health-checks each mailbox by hitting `gmail.users.getProfile` or `drive.about.get` and updates `last_used_at` / `last_error`.

**`bradley` is intentionally not bootstrapped in v1.** Empty `scopes: []` means the auth client throws if anything tries to use it. Reserved for a future personal-login flow.

Cron defaults:
- `cron/gmail-sync` → runs as `tih-contracts` (inspection emails arrive in its inbox; query `subject:"Inspection Report Ready" newer_than:Nd` — no sender filter, since the actual sender is Inspectify).
- Drive helpers default to `tih-pm` — all Drive copies, folder creation, and template ops run as pm@.

The historical follow-up to set up DWD on `tradeinholdings.com` is **abandoned** ([`memory/project_tih_workspace_dwd_followup.md`](../../../.claude/projects/-Users-bradleymeyer-Desktop-coding-pm-dashboard-main/memory/project_tih_workspace_dwd_followup.md)). The OAuth pivot removes that dependency entirely.

## 8. Environment variables (post-OAuth-pivot)

| Key | Purpose |
|---|---|
| `OAUTH_TOKEN_ENCRYPTION_KEY` | 32 bytes (base64) for AES-256-GCM encryption of refresh tokens. Generate with `openssl rand -base64 32`. **Different value per environment** — losing it requires re-bootstrap (~5 min). |
| `GOOGLE_CLIENT_ID` | OAuth client ID from the GCP `PPM-Dashboard` project. Shared across environments. |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret. Sensitive. |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/api/oauth/callback` locally; `https://<vercel-url>/api/oauth/callback` in prod. Must match a URI registered on the OAuth client. |
| `DRIVE_TEMPLATE_FILE_ID` | Comps template (file owned by `pm@`, lives in `Properties/_Templates/`) |
| `DRIVE_REMODEL_BID_TEMPLATE_FILE_ID` | Remodel Bid template (same location) |
| `DRIVE_PROJECT_TRACKER_TEMPLATE_FILE_ID` | Project Tracker template (same location) |
| `SUPABASE_URL` | DB URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only DB key |
| `CRON_SECRET` | Bearer header for `/api/cron/*` + `/api/admin/*` routes. Generate with `openssl rand -hex 32`. |
| ~~`GOOGLE_SERVICE_ACCOUNT_JSON`~~ | **Removed 2026-05-15** — the OAuth pivot eliminates the SA. Can be deleted from `.env.local` and Vercel. |
| ~~`GOOGLE_IMPERSONATE_EMAIL`~~ | **Removed.** Replaced by `MAILBOXES` constant. |
| ~~`KV_REST_API_URL` / `KV_REST_API_TOKEN`~~ | **Removed.** No KV. |
| ~~`SUPABASE_ANON_KEY`~~ | **Removed.** Server-only access. |

## 9. Cron schedule (`vercel.ts`)

```ts
import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    { path: "/api/cron/gmail-sync",   schedule: "0 8 * * *" },  // daily 08:00 UTC
    { path: "/api/cron/scrape-bids",  schedule: "0 2 * * *" },  // daily 02:00 UTC (deferred — see §15)
    { path: "/api/cron/token-health", schedule: "0 9 * * *" },  // daily — hits getProfile/about for each bootstrapped mailbox
    { path: "/api/cron/auto-close",   schedule: "0 7 * * *" },  // daily — auto-closes ready-for-listing after 2 days idle
  ],
  functions: {
    "app/api/cron/scrape-bids/route.ts":  { maxDuration: 300 },
    "app/api/admin/scrape-bids/route.ts": { maxDuration: 300 },
  },
};
```

The gmail-sync cron route also accepts query params `?sinceDays=N` and `?dry=true` for bulk historical sweeps via curl.

## 10. Implementation phases

The work is staged so each phase ends with something runnable.

**Phase 0 — Foundation (1 PR)**
- Drop `@base-ui/react`. Confirm shadcn primitives are usable.
- Add deps: `googleapis`, `@supabase/supabase-js`, `pdf-parse`, `@dnd-kit/core`, `@dnd-kit/sortable`, `date-fns`, `zod`, `tsx` (dev).
- Add `vercel.ts`.
- Wire `src/lib/google/auth.ts` + `mailboxes.ts` + `getGmailClient` smoke test.
- Apply Supabase migration 0001 to the new project.

**Phase 1 — Properties read path**
- `src/lib/db/supabase.ts` + `src/lib/db/properties.ts`.
- `scripts/migrate-tasks-md.ts` (run against TASKS.md, populate `properties`).
- `src/app/page.tsx` (Board) renders properties from Postgres.
- `src/app/properties/[slug]/page.tsx` (detail) renders from Postgres.
- Stage labels, assignee labels, countdown all working as read-only.

**Phase 2 — Properties write path**
- Server actions for inline-edit fields, move stage, add note.
- `@dnd-kit` drag-to-stage on Board.
- `revalidatePath` after each action.

**Phase 3 — Drive integration**
- `src/lib/google/drive.ts`.
- Server actions: Create Comps Sheet, Create Remodel Bid, Create Project Tracker.
- Documents auto-list per address.

**Phase 4 — Gmail sync**
- `src/lib/google/gmail.ts`.
- `src/lib/services/gmail-sync.ts` — propose diff.
- `src/app/api/sync/gmail/route.ts` — preview endpoint.
- Server action for "apply diff".
- Activity timeline component (server-component, reads thread on demand).

**Phase 5 — Bid library**
- `src/lib/services/bid-scraper.ts` (Drive walker + PDF extract).
- `/bids` page with full-text search over `bids.raw_text`.
- Fill from JSON button on property page.

**Phase 6 — Crons + Offer Scenarios + polish**
- Three cron routes with `CRON_SECRET` verification.
- Offer Scenarios calculator (pure math + small form).
- `/api/admin/mailbox-verify` route — health check before TIH DWD walkthrough.

**Phase 7 — Cutover**
- Final dry-run of `migrate-tasks-md.ts`.
- Real run.
- Trigger one `/api/admin/scrape-bids` to seed bid library.
- Move `cowork/PPMDashboard` → `cowork/_archive/PPMDashboard-2026-05`.
- Update local bookmarks / launch scripts to point at the new app.

**Post-conversion follow-up (separate session)**
- Walk through TIH Workspace DWD setup. See [memory/project_tih_workspace_dwd_followup.md](../../../.claude/projects/-Users-bradleymeyer-Desktop-coding-pm-dashboard-main/memory/project_tih_workspace_dwd_followup.md).

## 11. Known risks (current)

1. **No board-level app gate** — the deployed URL has full Gmail-read / Drive-write powers via the stored refresh tokens. Treat the URL as a shared secret ([`memory/feedback_no_app_gate.md`](../../../.claude/projects/-Users-bradleymeyer-Desktop-coding-pm-dashboard-main/memory/feedback_no_app_gate.md)). The `/admin/oauth` page lets anyone with the URL trigger a (re)bootstrap, but the OAuth callback validates that the consenting email matches the expected mailbox before storing — an attacker can't bootstrap a wrong account into a slot.
2. ~~TIH DWD not yet configured~~ — **Resolved.** The OAuth pivot removes this dependency. See [`memory/project_tih_workspace_dwd_followup.md`](../../../.claude/projects/-Users-bradleymeyer-Desktop-coding-pm-dashboard-main/memory/project_tih_workspace_dwd_followup.md).
3. **Encryption key loss** — losing `OAUTH_TOKEN_ENCRYPTION_KEY` makes the stored refresh tokens unrecoverable. Recovery is bounded: re-bootstrap each mailbox via `/admin/oauth` (~5 min total). The Vercel env var is the single source of truth; back it up out-of-band if desired.
4. **PDF/Turbopack incompatibility** — `pdfjs-dist` (used by `pdf-parse`) doesn't run inside Next.js's Turbopack-bundled server routes because its fake-worker setup rewrites paths. The Gmail-PDF bid backfill therefore runs as a **standalone tsx script** (`scripts/backfill-bids.ts`) rather than an admin route. The `/api/cron/scrape-bids` route still exists but points at the legacy Drive walker — wiring it to the new logic is deferred. See §15.
5. **Inspection-email body parser is format-strict** — `extractField()` expects `*Label:* value` (markdown-asterisk format). Older inspection emails without that format add as `inspection-received` with an address slug only; manual fill-in required.
6. **Address parsing edge case** — at least one gmail-sync candidate has been observed with the slug literally `"address"` (the parser picked up the word). Flagged for a future cleanup; not auto-applied to the board.

## 12. Open items

- ~~Confirm full list of mailboxes~~ — settled: `bradley` (deferred), `tih-contracts`, `tih-pm`. `accounting@tih` was dropped.
- ~~Confirm `est_repair` migration source~~ — `est_repair_cents` column shipped; filled per-property via the property page UI.
- ~~Keep the local `Inspection Reports/` folder~~ — yes, gitignored.
- **`/api/cron/scrape-bids` rewrite** — currently uses the legacy Drive walker. Should be re-pointed at the Gmail-PDF backfill logic once we either (a) externalize `pdfjs-dist` from Turbopack reliably or (b) switch to a different PDF parser that doesn't need workers.
- **Slack integration for closing detection** — closings happen in `#acq-dis-properties`, not email. A `/api/slack/events` endpoint that listens for Joseph's "officially closed on X" posts is a clean follow-on once we're ready to deal with another OAuth flow.

---

## 13. OAuth bootstrap (added 2026-05-15)

Replaces what was originally §3 of the locked decisions ("None. SA + DWD only"). Full design doc: [`OAUTH_PIVOT_PLAN.md`](./OAUTH_PIVOT_PLAN.md). Revocation procedure: [`oauth-revocation.md`](./oauth-revocation.md).

**GCP setup (External Production, unverified):**
- Single `PPM-Dashboard` GCP project owned by Zoodealio.
- OAuth consent screen: **External + Production**. Restricted scopes (`gmail.readonly`, `drive`) are accessible via the "unverified app → Advanced → Continue" warning bypass. No CASA verification needed.
- Authorized redirect URIs include `http://localhost:3000/api/oauth/callback` and the Vercel URL's callback path.

**Bootstrap UX (`/admin/oauth`):**
- Server component lists each `MailboxKey` with status — bootstrapped / not-connected / deferred / revoked, plus `granted_at` / `last_used_at` / scopes / last error.
- "Connect" buttons hit `/api/oauth/start?mailbox=<key>` which:
  1. Builds a state token = `<random>:<mailbox-key>`, sets it as an HttpOnly cookie (10-min TTL).
  2. Redirects to Google's consent URL with `access_type=offline`, `prompt=consent`, the mailbox's scopes, and `login_hint=<email>`.
- `/api/oauth/callback` verifies state, exchanges the code, **confirms the consenting email matches the expected mailbox** via the granted scope's identity API (Gmail uses `users.getProfile`, Drive uses `about.get`), then writes the encrypted token + scopes to `oauth_accounts`.

**Token storage schema** (`supabase/migrations/0003_oauth_accounts.sql`):
```sql
create table oauth_accounts (
  id                      uuid primary key default gen_random_uuid(),
  mailbox_key             text unique not null,
  email                   text not null,
  refresh_token_encrypted text not null,  -- AES-256-GCM via src/lib/crypto/envelope.ts
  scopes                  text[] not null,
  granted_at              timestamptz not null default now(),
  last_used_at            timestamptz,
  last_error              text,
  revoked_at              timestamptz
);
```

**Encryption helper (`src/lib/crypto/envelope.ts`):** AES-256-GCM, 12-byte IV, 16-byte tag, payload format is base64(iv || tag || ciphertext). Round-trip tested.

## 14. Drive folder structure (added 2026-05-15)

`pm@tradeinholdings.com`'s My Drive holds everything the app creates:

```
Properties/
├── _Templates/                          ← 3 templates owned by pm@; DRIVE_*_TEMPLATE_FILE_ID env vars point here
│   ├── Comps/Inspection Report - Template
│   ├── Remodel Bid - Template
│   └── Project Tracker - Template
├── 8834 Judwin St, Houston TX 77075/    ← per-property folder, full address as name
│   └── Docs/                            ← app-generated artifacts go here
│       ├── Comps - 8834 Judwin St, ...
│       ├── Remodel Bid - 8834 Judwin St, ...
│       ├── Project Tracker - 8834 Judwin St, ...
│       └── CMA - 8834 Judwin St, ...    ← when copied via Gmail Sync v2's CMA detection
├── Cancelled/   ← Drive folders auto-move here on cancelProperty()
└── Closed/      ← Drive folders auto-move here on closeProperty()
```

- **Lookup is by `properties.drive_folder_id`**, not by name — renames in Drive don't break the link.
- **Lazy creation** via `ensurePropertyFolder(slug)` in `src/lib/google/drive.ts` — runs the first time any Drive op touches a property.
- **`Properties/` root** and bucket folders (`_Templates/`, `Cancelled/`, `Closed/`) are auto-created on first use; their IDs are cached in-process.
- **`copyTemplate(templateId, name, destinationFolderId)`** in `drive.ts` copies into `Properties/<addr>/Docs/` as pm@.
- **CMA copy:** Gmail Sync v2 detects emails with `subject:CMA` from contracts@ that contain a `docs.google.com/spreadsheets` URL. On approval, `copyCmaToPropertyDocs(slug, sourceUrl)` in `src/lib/services/cma-copy.ts` copies the Sheet into the property's Docs folder. Requires the source sheet to be shared with `pm@`; if not, the sync modal surfaces a clear error.

## 15. Terminal pipeline states (added 2026-05-15)

The pipeline now has terminal states beyond `ready-for-listing`:

```sql
-- 0004_terminal_states.sql adds:
stage_changed_at timestamptz not null default now(),
cancelled_at     timestamptz,
cancelled_reason text,
closed_at        timestamptz,
```

Plus a trigger `properties_set_stage_changed_at` that bumps `stage_changed_at` whenever `stage` changes (NOT when other fields change — important for the auto-close cron).

**Stage IDs:**
- Pipeline: `inspection-received` < `inspection-under-review` < `exec-final-review` < `addendum-sent` < `title` < `contract-work` < `ready-for-listing`
- Terminal: `cancelled`, `closed`

**Lifecycle actions** (`src/lib/services/property-lifecycle.ts`):
- `cancelPropertyService({slug, reason})` — requires reason ≥ 5 chars; sets stage + cancelled_at + cancelled_reason; moves Drive folder to `Properties/Cancelled/`. Reversible via `restoreFromTerminalService` (audit columns persist).
- `closePropertyService(slug)` — sets stage + closed_at; moves Drive folder to `Properties/Closed/`.
- `findAutoCloseCandidates(cutoff)` — used by the auto-close cron; selects `ready-for-listing` rows where `stage_changed_at < now - 2 days`.

**UI** (`src/components/property/PropertyLifecycle.tsx`):
- Red destructive "Lifecycle" section at the bottom of the property page.
- "Mark Closed" button visible only on `ready-for-listing` rows.
- "Cancel Property" form with required reason textarea.
- For terminal-state rows: a "Restore to" selector lists pipeline stages.

**xlsx sync stage mapping** (Acquisition Escrows Status col A + AM/AN/AO progression — see [`OAUTH_PIVOT_PLAN.md`](./OAUTH_PIVOT_PLAN.md) follow-up notes):
- Status="Inspection Period": AO=Yes → addendum-sent; AN=Yes → exec-final-review; AM=Yes + assignee → inspection-under-review; else inspection-received.
- Status="Inspect Add Sent" → addendum-sent.
- Status ∈ {Need Funding, Funding On Hold, Closing/No Reno, Closing/Reno} → title.
- Listings sheet col A: Sold → closed, Reno In Process / Late Checkout / etc. → contract-work, Active / Under Contract / Waiting to Relist → ready-for-listing.

## 16. Bid backfill from Gmail PDFs (added 2026-05-15)

`scripts/backfill-bids.ts` — self-contained tsx script (runs outside Next.js so it bypasses the Turbopack/pdfjs worker resolution issue). Walks `contracts@`'s Gmail with `remodel bid after:YYYY/MM/DD`, extracts PDF attachments, parses with `pdf-parse` v2, extracts Sheets URLs from message bodies (as a secondary source), and upserts to `bids` + `bid_line_items`.

**Schema deltas** (`0005_bids_source_split.sql`):
- Drops the original `unique (drive_file_id, tab_name)` constraint (gmail-sourced rows have neither).
- Adds two partial uniques:
  - `bids_sheet_uniq` on `(drive_file_id, tab_name) WHERE source = 'sheet'`
  - `bids_gmail_uniq` on `(gmail_message_id, tab_name) WHERE source = 'gmail'`
- Makes `drive_file_id` and `drive_url` nullable.
- Adds `original_drive_url text` (courtesy reference to the Sheets URL parsed from the email body — not fetched).

**Dedup strategy:**
- Partial uniques catch same-file-in-multiple-emails for both sources.
- Cross-message PDF content duplicates (same PDF re-attached in different emails) are caught by in-process **SHA-256 content hashing** during the script run.

**Address extraction (priority order):**
1. Filename pattern `Remodel Bid - <address>` (most reliable).
2. Sheet name (if pm@ has Drive read access).
3. Email subject pattern.
4. PDF body first non-numeric line.
5. Various noise suffixes get stripped (`(1)`, `- Invoice`, `- Revised`, etc.).

**Run:**
```bash
tsx scripts/backfill-bids.ts --since=2023-01-01 [--limit=N] [--dry-run]
```

**Known limits:**
- Most older inspection emails predate the structured `*Field:*` body format, so `purchase_cents` / `clr_cents` / `reserve_pct` parse to null for many backfilled bids.
- Sheets that aren't shared with pm@ still get a row but no line items — full-text search on the email body (stored as `raw_text`) keeps them discoverable in `/bids`.

**Daily cron (deferred):** `/api/cron/scrape-bids` currently still uses the legacy Drive walker. Re-pointing it at the Gmail-PDF logic requires solving the pdfjs/Turbopack interop — see §11 risk #4.
