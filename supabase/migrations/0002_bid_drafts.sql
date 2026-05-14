-- Bid drafts: persistent, shareable bid compositions.
-- Tier handling: a single draft has tier=NULL; "Duplicate as Option 2" creates a
-- second draft with parent_draft_id pointing at the original and tier='option-2'.
-- created_by_email is pre-added for the upcoming OAuth pivot; ignored by UI today.

create table if not exists bid_drafts (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid null references properties(id) on delete set null,
  parent_draft_id  uuid null references bid_drafts(id) on delete set null,
  tier             text null check (tier in ('option-1', 'option-2') or tier is null),
  title            text not null,
  created_by_email text null,
  archived_at      timestamptz null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists bid_drafts_property_id_idx       on bid_drafts (property_id);
create index if not exists bid_drafts_parent_draft_id_idx   on bid_drafts (parent_draft_id);
create index if not exists bid_drafts_updated_at_idx        on bid_drafts (updated_at desc);
create index if not exists bid_drafts_active_idx            on bid_drafts (archived_at) where archived_at is null;

create table if not exists bid_draft_items (
  id                       uuid primary key default gen_random_uuid(),
  draft_id                 uuid not null references bid_drafts(id) on delete cascade,
  position                 int not null,
  description              text not null,
  total_cents              bigint null,
  is_footer                boolean not null default false,
  source_bid_line_item_id  uuid null references bid_line_items(id) on delete set null
);

create index if not exists bid_draft_items_draft_position_idx on bid_draft_items (draft_id, position);
