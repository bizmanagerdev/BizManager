-- Run this in Supabase SQL Editor.
-- Adds a dedicated check_number column to public.payments so payments made by
-- check can be identified by their printed check number (separate from the
-- generic reference_number used for transfers / credit-card auth codes).

alter table public.payments
  add column if not exists check_number text null;

create index if not exists payments_check_number_idx
  on public.payments (check_number)
  where check_number is not null;
