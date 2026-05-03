-- Run this in Supabase SQL Editor.
-- One-row operational dashboard summary for the app dashboard.
-- Built only from confirmed sources in this codebase/schema:
--   cash_flow_entries_view
--   project_dashboard_view
--   task_overview_view
--   inventory
--
-- Note:
-- - `unpaid_invoices_count` is not included here yet because the current schema list
--   did not include a confirmed `invoices` table/view shape to build against safely.

create or replace view public.operations_dashboard_view as
with month_bounds as (
  select
    date_trunc('month', current_date)::date as current_month_start,
    (date_trunc('month', current_date) + interval '1 month')::date as next_month_start,
    (date_trunc('month', current_date) - interval '1 month')::date as previous_month_start
),
cash_flow_totals as (
  select
    coalesce(
      sum(case
        when cfe.type = 'income'
         and cfe.entry_date >= mb.current_month_start
         and cfe.entry_date < mb.next_month_start
        then cfe.amount
        else 0
      end),
      0
    )::numeric as monthly_revenue,
    coalesce(
      sum(case
        when cfe.type = 'income'
         and cfe.entry_date >= mb.previous_month_start
         and cfe.entry_date < mb.current_month_start
        then cfe.amount
        else 0
      end),
      0
    )::numeric as previous_month_revenue,
    coalesce(
      sum(case
        when cfe.type = 'expense'
         and cfe.entry_date >= mb.current_month_start
         and cfe.entry_date < mb.next_month_start
        then cfe.amount
        else 0
      end),
      0
    )::numeric as monthly_expenses,
    coalesce(
      sum(case
        when cfe.type = 'expense'
         and cfe.entry_date >= mb.previous_month_start
         and cfe.entry_date < mb.current_month_start
        then cfe.amount
        else 0
      end),
      0
    )::numeric as previous_month_expenses
  from month_bounds mb
  left join public.cash_flow_entries_view cfe on true
),
project_counts as (
  select
    count(*)::bigint as active_projects_count
  from public.project_dashboard_view pdv
  where lower(coalesce(pdv.status, '')) not in (
    'quote',
    'done',
    'completed',
    'cancelled',
    'canceled',
    'archived',
    'closed'
  )
),
task_counts as (
  select
    count(*) filter (
      where lower(coalesce(tov.status, '')) not in ('done', 'completed', 'cancelled', 'canceled')
    )::bigint as open_tasks_count,
    count(*) filter (
      where coalesce(tov.is_overdue, false) = true
    )::bigint as overdue_tasks_count
  from public.task_overview_view tov
),
inventory_counts as (
  select
    count(*) filter (
      where coalesce(i.quantity_on_hand, 0) - coalesce(i.quantity_reserved, 0) <= 5
    )::bigint as low_inventory_count
  from public.inventory i
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

grant select on public.operations_dashboard_view to authenticated;
