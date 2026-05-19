-- Drive restructure: artifacts split across two Google Drives.
--
--   accounting_address_folder_id → the <address>/ folder in
--     accounting@tradeinholdings.com's 2026 Acquisition & Disposition/ tree.
--     Fuzzy-matched on first Comps/Bid click; persisted to avoid re-searching.
--
--   pm_review_folder_id → the PM Review/ subfolder we create under
--     <address>/Acquisitions/. Where Comps + Remodel Bid sheets live.
--
--   renovation_folder_id → the Active/<address>/ folder in pm@'s
--     Renovations/<year> Renovations/Active/ tree. Where the Project Tracker
--     + 6 renovation subfolders live.
--
-- drive_folder_id (legacy Properties/<address>/ in pm@) stays in place until
-- the cleanup task removes its last callers — dropping it now would break
-- type-checking for templating, lifecycle, and documents-tab code that hasn't
-- migrated yet.

alter table properties
  add column if not exists accounting_address_folder_id text,
  add column if not exists pm_review_folder_id text,
  add column if not exists renovation_folder_id text;
