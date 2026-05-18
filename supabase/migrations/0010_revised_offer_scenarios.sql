-- After receiving an inspection report and reviewing the property the PM team
-- may want to revise the offer (different purchase price, raise the CLR for
-- repairs, adjust reserve %). The original purchase_cents/clr_cents/reserve_pct
-- columns stay as the contract baseline; these new columns hold the team's
-- proposed revisions for each of the two offer types (Cash+ baseline / Cash+
-- with Repairs). Either set may be set independently; null means "no revision
-- yet, use the original".

alter table properties
  add column if not exists revised_as_is_purchase_cents bigint,
  add column if not exists revised_as_is_clr_cents      bigint,
  add column if not exists revised_as_is_reserve_pct    numeric(5,2),
  add column if not exists revised_repaired_purchase_cents bigint,
  add column if not exists revised_repaired_clr_cents      bigint,
  add column if not exists revised_repaired_reserve_pct    numeric(5,2);
