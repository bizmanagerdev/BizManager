-- ROLLBACK for supabase/migrations/20261007190000_powersync_project_page_tables.sql

do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'business_settings', 'recurring_expense_templates'] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync drop table public.%I', t);
    end if;
  end loop;
end $$;

revoke select on table public.accounts, public.business_settings, public.recurring_expense_templates from powersync_role;
