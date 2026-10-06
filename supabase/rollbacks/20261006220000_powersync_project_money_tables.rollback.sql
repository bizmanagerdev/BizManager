-- ROLLBACK for supabase/migrations/20261006220000_powersync_project_money_tables.sql

do $$
declare
  t text;
begin
  foreach t in array array[
    'expenses', 'project_expenses', 'payslips', 'payroll_periods', 'salary_agreements',
    'worker_payments', 'worker_payment_allocations'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync drop table public.%I', t);
    end if;
  end loop;
end $$;

revoke select on table
  public.expenses,
  public.project_expenses,
  public.payslips,
  public.payroll_periods,
  public.salary_agreements,
  public.worker_payments,
  public.worker_payment_allocations
from powersync_role;
