-- ════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE ONLY. Zero change to who can read or write what.
--
-- Follow-up to 20260902103000_rls_initplan_perf.sql, which wrapped auth.uid()
-- INSIDE current_user_role(). That made each call cheaper but did not stop the
-- function being CALLED once per row. This migration fixes the call sites.
--
-- WHY /projects?view=closed TIMED OUT AND /projects DID NOT
-- Both tabs read project_financials_view (app/(app)/projects/loadProjects.ts).
-- The default tab matches 3 projects; the closed tab matches 40. Same query
-- shape, ~13x the rows — the closed tab was simply the first one heavy enough
-- to cross statement_timeout.
--
-- WHAT MAKES EACH ROW EXPENSIVE
-- Permissive policies are OR'd, so a plain SELECT on public.projects evaluates
-- ALL of these for EVERY candidate row:
--   is_admin()                        -> current_user_role() -> query users
--   current_user_role() = 'office'    -> query users
--   current_user_role() = 'worker'    -> query users
--   exists (... attendance_sessions ...)
--   exists (... tasks ...)            <- no role guard, runs for everyone
-- Written bare, each is re-evaluated per row. Wrapped in a scalar subquery,
-- `(select f())` becomes an InitPlan: evaluated ONCE per statement and reused.
-- Identical result, one evaluation instead of N. This is Supabase's documented
-- remedy, and it is what makes RLS on a security_invoker view affordable.
--
-- WHY ALTER POLICY, NOT DROP + CREATE
-- pg_policies exposed `qual` (USING) but not with_check. Recreating an ALL
-- policy without knowing its real WITH CHECK could silently widen or break the
-- write path. `alter policy ... using (...)` rewrites ONLY the USING clause and
-- leaves WITH CHECK exactly as it is. Every expression below is the live qual
-- copied verbatim, with `(select ...)` wrapping added and nothing else changed.
--
-- Correlated EXISTS subqueries (attendance_sessions / tasks / orders) reference
-- the outer row, so they cannot be hoisted — they are left in place. Their
-- cost is addressed by the supporting indexes in section 2, and by the role
-- guards above them now short-circuiting after a single evaluation.
--
-- PROVENANCE: authored and applied against prod in a separate session (a
-- different machine/git identity diagnosing the same incident); saved here
-- verbatim so this repo's migration history matches what's actually live.
-- Not re-verified independently beyond a read-through in this session.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Hoist the uncorrelated identity checks out of the per-row loop ────────

-- projects
alter policy "admin_full_access" on public.projects
using ((select public.is_admin()));

alter policy "office_view_projects" on public.projects
using ((select public.current_user_role()) = 'office'::user_role_enum);

alter policy "office_update_projects" on public.projects
using ((select public.current_user_role()) = 'office'::user_role_enum);

alter policy "projects_worker_view_own_sessions" on public.projects
using (
  (select public.current_user_role()) = 'worker'::user_role_enum
  and exists (
    select 1
    from attendance_sessions s
    where s.project_id = projects.id
    and s.user_id = (select public.current_app_user_id())
  )
);

-- No role guard on this one, so before this change it ran the tasks lookup for
-- every project row for every caller, admin and office included.
alter policy "worker_view_assigned_projects" on public.projects
using (
  exists (
    select 1
    from tasks t
    where t.project_id = projects.id
    and t.assigned_user_id = (select auth.uid())
  )
);

-- expenses
alter policy "admin_full_access" on public.expenses
using ((select public.is_admin()));

alter policy "expenses_office_full" on public.expenses
using ((select public.current_user_role()) = 'office'::user_role_enum);

alter policy "expenses_worker_select_own" on public.expenses
using (recorded_by = (select auth.uid()));

alter policy "worker_update_own_expenses" on public.expenses
using (recorded_by = (select auth.uid()));

-- project_expenses
alter policy "admin_full_access" on public.project_expenses
using ((select public.is_admin()));

alter policy "project_expenses_office_full" on public.project_expenses
using ((select public.current_user_role()) = 'office'::user_role_enum);

-- payments
alter policy "admin_full_access_payments" on public.payments
using ((select public.is_admin()));

alter policy "payments_office_full" on public.payments
using ((select public.current_user_role()) = 'office'::user_role_enum);

alter policy "payments_worker_select_order" on public.payments
using (
  (select public.current_user_role()) = 'worker'::user_role_enum
  and order_id is not null
  and exists (
    select 1
    from orders o
    where o.id = payments.order_id
    and order_status_is_open(o.status)
  )
);

-- ── 2. Indexes backing the correlated EXISTS subqueries and the view joins ───
-- These are the lookups the policies above still perform per row. Without them
-- each one is a sequential scan of the child table.
create index if not exists tasks_project_assigned_idx
on public.tasks (project_id, assigned_user_id);

create index if not exists attendance_sessions_project_user_idx
on public.attendance_sessions (project_id, user_id);

create index if not exists expenses_recorded_by_idx
on public.expenses (recorded_by);

create index if not exists payments_order_id_idx
on public.payments (order_id);

create index if not exists project_expenses_project_idx
on public.project_expenses (project_id);

create index if not exists project_expenses_expense_idx
on public.project_expenses (expense_id);

-- ── 3. Drop the redundant index from the previous migration ──────────────────
-- users_auth_user_id_unique already covers this column; 20260902103000 added
-- users_auth_user_id_idx only because the unique one is declared in frozen
-- db/sql and appeared unapplied. pg_indexes confirms it is live, so the
-- duplicate is pure write overhead.
drop index if exists public.users_auth_user_id_idx;
