# PPM Dashboard — Conversion Plan

Clean rewrite of `../../cowork/PPMDashboard` into this Next.js 16 project. Source decisions captured during the 2026-05-14 grilling session.

> **Status:** approved scope, not yet implemented. The old `PPMDashboard` is still the daily driver. Hard cutover happens after this app reaches parity.

---

## 1. Goal

Replace the accreted (HTML → JS → Supabase → Google Cloud → Next.js) old app with a from-scratch rewrite on proper layered standards:

- **All TypeScript**, all inside one Next.js app. No standalone JS/HTML/Python.
- **Postgres (Supabase) is the source of truth** for both property pipeline state and the bid library. `TASKS.md` is no longer a served data source.
- **Service Account + Workspace Domain-Wide Delegation** is the only backend auth. Multi-mailbox impersonation across `@zoodealio.com` and `@tradeinholdings.com`. No user-facing OAuth.
- **Layered code**: route handlers → services → (Google clients | DB repos). Each layer has one job; nothing reaches across.

## 2. Locked decisions

| # | Decision | Resolution |
|---|---|---|
| 1 | Property data source | Postgres in Supabase (no served `TASKS.md`) |
| 2 | DB choice | New Supabase project (already provisioned) |
| 3 | App user auth | None. SA + DWD only |
| 4 | App gating | None. URL is private (logged risk) |
| 5 | Multi-mailbox | SA impersonates a typed list of mailboxes; both `@zoodealio.com` and `@tradeinholdings.com` |
| 6 | TIH DWD setup | Follow-up task, not blocking conversion |
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

## 7. Multi-mailbox SA layer

`src/lib/google/mailboxes.ts`:

```ts
export type MailboxKey =
  | 'bradley'
  | 'tih-contracts'
  | 'tih-pm';

export const MAILBOXES: Record<MailboxKey, {
  email: string;
  label: string;
  domain: 'zoodealio.com' | 'tradeinholdings.com';
  purposes: ReadonlyArray<'inspection-reports' | 'status-updates' | 'personal-thread' | 'bid-attachments'>;
}> = {
  bradley:        { email: 'bradley@zoodealio.com',            label: 'Bradley',      domain: 'zoodealio.com',     purposes: ['personal-thread'] },
  'tih-contracts':{ email: 'contracts@tradeinholdings.com',    label: 'TIH Contracts',domain: 'tradeinholdings.com',purposes: ['inspection-reports', 'status-updates', 'bid-attachments'] },
  'tih-pm':       { email: 'pm@tradeinholdings.com',           label: 'TIH PM',       domain: 'tradeinholdings.com',purposes: ['status-updates'] },
} as const;
```

`src/lib/google/auth.ts`:

```ts
export function getGmailClient(mailbox: MailboxKey): gmail_v1.Gmail { … }
export function getDriveClient(mailbox: MailboxKey): drive_v3.Drive { … }
export function getSheetsClient(mailbox: MailboxKey): sheets_v4.Sheets { … }
```

Each call instantiates a new JWT with the right `subject` (impersonate email). The SA JSON comes from `GOOGLE_SERVICE_ACCOUNT_JSON` env var (same shape as old app).

Crons specify their default mailbox by purpose:
- `cron/gmail-sync` → `forMailboxesWithPurpose('inspection-reports', 'status-updates')`.
- `cron/scrape-bids` → `getDriveClient('bradley')` (Drive owns the templates).

Until `tradeinholdings.com` Workspace gets DWD configured ([memory/project_tih_workspace_dwd_followup.md](../../../.claude/projects/-Users-bradleymeyer-Desktop-coding-pm-dashboard-main/memory/project_tih_workspace_dwd_followup.md)), the TIH mailbox entries in `MAILBOXES` will fail at runtime — that's expected, and `/api/admin/mailbox-verify` will report which ones.

## 8. Environment variables

| Key | Source | Purpose |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | New (paste SA JSON raw) | SA key, all Google API access |
| `DRIVE_COMPS_TEMPLATE_ID` | Old `DRIVE_TEMPLATE_FILE_ID` | Drive file ID for Comps template |
| `DRIVE_REMODEL_BID_TEMPLATE_ID` | Old same | Drive file ID for Remodel Bid template |
| `DRIVE_PROJECT_TRACKER_TEMPLATE_ID` | Old same | Drive file ID for Project Tracker template |
| `SUPABASE_URL` | New Supabase project | DB URL |
| `SUPABASE_SERVICE_ROLE_KEY` | New Supabase project | Server-only key |
| `CRON_SECRET` | Generate `openssl rand -hex 32` | Auth header for crons |
| ~~`GOOGLE_IMPERSONATE_EMAIL`~~ | — | **Removed.** Replaced by `MAILBOXES` constant |
| ~~`KV_REST_API_URL` / `KV_REST_API_TOKEN`~~ | — | **Removed.** No more KV |
| ~~`SUPABASE_ANON_KEY`~~ | — | **Removed.** Server-only access |

## 9. Cron schedule (`vercel.ts`)

```ts
import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  crons: [
    { path: '/api/cron/gmail-sync',   schedule: '0 * * * *' },
    { path: '/api/cron/scrape-bids',  schedule: '0 2 * * *' },
    { path: '/api/cron/token-health', schedule: '0 9 * * *' },
  ],
  functions: {
    'app/api/cron/scrape-bids/route.ts':  { maxDuration: 300 },
    'app/api/admin/scrape-bids/route.ts': { maxDuration: 300 },
  },
};
```

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

## 11. Known risks

1. **No app gate** — explicit user decision; the deployed URL has full Gmail-read / Drive-write powers. Treat the URL as a shared secret. Captured in [memory/feedback_no_app_gate.md](../../../.claude/projects/-Users-bradleymeyer-Desktop-coding-pm-dashboard-main/memory/feedback_no_app_gate.md).
2. **TIH DWD not yet configured** — TIH mailbox impersonation will fail until follow-up. App handles this gracefully (the Mailbox Verify route reports per-mailbox status).
3. **Hard cutover** — there will be a "between the old app and the new app" moment. Mitigation: keep the old app available read-only (`PPMDashboard` still on disk) for one week post-cutover.
4. **Address parsing edge cases** — `TASKS.md` addresses are hand-typed; migration script must handle missing state/zip, missing comma, etc. Migration script has `--dry-run`.
5. **Bid scraper coverage** — historical bids live across multiple Drive accounts. The scraper needs the SA to have access to each. May require explicit share grants or DWD impersonation of the bid owners.

## 12. Open items

- Confirm full list of mailboxes needed (currently planning: `bradley`, `tih-contracts`, `tih-pm` — are there others?).
- Confirm whether `est_repair` should be migrated from anywhere (it's referenced in CLAUDE.md but absent from current `TASKS.md`).
- Decide whether to keep the local `Inspection Reports/` folder as a dev convenience (recommend: yes, gitignored).
