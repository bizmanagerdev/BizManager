-- ════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE ONLY. Zero change to who can read or write what.
--
-- Same fix as 20260902103000_rls_initplan_perf.sql (current_user_role()/
-- is_admin()), applied to the OTHER shared identity helper that never got it:
-- current_app_user_id() (supabase/migrations/20260810000000_worker_self_service.sql).
-- Its body calls bare `auth.uid()` — re-parsed from the request.jwt.claims GUC
-- on every candidate row, same as current_user_role() was before yesterday.
--
-- WHY THIS ONE MATTERS FOR THE CURRENT INCIDENT
-- current_app_user_id() backs the worker-self-service RLS on
-- attendance_sessions, worker_payments, worker_payment_allocations,
-- salary_agreements, payslips/payslip_items, reminders, and
-- phone_attendance_reports (all defined in 20260810000000_worker_self_service.sql).
-- /financial reads several of these (attendance_sessions, worker_payments,
-- worker_payment_allocations) via worker_debt_items_view — one of the 10 views
-- flipped to security_invoker=on on 2026-09-01. Wrapping current_user_role()
-- alone did not reach this function, so /financial can still time out the
-- same way /projects?view=closed did before its fix.
--
-- Body is byte-for-byte the definition from 20260810000000 except auth.uid()
-- is now wrapped in a scalar subquery — semantics unchanged, evaluated once
-- per statement (InitPlan) instead of once per row.
--
-- Idempotent (create or replace).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $function$
  select u.id from public.users u where u.auth_user_id = (select auth.uid()) limit 1;
$function$;
