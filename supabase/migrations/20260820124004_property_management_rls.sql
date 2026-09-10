-- Unlock properties/lease_agreements/property_expenses: these tables have RLS
-- ENABLED but had ZERO policies (only service_role could touch them), which is
-- why /properties has been a stub — admin/office got nothing through the
-- normal app client. Mirrors the shape already proven in
-- db/sql/fix_rls_access.sql (section B), scoped to just these 3 tables.
-- Idempotent (drop-if-exists first) — safe to re-run.

-- properties: admin+office manage; worker read-only (matches the vehicles/
-- job-site read pattern — a worker may need to see a property to start a
-- session against it).
drop policy if exists "properties_admin_full"  on public.properties;
drop policy if exists "properties_office_full" on public.properties;
drop policy if exists "properties_worker_read" on public.properties;
create policy "properties_admin_full"  on public.properties for all to public
  using (is_admin()) with check (is_admin());
create policy "properties_office_full" on public.properties for all to public
  using (current_user_role() = 'office'::user_role_enum)
  with check (current_user_role() = 'office'::user_role_enum);
create policy "properties_worker_read" on public.properties for select to public
  using (current_user_role() = 'worker'::user_role_enum);

-- lease_agreements: admin + office only.
drop policy if exists "lease_agreements_admin_full"  on public.lease_agreements;
drop policy if exists "lease_agreements_office_full" on public.lease_agreements;
create policy "lease_agreements_admin_full"  on public.lease_agreements for all to public
  using (is_admin()) with check (is_admin());
create policy "lease_agreements_office_full" on public.lease_agreements for all to public
  using (current_user_role() = 'office'::user_role_enum)
  with check (current_user_role() = 'office'::user_role_enum);

-- property_expenses: unused by app code today (expenses.property_id is the
-- live pattern), but it's in the same RLS-gap batch — unlock it defensively
-- so it isn't a landmine if it's ever used later.
--
-- REMOVED (2026-09-10, migration-baseline backfill — see foundation-hardening
-- memory): property_expenses itself was dropped (empty, unused, confirmed
-- live) by supabase/migrations/20260901081541_drop_unused_property_task_
-- tables.sql, so baseline.sql no longer creates it at all — these policy
-- statements on a nonexistent table fail on a from-scratch replay. Actual
-- production history was create table → these policies → later drop table,
-- but baseline collapses straight to the final (dropped) state, so this
-- transient middle step is skipped.
