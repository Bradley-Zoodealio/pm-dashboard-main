-- Terminal pipeline stages: 'cancelled' and 'closed'.
-- stage_changed_at is the clock the auto-close cron checks against
-- (NOT updated_at, which is bumped by unrelated field edits).

alter table properties
  add column if not exists stage_changed_at timestamptz not null default now(),
  add column if not exists cancelled_at     timestamptz,
  add column if not exists cancelled_reason text,
  add column if not exists closed_at        timestamptz;

create or replace function set_stage_changed_at() returns trigger as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists properties_set_stage_changed_at on properties;
create trigger properties_set_stage_changed_at
  before update on properties
  for each row execute function set_stage_changed_at();

create index if not exists properties_stage_changed_at_idx
  on properties (stage_changed_at);
