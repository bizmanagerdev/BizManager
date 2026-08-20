-- Property acquisition details: who it was bought from, when, for how much,
-- purchase tax paid, and its land-registry (טאבו) identifiers.
alter table public.properties
  add column if not exists purchased_from text,
  add column if not exists purchase_date date,
  add column if not exists purchase_price numeric,
  add column if not exists purchase_tax numeric,
  add column if not exists land_block text,
  add column if not exists land_parcel text,
  add column if not exists land_sub_parcel text;
