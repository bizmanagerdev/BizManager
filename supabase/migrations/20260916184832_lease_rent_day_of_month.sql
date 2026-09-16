-- Rent day of the month, per lease.
--
-- Until now the only signal for "when is rent due" was the lease's start_date,
-- so a lease signed on the 17th produced rent expected on the 17th for ever.
-- In practice tenants pay on an agreed day that has nothing to do with when
-- the contract happened to be signed, which left the payments board showing
-- rent scattered across the 1st, the 15th, the 17th and the 19th.
--
-- Nullable on purpose: a lease with no day set keeps the old behaviour (its
-- start day), so nothing changes until somebody sets one.
--
-- Safe to re-run.

alter table public.lease_agreements
  add column if not exists rent_day_of_month smallint;

alter table public.lease_agreements
  drop constraint if exists lease_agreements_rent_day_of_month_check;

alter table public.lease_agreements
  add constraint lease_agreements_rent_day_of_month_check
  check (rent_day_of_month is null or (rent_day_of_month between 1 and 31));

comment on column public.lease_agreements.rent_day_of_month is
  'Day of the month rent is due (1-31, clamped to short months by the app). Null = fall back to the day in start_date.';
