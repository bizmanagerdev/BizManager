-- ════════════════════════════════════════════════════════════════════════════
-- Loan installment plan (תוכנית החזרים) — pay a loan back in installments.
--
-- A `loan_repayments` row is now one of two things:
--   • status 'planned' — a FUTURE installment: a date + an amount that is owed
--     but has NOT moved yet. Feeds the cash forecast and the payments calendar;
--     does NOT reduce the loan's outstanding balance.
--   • status 'paid'    — an actual repayment (cash moved). Reduces outstanding,
--     exactly as every existing row does.
--
-- Every pre-existing row is a real repayment, so the default is 'paid' and the
-- backfill is a no-op. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.loan_repayments
  add column if not exists status text not null default 'paid',
  -- "תשלום 2 מתוך 5" — position inside the plan this row was generated from.
  add column if not exists installment_index integer,
  add column if not exists installment_count integer;

alter table public.loan_repayments
  drop constraint if exists loan_repayments_status_check;
alter table public.loan_repayments
  add constraint loan_repayments_status_check check (status in ('planned', 'paid'));

-- Planned installments are read by date (next due / overdue) across all loans.
create index if not exists loan_repayments_status_date_idx
  on public.loan_repayments (status, repayment_date);
