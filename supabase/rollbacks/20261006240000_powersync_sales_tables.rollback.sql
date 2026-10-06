-- ROLLBACK for supabase/migrations/20261006240000_powersync_sales_tables.sql

do $$
declare
  t text;
begin
  foreach t in array array['inventory_movements', 'product_categories'] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync drop table public.%I', t);
    end if;
  end loop;
end $$;

revoke select on table public.inventory_movements, public.product_categories from powersync_role;
