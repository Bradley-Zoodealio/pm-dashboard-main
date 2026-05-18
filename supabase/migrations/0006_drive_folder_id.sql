-- Drive folder structure: each property gets a folder at
-- Properties/<full address>/ in pm@tradeinholdings.com's My Drive, with
-- a Docs/ subfolder for app-generated artifacts. The folder ID is cached
-- so we look up by ID instead of by name (renames don't break the link).

alter table properties add column if not exists drive_folder_id text;

create index if not exists properties_drive_folder_id_idx
  on properties (drive_folder_id)
  where drive_folder_id is not null;
