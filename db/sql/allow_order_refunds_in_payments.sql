-- Run this in Supabase SQL Editor.
-- Allows refund entries to be stored as negative rows in public.payments.

alter table public.payments
  drop constraint if exists payments_amount_total_check;

alter table public.payments
  add constraint payments_amount_total_check
  check (amount_total <> 0);

alter table public.payments
  drop constraint if exists payments_net_amount_check;

alter table public.payments
  add constraint payments_net_amount_check
  check (net_amount <> 0);

alter table public.payments
  drop constraint if exists payments_amount_before_vat_check;

alter table public.payments
  add constraint payments_amount_before_vat_check
  check (amount_before_vat <> 0);
