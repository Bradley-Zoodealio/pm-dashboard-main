-- Bid backfill from Gmail PDFs needs the bids table to accept rows without
-- a Drive file (source='gmail'). The original unique constraint was
-- (drive_file_id, tab_name) which assumed every bid has a sheet — that no
-- longer holds. Split into two partial uniques by source. Also relax NOT NULL
-- on drive_file_id and drive_url since gmail-sourced rows may have neither.

alter table bids drop constraint if exists bids_drive_file_id_tab_name_key;

alter table bids alter column drive_file_id drop not null;
alter table bids alter column drive_url     drop not null;

-- For gmail-sourced bids: tab_name stores the PDF attachment filename so the
-- natural key (gmail_message_id, tab_name) disambiguates Option 1 / Option 2
-- PDFs attached to the same email.
create unique index if not exists bids_sheet_uniq
  on bids (drive_file_id, tab_name)
  where source = 'sheet';

create unique index if not exists bids_gmail_uniq
  on bids (gmail_message_id, tab_name)
  where source = 'gmail';

-- Courtesy reference to the Google Sheets URL parsed from the Gmail body
-- (if present). The app does NOT attempt to fetch this — most historical
-- sheets aren't shared with pm@tradeinholdings.com. The bid library UI shows
-- it as a "Source sheet (may require access)" link.
alter table bids add column if not exists original_drive_url text;
