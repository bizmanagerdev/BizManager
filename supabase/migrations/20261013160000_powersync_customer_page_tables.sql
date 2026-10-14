-- ════════════════════════════════════════════════════════════════════════════
-- PowerSync: also follow customers' contacts, and the tags and which records
-- carry them, so the customers list and a customer's page can be drawn on the
-- device like the four main sections (owner, 2026-10-13: "yes, prepare it").
-- Small tables (162 contacts, 4 tags, 25 tag links today). Read-only access
-- for powersync_role; devices get them only through powersync/sync-config.yaml
-- (v1.11): admins and office only — the only people who open customer pages —
-- workers never.
--
-- Run BEFORE deploying sync rules v1.11: rules that name a table outside the
-- publication fail to deploy.
--
-- ROLLBACK: supabase/rollbacks/20261013160000_powersync_customer_page_tables.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

grant select on table
  public.contacts,
  public.tags,
  public.entity_tags
to powersync_role;

do $$
declare
  t text;
begin
  foreach t in array array['contacts', 'tags', 'entity_tags'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync add table public.%I', t);
    end if;
  end loop;
end $$;
