# PPM Dashboard

Internal Zoodealio tool for the Property Project Management team. Tracks inspection reports, remodel bids, comps, and the property pipeline from **Inspection Received → Ready for Listing**, with Google Drive / Gmail / Sheets automation wired in.

This is a clean rewrite of the original `cowork/PPMDashboard`. Spec lives in [docs/CONVERSION_PLAN.md](docs/CONVERSION_PLAN.md). Workflow and domain notes in [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md).

## Stack

- **Next.js 16** App Router (React 19, Turbopack)
- **Supabase** Postgres (with `pg` driver for migrations + server-side reads)
- **Google APIs** — Drive, Gmail, Sheets (user OAuth, refresh token persisted via Supabase)
- **Tailwind v4** + **shadcn/ui** + **lucide-react**
- **Hosted on Vercel** (Fluid Compute, crons in `vercel.ts`)

## Prerequisites

- Node 20+ (Vercel runs Node 24 — local 20 is fine)
- A populated `.env.local` (see [Environment](#environment))
- Access to the Supabase project and the Google OAuth client

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

The dev server defaults to port 3000. If 3000 is in use, Next will pick the next free port (or run `PORT=3001 npm run dev`).

### Environment

Copy production env vars from Vercel into `.env.local`:

```bash
vercel env pull .env.local
```

Required groups (full list in Vercel project settings):

- **Supabase** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus the `POSTGRES_*` connection strings
- **Google OAuth** — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- **Drive template file IDs** — `DRIVE_TEMPLATE_FILE_ID` (comps), `DRIVE_REMODEL_BID_TEMPLATE_FILE_ID`, `DRIVE_PROJECT_TRACKER_TEMPLATE_FILE_ID`
- **`CRON_SECRET`** — guards `/api/cron/*` routes

### Database

Migrations are plain SQL in [`supabase/migrations/`](supabase/migrations). Apply them against the connected Postgres:

```bash
npm run db:migrate
```

One-time TASKS.md import (dry run first, then `:write`):

```bash
npm run db:import-tasks
npm run db:import-tasks:write
```

### Verifying Google auth

```bash
npm run db:verify-auth        # token introspection, no API calls
npm run db:verify-auth:live   # hits Drive + Gmail to confirm scopes
```

## Project layout

```
src/
  app/
    page.tsx                 # dashboard home
    pipeline/                # kanban board view of properties by stage
    properties/[slug]/       # property detail page (bid, comps, offer scenarios)
    bids/                    # bid library: Items / Bids / Drafts tabs
    api/
      admin/                 # one-off admin endpoints (mailbox verify, scrape)
      cron/                  # gmail-sync, scrape-bids, token-health
  components/
    board/                   # pipeline kanban (dnd-kit)
    property/                # property page sections
    bids/                    # bid library UI
    ui/                      # shadcn primitives
    TopNav.tsx, BrandMark.tsx
  lib/
    db/                      # Postgres queries (properties, bids, aggregates)
    google/                  # auth, drive, gmail, sheets, mailboxes
    services/                # domain logic (bid buckets, stages, offer math, scraper)
    actions/                 # server actions called from UI
supabase/migrations/         # 0001_init.sql, 0002_bid_drafts.sql, ...
scripts/                     # tsx scripts run via npm run db:*
docs/CONVERSION_PLAN.md      # design spec
vercel.ts                    # cron schedule + per-route maxDuration
```

## Deploying

The project is linked to the Vercel project `pm-dashboard-main` (team Zoodealio). Vercel's GitHub integration watches this repo, so **deploys happen automatically on push**.

### Promote to the live site (production)

The live site is built from `main`. To ship changes:

```bash
git checkout main
git pull
git merge <your-branch>     # or open a PR and merge on GitHub
git push origin main
```

Vercel picks up the push, builds, and promotes the new deployment to the production domain. Watch the build at https://vercel.com/zoodealio/pm-dashboard-main/deployments or:

```bash
vercel inspect --logs
```

### Preview deploys

Any push to a non-`main` branch (or PR) creates a preview deployment with its own URL. Find it in the GitHub PR checks or:

```bash
vercel ls
```

### Deploying without pushing to git

You can also deploy directly from the CLI (useful for hotfixes or out-of-band testing):

```bash
vercel               # preview deploy of the current working tree
vercel --prod        # promote a build of the current working tree to production
```

Prefer the git push flow when possible — it keeps `main` and production in sync.

### Cron jobs

Scheduled tasks are declared in [`vercel.ts`](vercel.ts) and run on the deployed environment only (not locally):

- `/api/cron/gmail-sync` — hourly
- `/api/cron/scrape-bids` — daily at 02:00
- `/api/cron/token-health` — daily at 09:00

All cron routes require the `CRON_SECRET` header that Vercel injects automatically.

## Useful scripts

| Script | What |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build (what Vercel runs) |
| `npm run start` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply `supabase/migrations/*.sql` |
| `npm run db:verify-auth` / `:live` | Sanity-check Google OAuth token |
| `npm run db:import-tasks` / `:write` | Import legacy `TASKS.md` properties |

Smoke scripts under [`scripts/`](scripts/) (`smoke-drive.ts`, `smoke-gmail.ts`, etc.) can be run directly with `tsx` for ad-hoc API checks.
