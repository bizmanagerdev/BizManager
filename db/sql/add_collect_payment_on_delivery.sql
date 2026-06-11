-- Run this in the Supabase SQL Editor.
-- Adds a per-order flag: should the DRIVER collect the payment on delivery
-- (true) or is it paid to the office (false, default)?
-- The app reads/writes this column best-effort, so nothing breaks before this
-- script runs — but the flag only persists and displays after it does.

alter table public.orders
  add column if not exists collect_payment_on_delivery boolean not null default false;
