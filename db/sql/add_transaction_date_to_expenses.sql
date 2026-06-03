-- Run this in the Supabase SQL Editor.
-- Credit-card statements carry two dates: the billing/charge date (תאריך חיוב) and the
-- transaction date (תאריך עסקה). We keep expense_date = billing date so cash flow stays
-- correct (that's when cash actually leaves the account), and store the real spend date
-- here so duplicate detection can match transaction-to-transaction.
alter table public.expenses
  add column if not exists transaction_date date null;

-- Speeds up the importer's duplicate lookup (amount + date proximity).
create index if not exists expenses_amount_transaction_date_idx
  on public.expenses (amount, transaction_date);
