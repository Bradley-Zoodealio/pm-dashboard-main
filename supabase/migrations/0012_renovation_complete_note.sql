-- Renovation completion is now a flag on the property (not a stage
-- transition). When the PM marks a contract-work property complete:
--   renovation_completed_at = now()
--   renovation_complete_note = "<note>"
-- The card stays in Contract Work, painted a darker emerald, until the
-- 24h board-side filter hides it. Auto-close cron closes it after 2 days.
--
-- The ready-for-listing stage is going away. Carry any existing rows in
-- that stage into the new model: mark them complete (preserving the
-- original transition timestamp as the completion timestamp) and put them
-- back into contract-work. We disable the stage trigger so stage_changed_at
-- isn't bumped to now by the UPDATE.

alter table properties
  add column if not exists renovation_complete_note text,
  add column if not exists renovation_completed_at  timestamptz;

alter table properties disable trigger properties_set_stage_changed_at;

update properties
  set renovation_completed_at = stage_changed_at,
      stage = 'contract-work'
  where stage = 'ready-for-listing';

alter table properties enable trigger properties_set_stage_changed_at;

create index if not exists properties_renovation_completed_at_idx
  on properties (renovation_completed_at)
  where renovation_completed_at is not null;
