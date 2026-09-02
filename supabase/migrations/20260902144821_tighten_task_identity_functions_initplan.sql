-- ════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE ONLY. Zero change to who can read or write what.
--
-- Third instance of the same bug class as current_user_role()/
-- current_app_user_id() (see 20260902103000/20260902125022): a shared identity
-- helper with a bare, unwrapped auth.uid() call, re-parsed from the
-- request.jwt.claims GUC on every invocation instead of once per statement.
--
-- Found 2026-09-02 while chasing continued slowness on nav-counts/page-alerts
-- (both read `reminders`) even after the requireRouteAccess() latency fix and
-- the other two InitPlan migrations were confirmed deployed. `reminders`' RLS
-- (reminders_self_or_task_select/update) calls task_can_access(task_id), which
-- calls task_is_office_admin() and task_current_user_id() — both defined in
-- the legacy, untracked-but-live db/sql/tasks_trello_upgrade.sql with bare
-- auth.uid(). task_can_access/task_can_manage take a per-row task_id argument
-- so they can't themselves be hoisted into an InitPlan the way a bare
-- current_user_role() call can — but wrapping the auth.uid() INSIDE the two
-- base functions they call still lets Postgres cache that inner lookup once
-- per statement, same mechanism as the earlier fixes.
--
-- Bodies are byte-for-byte the live definitions except auth.uid() is wrapped
-- in a scalar subquery. Idempotent (create or replace).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.task_current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $function$
  select id from public.users where auth_user_id = (select auth.uid()) limit 1;
$function$;

create or replace function public.task_is_office_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.role in ('admin', 'office')
      and u.active = true
      and coalesce(u.system_access, false) = true
  );
$function$;
