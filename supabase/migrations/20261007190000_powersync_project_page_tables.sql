-- ════════════════════════════════════════════════════════════════════════════
-- PowerSync: also follow accounts, business_settings and
-- recurring_expense_templates, for a project's page drawn from the device —
-- each movement's account by name, the VAT rate, and a recurring bill's rule
-- by name (and who set it up). Read-only access for powersync_role; devices get
-- them only through powersync/sync-config.yaml (v1.7): admins and office only
-- (the same people these tables' RLS lets read them), and only the account
-- names, the VAT rate and the rule names — no balances or other settings.
--
-- ROLLBACK: supabase/rollbacks/20261007190000_powersync_project_page_tables.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

grant select on table public.accounts, public.business_settings, public.recurring_expense_templates to powersync_role;

do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'business_settings', 'recurring_expense_templates'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync add table public.%I', t);
    end if;
  end loop;
end $$;
