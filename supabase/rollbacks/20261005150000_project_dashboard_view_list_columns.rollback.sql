-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for supabase/migrations/20261005150000_project_dashboard_view_list_columns.sql
--
-- Usually not needed: the added columns are only read when present, and code
-- from before that migration simply doesn't select them. Run this in the SQL
-- editor only to put the view back exactly as it was.
--
-- A view can't lose columns through CREATE OR REPLACE, so both views are
-- dropped and recreated — operations_dashboard_view reads this one. Both
-- definitions, options and grants are the live ones, captured 2026-10-05.
-- One transaction: either both come back or nothing changes.
-- ════════════════════════════════════════════════════════════════════════════

begin;

drop view public.operations_dashboard_view;
drop view public.project_dashboard_view;

create view public.project_dashboard_view
with (security_invoker = on) as
 SELECT po.id,
    po.name,
    po.status,
    po.project_type,
    po.start_date,
    po.end_date,
    po.agreed_base_price,
    po.actual_price,
    po.expenses_billed_separately,
    po.customer_id,
    po.customer_name,
    po.project_manager_id,
    po.project_manager_name,
    po.created_at,
    po.updated_at,
    pf.total_expenses,
    pf.gross_profit,
    pt.total_tasks,
    pt.completed_tasks,
    pt.open_tasks
   FROM project_overview_view po
     LEFT JOIN project_financials_view pf ON pf.id = po.id
     LEFT JOIN project_task_progress_view pt ON pt.project_id = po.id;

create view public.operations_dashboard_view
with (security_invoker = on) as
 WITH month_bounds AS (
         SELECT date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date AS current_month_start,
            (date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) + '1 mon'::interval)::date AS next_month_start,
            (date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) - '1 mon'::interval)::date AS previous_month_start
        ), cash_flow_totals AS (
         SELECT COALESCE(sum(
                CASE
                    WHEN cfe.type = 'income'::text AND cfe.entry_date >= mb_1.current_month_start AND cfe.entry_date < mb_1.next_month_start THEN cfe.amount
                    ELSE 0::numeric
                END), 0::numeric) AS monthly_revenue,
            COALESCE(sum(
                CASE
                    WHEN cfe.type = 'income'::text AND cfe.entry_date >= mb_1.previous_month_start AND cfe.entry_date < mb_1.current_month_start THEN cfe.amount
                    ELSE 0::numeric
                END), 0::numeric) AS previous_month_revenue,
            COALESCE(sum(
                CASE
                    WHEN cfe.type = 'expense'::text AND cfe.entry_date >= mb_1.current_month_start AND cfe.entry_date < mb_1.next_month_start THEN cfe.amount
                    ELSE 0::numeric
                END), 0::numeric) AS monthly_expenses,
            COALESCE(sum(
                CASE
                    WHEN cfe.type = 'expense'::text AND cfe.entry_date >= mb_1.previous_month_start AND cfe.entry_date < mb_1.current_month_start THEN cfe.amount
                    ELSE 0::numeric
                END), 0::numeric) AS previous_month_expenses
           FROM month_bounds mb_1
             LEFT JOIN cash_flow_entries_view cfe ON true
        ), project_counts AS (
         SELECT count(*) AS active_projects_count
           FROM project_dashboard_view pdv
          WHERE lower(COALESCE(pdv.status::text, ''::text)) <> ALL (ARRAY['completed'::text, 'cancelled'::text])
        ), task_counts AS (
         SELECT count(*) FILTER (WHERE lower(COALESCE(tov.status::text, ''::text)) <> ALL (ARRAY['completed'::text, 'cancelled'::text])) AS open_tasks_count,
            count(*) FILTER (WHERE COALESCE(tov.is_overdue, false) = true) AS overdue_tasks_count
           FROM task_overview_view tov
        ), inventory_counts AS (
         SELECT count(*) FILTER (WHERE (COALESCE(i.quantity_on_hand, 0::numeric) - COALESCE(i.quantity_reserved, 0::numeric)) <= 5::numeric) AS low_inventory_count
           FROM inventory i
        )
 SELECT mb.current_month_start AS current_month,
    mb.previous_month_start AS previous_month,
    cft.monthly_revenue,
    cft.previous_month_revenue,
    cft.monthly_expenses,
    cft.previous_month_expenses,
    pc.active_projects_count,
    tc.open_tasks_count,
    tc.overdue_tasks_count,
    ic.low_inventory_count
   FROM month_bounds mb
     CROSS JOIN cash_flow_totals cft
     CROSS JOIN project_counts pc
     CROSS JOIN task_counts tc
     CROSS JOIN inventory_counts ic;

-- The grants both views had (relacl, 2026-10-05).
grant all on public.project_dashboard_view to postgres, anon, authenticated, service_role;
grant all on public.operations_dashboard_view to postgres, anon, authenticated, service_role;

commit;
