-- ROLLBACK for supabase/migrations/20261018110000_structured_addresses.sql
--
-- Drops only the structured-address columns that migration added. The old
-- address columns were never touched, so nothing else needs restoring.
-- Anything typed into the new fields since is lost: if they have been filled
-- (the backfill, or the address picker in use), copy them out first, e.g.
--   create table backup.customers_addr_<date> as
--     select id, addr_city, addr_street, addr_house_number, addr_unit,
--            addr_lat, addr_lng, addr_place_id, addr_formatted
--     from public.customers where addr_place_id is not null or addr_street is not null;
-- and the same for customer_branches, tasks, properties and projects.
-- Ship the app without the fields first, or its reads of them will fail.

set lock_timeout = '5s';

alter table public.customers
  drop column if exists addr_city,
  drop column if exists addr_street,
  drop column if exists addr_house_number,
  drop column if exists addr_unit,
  drop column if exists addr_lat,
  drop column if exists addr_lng,
  drop column if exists addr_place_id,
  drop column if exists addr_formatted;

alter table public.customer_branches
  drop column if exists addr_city,
  drop column if exists addr_street,
  drop column if exists addr_house_number,
  drop column if exists addr_unit,
  drop column if exists addr_lat,
  drop column if exists addr_lng,
  drop column if exists addr_place_id,
  drop column if exists addr_formatted;

alter table public.tasks
  drop column if exists addr_city,
  drop column if exists addr_street,
  drop column if exists addr_house_number,
  drop column if exists addr_unit,
  drop column if exists addr_lat,
  drop column if exists addr_lng,
  drop column if exists addr_place_id,
  drop column if exists addr_formatted;

alter table public.properties
  drop column if exists addr_city,
  drop column if exists addr_street,
  drop column if exists addr_house_number,
  drop column if exists addr_unit,
  drop column if exists addr_lat,
  drop column if exists addr_lng,
  drop column if exists addr_place_id,
  drop column if exists addr_formatted;

alter table public.projects
  drop column if exists origin_city,
  drop column if exists origin_street,
  drop column if exists origin_house_number,
  drop column if exists origin_unit,
  drop column if exists origin_lat,
  drop column if exists origin_lng,
  drop column if exists origin_place_id,
  drop column if exists origin_formatted,
  drop column if exists destination_city,
  drop column if exists destination_street,
  drop column if exists destination_house_number,
  drop column if exists destination_unit,
  drop column if exists destination_lat,
  drop column if exists destination_lng,
  drop column if exists destination_place_id,
  drop column if exists destination_formatted;
