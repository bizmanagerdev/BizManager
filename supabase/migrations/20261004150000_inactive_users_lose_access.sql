-- ════════════════════════════════════════════════════════════════════════════
-- A turned-off user loses database access immediately, not when their login
-- eventually expires.
--
-- WHY THIS IS NEEDED
-- Turning a user off (active = false / system_access = false / role
-- worker_no_access) only changed their profile. requireProfile() and
-- requireRouteAccess() then kept them out of the app's own pages and routes,
-- but nothing ended their Supabase session, so a direct call to Supabase's
-- REST API kept working. Confirmed live 2026-10-04, three gaps:
--
--   1. current_app_user_id() and task_current_user_id() never checked
--      `active`. 20260901100918_tighten_current_user_role_active_check fixed
--      current_user_role() for exactly this reason but missed these two, and
--      every "own rows" policy is built on them: payslips, salary agreements,
--      worker payments, attendance, the worker's own bonus requests, tasks
--      assigned to them, reminders, task comments/members.
--   2. Seven policies let ANY signed-in user through (`using (true)` for
--      authenticated): tasks select/insert, vehicles, vehicle mileage,
--      business_settings select, audit_logs insert. Plus a handful compare
--      auth.uid() without an active check (expenses, notifications,
--      projects/project_expenses for assigned workers).
--   3. Their login itself stayed valid: the refresh token kept issuing new
--      access tokens indefinitely. (Fixed in the app: lib/auth/loginAccess.ts
--      bans the auth user when access is turned off. Step 3 below backfills
--      the one account turned off before that existed.)
--
-- THE FIX
--   1. Tighten the two helpers the same way current_user_role() was.
--   2. Add ONE restrictive policy per table — "the caller must be an active
--      user with system access" — instead of editing dozens of permissive
--      ones. Restrictive policies are ANDed with every permissive policy on
--      the table, so this closes all of gap 2 at once and keeps future
--      permissive policies from reopening it. (tasks already has one
--      restrictive policy, tasks_privacy_restrict; both now apply.)
--      `users` is deliberately left out: reading your own row is how
--      requireProfile() learns you are inactive and sends you to /no-access,
--      and sign-up writes the first row before any profile is active.
--   3. Ban the auth users of accounts that are already turned off.
--
-- Storage needs nothing: every storage.objects policy already goes through
-- current_user_role() or checks users.active itself.
--
-- WHAT THIS DOES NOT COVER
-- SECURITY DEFINER functions bypass RLS. A few callable ones check neither role
-- nor active (create_sales_order, update_sales_order, release_order_inventory,
-- set_audit_logging, and a few read-only stats functions). That is a wider
-- authorization question — an ACTIVE worker can call them directly too — and
-- is left for its own change.
--
-- NEW TABLES: give any new RLS table the same `active_users_only` policy.
--
-- This is a TIGHTENING, not a widening: every account that passes
-- requireRouteAccess() already satisfies current_user_role() is not null, so
-- no real caller loses anything. Service-role callers (crons, the admin
-- client) bypass RLS and are unaffected; anon (public forms) is unaffected.
--
-- Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. identity helpers ─────────────────────────────────────────────────────
-- Same bodies as 20260902125022 / 20260902144821, plus the active/system_access
-- condition current_user_role() already has. An inactive caller resolves to
-- NULL, which matches no `user_id = …` comparison; request_attendance_session_edit
-- already rejects a NULL caller with 'not_authenticated'.
create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $function$
  select u.id from public.users u
  where u.auth_user_id = (select auth.uid())
    and u.active = true
    and coalesce(u.system_access, false) = true
  limit 1;
$function$;

create or replace function public.task_current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $function$
  select id from public.users
  where auth_user_id = (select auth.uid())
    and active = true
    and coalesce(system_access, false) = true
  limit 1;
$function$;

-- ── 2. one restrictive "active users only" policy per table ────────────────
-- `(select …)` so Postgres evaluates the helper once per statement (initPlan),
-- not once per row — see 20260902103000_rls_initplan_perf.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relname <> 'users'
  loop
    execute format('drop policy if exists active_users_only on public.%I', t.relname);
    execute format(
      'create policy active_users_only on public.%I as restrictive for all to authenticated '
      'using ((select public.current_user_role()) is not null) '
      'with check ((select public.current_user_role()) is not null)',
      t.relname
    );
  end loop;
end
$$;

-- ── 3. ban the logins of accounts already turned off ───────────────────────
-- From now on the app does this itself (lib/auth/loginAccess.ts). This catches
-- accounts turned off before that — one, at the time of writing. ~100 years is
-- GoTrue's effective "forever"; turning the user back on in the app lifts it.
update auth.users au
set banned_until = now() + interval '100 years'
from public.users u
where u.auth_user_id = au.id
  and not (u.active and coalesce(u.system_access, false) and u.role <> 'worker_no_access')
  and (au.banned_until is null or au.banned_until <= now());
