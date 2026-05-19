-- Inspection thread tracking moves out of questionnaire_url. Until now,
-- properties.questionnaire_url did double duty: a clickable link on the
-- property page AND the source-of-truth for the inspection thread id used
-- by PropertyActivity. Going forward, questionnaire_url points at the
-- "Sellers Disclosures" PDF in the accounting Drive (better destination for
-- a manual click), and inspection_thread_id holds the Gmail thread id
-- separately so the Activity timeline keeps working.
--
-- Backfill: extract the thread id from any existing mail.google.com URL.
-- Pattern `#all/<id>` matches the URLs we synthesize in gmail-sync.

alter table properties
  add column if not exists inspection_thread_id text;

update properties
   set inspection_thread_id = substring(questionnaire_url from '#all/([A-Za-z0-9]+)')
 where inspection_thread_id is null
   and questionnaire_url like '%mail.google.com%';
