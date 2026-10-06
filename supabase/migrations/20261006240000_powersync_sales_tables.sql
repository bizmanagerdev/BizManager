-- ════════════════════════════════════════════════════════════════════════════
-- PowerSync: also follow inventory_movements and product_categories, for the
-- sales tabs (price list: bought / sold per product; stock: the movements
-- list; both: the category names). Read-only access for powersync_role;
-- devices get them only through powersync/sync-config.yaml, admins and office
-- only.
--
-- ROLLBACK: supabase/rollbacks/20261006240000_powersync_sales_tables.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

grant select on table public.inventory_movements, public.product_categories to powersync_role;

do $$
declare
  t text;
begin
  foreach t in array array['inventory_movements', 'product_categories'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync add table public.%I', t);
    end if;
  end loop;
end $$;
