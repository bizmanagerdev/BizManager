-- ROLLBACK for supabase/migrations/20261015120000_task_overview_view_due_time.sql
--
-- A column can't be dropped with CREATE OR REPLACE, so task_overview_view is
-- recreated as it was before. operations_dashboard_view is built on it (and
-- nothing is built on that one), so it is dropped first and recreated after —
-- without that, the drop fails with "other objects depend on it" (owner ran
-- the first version of this file, 2026-10-15; it changed nothing).
--
-- Definitions, options and grants as saved 2026-10-15: security_invoker on both
-- (the tables' own row rules stay in charge), all privileges to anon,
-- authenticated and service_role — Supabase's defaults. One transaction: it
-- either all happens or none of it does.

begin;

drop view public.operations_dashboard_view;
drop view public.task_overview_view;

create view public.task_overview_view
with (security_invoker = true)
as
select
  t.id as task_id,
  t.subject,
  t.status,
  t.priority,
  t.due_date,
  t.project_id,
  p.name as project_name,
  t.assigned_user_id,
  u.full_name as assigned_user_name,
  t.created_at,
  t.updated_at,
  t.due_date < now() and t.status <> 'done'::task_status_enum as is_overdue
from tasks t
  left join users u on u.id = t.assigned_user_id
  left join projects p on p.id = t.project_id;

create view public.operations_dashboard_view
with (security_invoker = on)
as
with month_bounds as (
  select
    date_trunc('month'::text, israel_today()::timestamp with time zone)::date as current_month_start,
    (date_trunc('month'::text, israel_today()::timestamp with time zone) + '1 mon'::interval)::date as next_month_start,
    (date_trunc('month'::text, israel_today()::timestamp with time zone) - '1 mon'::interval)::date as previous_month_start
), cash_flow_totals as (
  select
    coalesce(sum(case when cfe.type = 'income'::text and cfe.entry_date >= mb_1.current_month_start and cfe.entry_date < mb_1.next_month_start then cfe.amount else 0::numeric end), 0::numeric) as monthly_revenue,
    coalesce(sum(case when cfe.type = 'income'::text and cfe.entry_date >= mb_1.previous_month_start and cfe.entry_date < mb_1.current_month_start then cfe.amount else 0::numeric end), 0::numeric) as previous_month_revenue,
    coalesce(sum(case when cfe.type = 'expense'::text and cfe.entry_date >= mb_1.current_month_start and cfe.entry_date < mb_1.next_month_start then cfe.amount else 0::numeric end), 0::numeric) as monthly_expenses,
    coalesce(sum(case when cfe.type = 'expense'::text and cfe.entry_date >= mb_1.previous_month_start and cfe.entry_date < mb_1.current_month_start then cfe.amount else 0::numeric end), 0::numeric) as previous_month_expenses
  from month_bounds mb_1
    left join cash_flow_entries_view cfe on true
), project_counts as (
  select count(*) as active_projects_count
  from project_dashboard_view pdv
  where lower(coalesce(pdv.status::text, ''::text)) <> all (array['completed'::text, 'cancelled'::text])
), task_counts as (
  select
    count(*) filter (where lower(coalesce(tov.status::text, ''::text)) <> all (array['completed'::text, 'cancelled'::text])) as open_tasks_count,
    count(*) filter (where coalesce(tov.is_overdue, false) = true) as overdue_tasks_count
  from task_overview_view tov
), inventory_counts as (
  select count(*) filter (where (coalesce(i.quantity_on_hand, 0::numeric) - coalesce(i.quantity_reserved, 0::numeric)) <= 5::numeric) as low_inventory_count
  from inventory i
)
select
  mb.current_month_start as current_month,
  mb.previous_month_start as previous_month,
  cft.monthly_revenue,
  cft.previous_month_revenue,
  cft.monthly_expenses,
  cft.previous_month_expenses,
  pc.active_projects_count,
  tc.open_tasks_count,
  tc.overdue_tasks_count,
  ic.low_inventory_count
from month_bounds mb
  cross join cash_flow_totals cft
  cross join project_counts pc
  cross join task_counts tc
  cross join inventory_counts ic;

grant all on public.task_overview_view to anon, authenticated, service_role;
grant all on public.operations_dashboard_view to anon, authenticated, service_role;

commit;
