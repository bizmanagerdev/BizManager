-- Undoes supabase/migrations/20261022100000_payments_rent_checks_and_months.sql.
-- Drops both columns and whatever was filled into them: a torn check then reads
-- as one that came back, and a payment for ticked months is split evenly over
-- its first month and how many. Take a copy first if they matter:
--   create table backup.payments_rent_checks_and_months as
--     select id, check_torn_at, rent_allocation from public.payments
--     where check_torn_at is not null or rent_allocation is not null;

set lock_timeout = '5s';

alter table public.payments
  drop column if exists rent_allocation,
  drop column if exists check_torn_at;
