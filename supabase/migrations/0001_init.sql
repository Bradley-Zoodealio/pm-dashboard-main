-- pm-dashboard-main — initial schema
-- Properties pipeline + historical bid library. Runs once against an empty Supabase project.

create extension if not exists "pgcrypto";
create extension if not exists pg_trgm;

-- ── Property pipeline ────────────────────────────────────────────────────────

create table if not exists properties (
  id                  uuid primary key default gen_random_uuid(),
  slug                text unique not null,
  address             text not null,
  stage               text not null,
  purchase_cents      bigint,
  clr_cents           bigint,
  reserve_pct         numeric(5,2),
  inspect_date        date,
  assignee            text,
  inspect_url         text,
  redfin_url          text,
  cma_url             text,
  comps_url           text,
  questionnaire_url   text,
  remodel_bid_url     text,
  project_tracker_url text,
  arv_cents           bigint,
  est_repair_cents    bigint,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists properties_stage_idx        on properties (stage);
create index if not exists properties_assignee_idx     on properties (assignee);
create index if not exists properties_inspect_date_idx on properties (inspect_date);

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists properties_set_updated_at on properties;
create trigger properties_set_updated_at
  before update on properties
  for each row execute function set_updated_at();

create table if not exists property_notes (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  body          text not null,
  checked       boolean not null default false,
  position      int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists property_notes_property_idx on property_notes (property_id, position);

-- ── Bid library ──────────────────────────────────────────────────────────────

create table if not exists bids (
  id                uuid primary key default gen_random_uuid(),
  drive_file_id     text not null,
  tab_name          text not null,
  address_raw       text,
  address_street    text,
  bid_year          int,
  total_amount      numeric,
  drive_url         text not null,
  modified_at       timestamptz,
  scraped_at        timestamptz not null default now(),
  source            text not null default 'sheet',
  source_account    text,
  authored_by       text,
  raw_text          text,
  gmail_message_id  text,
  gmail_thread_id   text,
  subject           text,
  unique (drive_file_id, tab_name)
);

create index if not exists bids_address_street_idx on bids (address_street);
create index if not exists bids_bid_year_idx       on bids (bid_year);
create index if not exists bids_source_idx         on bids (source);
create index if not exists bids_authored_by_idx    on bids (authored_by);
create index if not exists bids_modified_at_idx    on bids (modified_at desc);
create index if not exists bids_raw_text_trgm
  on bids using gin (raw_text gin_trgm_ops);

create table if not exists bid_line_items (
  id            uuid primary key default gen_random_uuid(),
  bid_id        uuid not null references bids(id) on delete cascade,
  position      int not null,
  description   text not null,
  total         numeric,
  is_footer     boolean not null default false
);

create index if not exists bid_line_items_bid_idx on bid_line_items (bid_id);
create index if not exists bid_line_items_description_trgm
  on bid_line_items using gin (description gin_trgm_ops);

create table if not exists bid_scrape_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  files_seen      int not null default 0,
  bids_upserted   int not null default 0,
  items_upserted  int not null default 0,
  errors          jsonb not null default '[]'::jsonb
);

create index if not exists bid_scrape_runs_started_at_idx on bid_scrape_runs (started_at desc);

create or replace view bid_preferred as
select distinct on (coalesce(address_street, address_raw)) *
from bids
where address_raw is not null
order by
  coalesce(address_street, address_raw),
  case when authored_by ilike any (array['%jason%', '%kala%', '%eliot%']) then 0 else 1 end,
  modified_at desc nulls last;
