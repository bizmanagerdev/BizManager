-- Furnished/furniture-list per property, and security deposit / guarantee tracking per lease.

alter table public.properties
  add column if not exists is_furnished boolean not null default false,
  add column if not exists furniture_items text[] not null default '{}';

alter table public.lease_agreements
  add column if not exists deposit_type text,
  add column if not exists deposit_amount numeric,
  add column if not exists deposit_reference text;
