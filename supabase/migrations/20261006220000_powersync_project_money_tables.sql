-- ════════════════════════════════════════════════════════════════════════════
-- PowerSync: follow the tables behind each project's money — expenses and
-- their project links, payslips, payroll periods, salary agreements, worker
-- payments and their allocations — so admins' and office's devices can work
-- out project_financials_view and worker_debt_items_view themselves (the
-- projects step). Read-only access for powersync_role; devices get these only
-- through powersync/sync-config.yaml, admins and office only (who read all of
-- them in the app already).
--
-- ROLLBACK: supabase/rollbacks/20261006220000_powersync_project_money_tables.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

grant select on table
  public.expenses,
  public.project_expenses,
  public.payslips,
  public.payroll_periods,
  public.salary_agreements,
  public.worker_payments,
  public.worker_payment_allocations
to powersync_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'expenses', 'project_expenses', 'payslips', 'payroll_periods', 'salary_agreements',
    'worker_payments', 'worker_payment_allocations'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync add table public.%I', t);
    end if;
  end loop;
end $$;
