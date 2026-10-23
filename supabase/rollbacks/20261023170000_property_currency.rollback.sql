-- Rollback for 20261023170000_property_currency.sql.
-- Takes the currency off properties. A property in US$ or C$ loses it (and its
-- purchase price and tax would read as shekels again) — save them first:
--   create table backup.properties_currency_<yyyymmdd_hhmm> as
--     select id, name, currency, purchase_price, purchase_tax
--     from public.properties where currency <> 'ILS';
-- No money row changes: each keeps its own currency.

alter table public.properties drop constraint if exists properties_currency_check;
alter table public.properties drop column if exists currency;
