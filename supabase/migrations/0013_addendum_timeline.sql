-- Addendum 5-day timeline + email thread tracker.
--
-- addendum_sent_at is the absolute instant the "Inspection Addendum
-- Response - <address>" email left contracts@'s Sent folder. It anchors
-- the calendar's 5-calendar-day countdown. Stored as timestamptz (not
-- the existing stage_changed_at) because Gmail backfill may discover
-- a send that happened days before the property was dragged into
-- Addendum Sent; stage_changed_at would reflect the drag time, not the
-- real send time.
--
-- addendum_thread_id is the Gmail thread id in the tih-contracts
-- mailbox. Powers the property-page "Addendum Thread" tracker. No FK —
-- it's a Gmail id, not a row id. No unique index in v1; the sync's
-- per-slug dedup is the only guard, which is fine while addendum-sends
-- are 1:1 with properties.
--
-- Both columns are nullable. The application server action clears
-- them on backward stage move out of addendum-sent; they are preserved
-- on cancel or forward progress so the property page can keep showing
-- the historical thread.

alter table properties
  add column if not exists addendum_sent_at   timestamptz,
  add column if not exists addendum_thread_id text;

create index if not exists properties_addendum_sent_at_idx
  on properties (addendum_sent_at)
  where addendum_sent_at is not null;
