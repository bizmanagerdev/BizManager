-- Formalize customers.city.
--
-- The column exists in prod (added by the legacy db/sql customers_required_delivery_
-- fields.sql) but was never captured in the migration baseline — so a DB built from
-- migrations wouldn't have it, and the app's insert of `city` would fail there. This
-- reconciles the schema: city is a required field ("force the city"), matching prod
-- and the form's validation. Idempotent — a no-op on prod. Pairs with
-- 20260701000000 which made email/address optional.

alter table public.customers
  add column if not exists city text;

-- Defensive backfill so the NOT NULL below is always satisfiable (no-op on prod,
-- where every row already has a city).
update public.customers
  set city = coalesce(nullif(trim(city), ''), 'לא הוגדר')
  where city is null or trim(city) = '';

alter table public.customers
  alter column city set not null;
