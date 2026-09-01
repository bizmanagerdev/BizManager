-- ════════════════════════════════════════════════════════════════════════════
-- CLOSE LIVE DATA LEAK: 10 financial/payroll views are readable by ANYONE with
-- the public anon key (no login required) because they lack security_invoker,
-- so they run as the view owner and bypass RLS entirely for every caller.
--
-- Confirmed live via the anon key before this migration was written: all 10
-- returned real rows (customer names, project financials, salary agreements,
-- worker debt) to a plain unauthenticated REST call.
--
-- 5 of these (project_financials_view, worker_debt_items_view,
-- project_worker_balance_view, order_overview_view, delivery_overview_view)
-- were ALREADY fixed once in db/sql/fix_rls_views_security_invoker.sql (June
-- 2026) but regressed: a later `create or replace view` on each one (routine
-- feature work touches these areas constantly) silently drops the
-- security_invoker reloption unless it's re-specified in the SAME statement.
-- THIS FIX IS NOT REGRESSION-PROOF — any future `create or replace view` on
-- one of these 10 must re-add `with (security_invoker = true)` (or a
-- follow-up `alter view ... set (security_invoker = on)` in the same
-- migration), or the leak reopens silently.
--
-- The other 5 (payroll_period_summary_view, salary_center_worker_overview_view,
-- current_salary_agreements_view, worker_attendance_monthly_view,
-- worker_project_hours_view) are newer payroll/salary-center views created
-- after the June fix and were never covered by it.
--
-- IMPACT (verified 2026-09-01 via a rolled-back dry run against prod,
-- comparing anon / a real worker / a real admin / true unrestricted totals):
--   • admin / office  -> NO change. Every view returned identical row counts
--     to the pre-fix / unrestricted total (they already have `is_admin()` or
--     `current_user_role() = 'office'` ALL policies on every table these
--     views join).
--   • anon (public)   -> drops to 0 rows on all 10. Leak closed.
--   • worker          -> the self-service views (worker_debt_items_view,
--     current_salary_agreements_view, worker_attendance_monthly_view,
--     worker_project_hours_view) correctly narrow to the worker's OWN rows —
--     this is the intended behavior, not a regression.
--   • worker on order_overview_view specifically drops sharply (199 -> 2 rows
--     in the dry run) because its RLS policy is tighter than the old
--     bypass-everything behavior. If the live worker-facing /sales screen
--     reads this view directly, SPOT-CHECK IT with a real worker login after
--     deploying — same caveat the original June fix already flagged for this
--     view. delivery_overview_view is unaffected (2 -> 2 in the dry run).
--   • salary_center_worker_overview_view still returns ALL rows to any single
--     worker even after this fix (35 -> 35) — its underlying table policy is
--     broader than it should be for worker-scoped data. NOT fixed here: this
--     view has zero references in current app code (dead — only ever created
--     via db/sql/create_salary_center_views.sql), so it isn't exploitable
--     through the UI today, but tighten the underlying policy before ever
--     wiring this view up to a worker-facing page.
--
-- Idempotent / safe to re-run (`alter view ... set (...)` on an
-- already-set option is a no-op). Run in the Supabase SQL Editor, or
-- `npm run db:push`.
-- ════════════════════════════════════════════════════════════════════════════

alter view public.project_financials_view            set (security_invoker = on);
alter view public.worker_debt_items_view              set (security_invoker = on);
alter view public.order_overview_view                 set (security_invoker = on);
alter view public.delivery_overview_view              set (security_invoker = on);
alter view public.payroll_period_summary_view         set (security_invoker = on);
alter view public.project_worker_balance_view         set (security_invoker = on);
alter view public.current_salary_agreements_view      set (security_invoker = on);
alter view public.salary_center_worker_overview_view  set (security_invoker = on);
alter view public.worker_attendance_monthly_view      set (security_invoker = on);
alter view public.worker_project_hours_view           set (security_invoker = on);
