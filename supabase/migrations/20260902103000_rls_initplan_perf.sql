-- ════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE ONLY. Zero change to who can read or write what.
--
-- WHY THIS IS NEEDED
-- 20260901000000_fix_financial_views_security_invoker_leak.sql correctly closed
-- a real anon leak by flipping 10 financial/payroll views to
-- `security_invoker = on`. That fix must stay. But it also means those views now
-- evaluate the RLS policies of every underlying table, for every row — where
-- before they ran as the view owner and skipped RLS entirely. The policies were
-- never written to be evaluated at that volume, and /projects started returning
--
--   canceling statement due to statement timeout
--
-- from `project_financials_view` (read by app/(app)/projects/loadProjects.ts).
--
-- THE ACTUAL COST
-- `auth.uid()` is not a cheap accessor: it reads `request.jwt.claims` out of a
-- GUC and parses it as JSON on EVERY call. Written bare in a policy qual —
--
--   using (exists (select 1 from public.users u where u.auth_user_id = auth.uid() ...))
--
-- Postgres re-runs that JSON parse, plus the `users` lookup, once per candidate
-- row, per policy, per joined table. Wrapping it in a scalar subquery
-- `(select auth.uid())` turns it into an InitPlan: evaluated ONCE per statement
-- and reused. Same rows out, one evaluation instead of N. This is Supabase's own
-- documented remedy for exactly this pattern.
--
-- SCOPE
-- `current_user_role()` is the shared building block behind ~98 policy
-- references schema-wide, so fixing its body reaches nearly every policy without
-- editing them one by one. The two tags/entity_tags policies added on 2026-09-01
-- inline the same `exists (...)` shape directly, so they are rewritten here too.
--
-- SEMANTICS ARE UNCHANGED. `(select auth.uid())` returns exactly what
-- `auth.uid()` returns; the active/system_access conditions from
-- 20260901100918 are preserved verbatim. This migration only changes HOW OFTEN
-- the same predicate is evaluated, never its result.
--
-- Idempotent (create or replace / drop-if-exists / if not exists).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The shared identity helper ────────────────────────────────────────────
-- Body is byte-for-byte the definition from 20260901100918 except that
-- auth.uid() is now wrapped in a scalar subquery.
create or replace function public.current_user_role()
returns user_role_enum
language sql
stable security definer
set search_path to 'public'
as $function$
  select role
  from public.users
  where auth_user_id = (select auth.uid())
    and active = true
    and coalesce(system_access, false) = true;
$function$;

-- ── 2. Index the column every one of those lookups filters on ────────────────
-- `users.auth_user_id` is the join key for current_user_role() and for every
-- inline `exists (select 1 from public.users u where u.auth_user_id = ...)`
-- policy. The only definition of this index lives in
-- db/sql/decouple_users_from_auth_for_no_access_workers.sql — and db/sql is
-- frozen and was never applied to prod, so it does not exist there. Deliberately
-- NOT unique: the db/sql version was, but a duplicate auth_user_id would then
-- fail this migration, and dedupe is not this file's job.
create index if not exists users_auth_user_id_idx
  on public.users (auth_user_id);

-- ── 3. The two policies that inline the same predicate ───────────────────────
-- From 20260901092153_tighten_tags_entity_tags_rls.sql. The access condition is
-- carried over unchanged — only the InitPlan wrapping is added. entity_tags in
-- particular is a join table, so it is read at exactly the row volume where
-- per-row re-evaluation hurts most.
drop policy if exists "Read tags" on public.tags;
create policy "Read tags" on public.tags
  for select to authenticated
  using ((select exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.role in ('admin', 'office', 'worker')
      and u.active = true
      and coalesce(u.system_access, false) = true
  )));

drop policy if exists "Authenticated use entity_tags" on public.entity_tags;
create policy "Authenticated use entity_tags" on public.entity_tags
  for all to authenticated
  using ((select exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.role in ('admin', 'office', 'worker')
      and u.active = true
      and coalesce(u.system_access, false) = true
  )))
  with check ((select exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.role in ('admin', 'office', 'worker')
      and u.active = true
      and coalesce(u.system_access, false) = true
  )));
