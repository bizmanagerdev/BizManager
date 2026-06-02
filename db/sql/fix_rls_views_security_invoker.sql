-- ════════════════════════════════════════════════════════════════════════════
-- VIEW HARDENING — security_invoker  (TEST BEFORE/AFTER on a WORKER login)
-- Run in the Supabase SQL Editor. Run fix_rls_access.sql FIRST (office/locked
-- tables), so admin+office have RLS access to every table these views join.
--
-- WHAT IT DOES: flips the 22 SECURITY DEFINER views (flagged ERROR by the
-- Supabase linter, and readable via the public anon key) to security_invoker,
-- so they respect the CALLER's RLS instead of bypassing it.
--
-- IMPACT:
--   • admin / office  -> NO change (they have RLS access to all underlying tables).
--   • anon (public)   -> can no longer read these views (closes the leak). GOOD.
--   • worker          -> these views now return only rows the worker is allowed
--     to see. Because they join customers/users (which workers can't read),
--     worker-visible pages that read them (/sales, /projects/[id], dashboard)
--     will show EMPTY lists for those sections. No errors/crashes — just no rows.
--
-- DECISION: if workers are NOT supposed to see sales/order/financial data, this
-- is exactly the fix you want. If a worker delivery flow relies on /sales lists,
-- either skip the order/delivery views below, or add worker-scoped policies to
-- customers (and users) so those views resolve their permitted rows.
--
-- TEST: log in as a worker before & after; confirm their real screens (tasks,
-- profile, sessions, assigned projects/orders) still show what they should.
-- ════════════════════════════════════════════════════════════════════════════

-- Financial / payroll / customer aggregates — admin/office only; safe to flip.
alter view public.project_financials_view        set (security_invoker = on);
alter view public.customer_sales_summary_view     set (security_invoker = on);
alter view public.customer_activity_view          set (security_invoker = on);
alter view public.customer_open_balance_view      set (security_invoker = on);
alter view public.cash_flow_entries_view          set (security_invoker = on);
alter view public.cash_flow_view                  set (security_invoker = on);
alter view public.collections_view                set (security_invoker = on);
alter view public.financial_project_view          set (security_invoker = on);
alter view public.financial_payments_view         set (security_invoker = on);
alter view public.order_financials_view           set (security_invoker = on);
alter view public.sales_financials_view           set (security_invoker = on);
alter view public.customer_overview_view          set (security_invoker = on);
alter view public.customer_orders_view            set (security_invoker = on);
alter view public.project_expenses_summary_view   set (security_invoker = on);
alter view public.worker_balance_summary_view     set (security_invoker = on);
alter view public.project_worker_balance_view     set (security_invoker = on);
alter view public.monthly_worker_balance_view     set (security_invoker = on);
alter view public.worker_debt_items_view          set (security_invoker = on);
alter view public.operations_dashboard_view       set (security_invoker = on);

-- The 3 views workers MIGHT reach via /sales (order/delivery lists) + new-order.
-- These are the ones to watch in the worker test. Comment them out if a worker
-- delivery flow needs them and you haven't added worker-scoped customer access.
alter view public.order_overview_view             set (security_invoker = on);
alter view public.delivery_overview_view          set (security_invoker = on);
alter view public.products_with_last_used         set (security_invoker = on);
