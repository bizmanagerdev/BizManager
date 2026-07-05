-- Installment splitting for expenses (payments calendar).
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Splitting one obligation (e.g. ₪1000 to a supplier) into several dated payments
-- creates N separate `expenses` rows that share an `installment_group_id`. Each row
-- carries its own `expense_date`/`amount`/`payment_status`, so it lands on its own
-- day in the payments calendar and is marked paid individually. `installment_index`
-- / `installment_count` let the UI label them "2/4" and group them together.

alter table public.expenses add column if not exists installment_group_id uuid;
alter table public.expenses add column if not exists installment_index integer;
alter table public.expenses add column if not exists installment_count integer;

create index if not exists expenses_installment_group_idx
  on public.expenses (installment_group_id)
  where installment_group_id is not null;
