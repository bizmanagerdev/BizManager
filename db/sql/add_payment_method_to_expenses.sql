alter table public.expenses
  add column if not exists payment_method text null;
