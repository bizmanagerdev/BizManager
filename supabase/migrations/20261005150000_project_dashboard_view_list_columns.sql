-- ════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE ONLY. Adds columns to project_dashboard_view; changes no row,
-- no existing column, and nobody's access.
--
-- WHY THIS IS NEEDED
-- The /projects list (app/(app)/projects/loadProjects.ts) read the page's
-- projects from project_dashboard_view, then — in a second round trip, once
-- it knew their ids — read the same projects again from project_financials_view
-- (collected / pending / overdue / outstanding amounts, the customer price,
-- billed expenses, next due date), from projects (payment terms, due date,
-- no-charge, branch) and the customer's phone from customers. The view already
-- joins project_financials_view, so that second trip recomputed every
-- project's financials a second time just to read columns the view leaves out.
-- Measured 2026-10-05 in production: the list view ~200 ms, then the second
-- trip ~150 ms more, on every /projects load and every background tab load.
--
-- THE FIX
-- The view returns those columns too, appended at the end (CREATE OR REPLACE
-- VIEW can add columns after the existing ones, so operations_dashboard_view,
-- which reads this view, is unaffected). The list then needs one query.
--   from project_financials_view (already joined): customer_total_price,
--     expenses_billed, collected_amount, pending_amount, overdue_amount,
--     outstanding_amount, next_due_date
--   from projects (joined by its primary key):     payment_terms, due_date,
--     no_charge, branch_id
--   from customers (joined by its primary key):    phone AS customer_phone
-- Both new joins are on a primary key, so no project appears twice and the
-- row set is exactly what it was.
--
-- ACCESS IS UNCHANGED. The view stays security_invoker: every column is read
-- with the caller's own RLS, exactly as the separate queries were. A customer
-- the caller may not read gives a null phone — as the separate query gave no
-- row. The app falls back to the old two-step read if these columns are
-- missing, so it works the same before and after this runs.
--
-- ROLLBACK: supabase/rollbacks/20261005150000_project_dashboard_view_list_columns.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.project_dashboard_view
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
    pt.open_tasks,
    pf.customer_total_price,
    pf.expenses_billed,
    pf.collected_amount,
    pf.pending_amount,
    pf.overdue_amount,
    pf.outstanding_amount,
    pf.next_due_date,
    p.payment_terms,
    p.due_date,
    p.no_charge,
    p.branch_id,
    c.phone AS customer_phone
   FROM project_overview_view po
     LEFT JOIN project_financials_view pf ON pf.id = po.id
     LEFT JOIN project_task_progress_view pt ON pt.project_id = po.id
     LEFT JOIN projects p ON p.id = po.id
     LEFT JOIN customers c ON c.id = po.customer_id;
