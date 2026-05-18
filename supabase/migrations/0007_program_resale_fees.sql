-- Trade In Holdings deals have two percentage fees tracked alongside the
-- Reserve %: the Program Fee (typically 6.5%-8.5%) and the Resale Fee
-- (typically 3.5%-5.5%). Stored the same way as reserve_pct — as the percent
-- value (e.g. 8.5 for 8.5%) so the UI can display "X%" without extra math.

alter table properties
  add column if not exists program_fee_pct numeric(5,2),
  add column if not exists resale_fee_pct  numeric(5,2);
