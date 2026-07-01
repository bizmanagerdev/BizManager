-- Restore customers.email / customers.address to OPTIONAL.
--
-- Background: an old db/sql migration (customers_required_delivery_fields.sql)
-- set email + address NOT NULL on the live DB. The app never sends those as
-- required — the mandatory fields are name, phone and city (city is validated in
-- the form and stored inside `address` as "city | street"). The NOT NULL on
-- email broke customer creation whenever email was left blank.
--
-- This makes email + address nullable again. name/phone stay NOT NULL, and city
-- stays enforced by the form UI (there is no separate city column). Idempotent.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers'
      and column_name = 'email' and is_nullable = 'NO'
  ) then
    execute 'alter table public.customers alter column email drop not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customers'
      and column_name = 'address' and is_nullable = 'NO'
  ) then
    execute 'alter table public.customers alter column address drop not null';
  end if;
end $$;
