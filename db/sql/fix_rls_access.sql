-- ════════════════════════════════════════════════════════════════════════════
-- RLS ACCESS FIXES  —  SAFE TO RUN NOW. Run in the Supabase SQL Editor.
-- Purely ADDITIVE: every statement only GRANTS access (or replaces a dead
-- policy). It cannot remove access from anyone or blank any existing screen.
-- Idempotent (drop-if-exists first). Fixes Issue 2 (office can't add expenses,
-- + tables that were locked to everyone).
--
--   A) push_alert_config: replace the broken "Admin only" (keyed on users.id =
--      auth.uid(), which matched nobody) with is_admin().
--   B) Unlock 5 tables that had RLS enabled but ZERO policies (so only the
--      service_role could touch them): properties, property_expenses,
--      lease_agreements, payslip_items, hourly_salary_overrides.
--   C) expenses + project_expenses: add office management + worker "see own".
-- ════════════════════════════════════════════════════════════════════════════

-- ── A) push_alert_config ─────────────────────────────────────────────────────
drop policy if exists "Admin only" on public.push_alert_config;
create policy "push_alert_config_admin_full"
on public.push_alert_config
for all to public
using (is_admin())
with check (is_admin());

-- ── B) Unlock the 5 zero-policy tables ───────────────────────────────────────
-- properties (job sites): admin+office manage; workers may read (start sessions).
drop policy if exists "properties_admin_full"   on public.properties;
drop policy if exists "properties_office_full"  on public.properties;
drop policy if exists "properties_worker_read"  on public.properties;
create policy "properties_admin_full"  on public.properties for all to public
  using (is_admin()) with check (is_admin());
create policy "properties_office_full" on public.properties for all to public
  using (current_user_role() = 'office'::user_role_enum)
  with check (current_user_role() = 'office'::user_role_enum);
create policy "properties_worker_read" on public.properties for select to public
  using (current_user_role() = 'worker'::user_role_enum);

-- property_expenses: admin + office only.
drop policy if exists "property_expenses_admin_full"  on public.property_expenses;
drop policy if exists "property_expenses_office_full" on public.property_expenses;
create policy "property_expenses_admin_full"  on public.property_expenses for all to public
  using (is_admin()) with check (is_admin());
create policy "property_expenses_office_full" on public.property_expenses for all to public
  using (current_user_role() = 'office'::user_role_enum)
  with check (current_user_role() = 'office'::user_role_enum);

-- lease_agreements: admin + office only.
drop policy if exists "lease_agreements_admin_full"  on public.lease_agreements;
drop policy if exists "lease_agreements_office_full" on public.lease_agreements;
create policy "lease_agreements_admin_full"  on public.lease_agreements for all to public
  using (is_admin()) with check (is_admin());
create policy "lease_agreements_office_full" on public.lease_agreements for all to public
  using (current_user_role() = 'office'::user_role_enum)
  with check (current_user_role() = 'office'::user_role_enum);

-- payslip_items: admin + office manage; a worker may read items of their own payslip.
drop policy if exists "payslip_items_admin_full"  on public.payslip_items;
drop policy if exists "payslip_items_office_full" on public.payslip_items;
drop policy if exists "payslip_items_view_own"    on public.payslip_items;
create policy "payslip_items_admin_full"  on public.payslip_items for all to public
  using (is_admin()) with check (is_admin());
create policy "payslip_items_office_full" on public.payslip_items for all to public
  using (current_user_role() = 'office'::user_role_enum)
  with check (current_user_role() = 'office'::user_role_enum);
create policy "payslip_items_view_own" on public.payslip_items for select to public
  using (exists (
    select 1 from public.payslips p
    where p.id = payslip_items.payslip_id and p.user_id = auth.uid()
  ));

-- hourly_salary_overrides: admin + office manage; a worker may read their own.
drop policy if exists "hourly_salary_overrides_admin_full"  on public.hourly_salary_overrides;
drop policy if exists "hourly_salary_overrides_office_full" on public.hourly_salary_overrides;
drop policy if exists "hourly_salary_overrides_view_own"    on public.hourly_salary_overrides;
create policy "hourly_salary_overrides_admin_full"  on public.hourly_salary_overrides for all to public
  using (is_admin()) with check (is_admin());
create policy "hourly_salary_overrides_office_full" on public.hourly_salary_overrides for all to public
  using (current_user_role() = 'office'::user_role_enum)
  with check (current_user_role() = 'office'::user_role_enum);
create policy "hourly_salary_overrides_view_own" on public.hourly_salary_overrides for select to public
  using (user_id = auth.uid());

-- ── C) expenses + project_expenses: office management + worker "see own" ─────
-- (admin_full_access / worker_insert / worker_update already exist — keep them.)
drop policy if exists "expenses_office_full"       on public.expenses;
drop policy if exists "expenses_worker_select_own" on public.expenses;
create policy "expenses_office_full" on public.expenses for all to public
  using (current_user_role() = 'office'::user_role_enum)
  with check (current_user_role() = 'office'::user_role_enum);
create policy "expenses_worker_select_own" on public.expenses for select to public
  using (recorded_by = auth.uid());

drop policy if exists "project_expenses_office_full" on public.project_expenses;
create policy "project_expenses_office_full" on public.project_expenses for all to public
  using (current_user_role() = 'office'::user_role_enum)
  with check (current_user_role() = 'office'::user_role_enum);
