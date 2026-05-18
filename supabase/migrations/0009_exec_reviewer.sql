-- Track which exec (Kala / Jason / Eliot) is reviewing the Remodel Bid we
-- submitted. Set during the Exec Final Review stage so PMs can see who has
-- each property on their plate. Mirrors the assignee column shape.

alter table properties
  add column if not exists exec_reviewer text;

create index if not exists properties_exec_reviewer_idx on properties (exec_reviewer);
