-- Undoes supabase/migrations/20261023140000_properties_tax_and_land_registry_links.sql.
-- Drops the columns and the links filled into them. Take a copy first if they matter:
--   create table backup.properties_links as
--     select id, tax_account_url, land_registry_url, land_title_url from public.properties;

set lock_timeout = '5s';

alter table public.properties
  drop column if exists land_title_url,
  drop column if exists land_registry_url,
  drop column if exists tax_account_url;
