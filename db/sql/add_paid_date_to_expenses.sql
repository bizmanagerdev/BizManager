-- ════════════════════════════════════════════════════════════════════════════
-- add_paid_date_to_expenses
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- expense_date = the date the expense is SCHEDULED / billed (what a recurring
-- template stamps, e.g. "rent due the 10th"). paid_date = the day the money
-- ACTUALLY left the account, captured when you confirm "סמן כשולם".
--
-- The /financial cash-flow engine dates a confirmed (שולם) expense on paid_date
-- when present, so paying early/late lands the cash-out on the real day without
-- destroying the original scheduled expense_date. Unpaid/scheduled rows keep
-- flowing on expense_date as before.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.expenses
  add column if not exists paid_date date null;

create index if not exists expenses_paid_date_idx
  on public.expenses (paid_date);
