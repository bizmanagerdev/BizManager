-- Run in Supabase SQL Editor
-- Adds delivery/contact fields needed for scheduling and receipts.

alter table public.customers
  add column if not exists city text,
  add column if not exists address text,
  add column if not exists email text;

-- Optional: backfill existing rows before enforcing NOT NULL.
update public.customers
set city = coalesce(nullif(trim(city), ''), 'לא הוגדר')
where city is null or trim(city) = '';

update public.customers
set address = coalesce(nullif(trim(address), ''), 'לא הוגדר')
where address is null or trim(address) = '';

update public.customers
set email = coalesce(nullif(trim(email), ''), 'missing@example.com')
where email is null or trim(email) = '';

alter table public.customers
  alter column city set not null,
  alter column address set not null,
  alter column email set not null;
