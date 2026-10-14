-- ROLLBACK for supabase/migrations/20261013160000_powersync_customer_page_tables.sql
-- Deploy sync rules without contacts / tags / entity_tags (v1.10) first.

do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'tags', 'entity_tags'] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync drop table public.%I', t);
    end if;
  end loop;
end $$;

revoke select on table
  public.contacts,
  public.tags,
  public.entity_tags
from powersync_role;
