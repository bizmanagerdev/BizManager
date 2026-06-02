-- ════════════════════════════════════════════════════════════════════════════
-- RLS / GRANTS AUDIT  —  run each block in the Supabase SQL Editor.
-- (The SQL Editor runs as a superuser, so it sees EVERYTHING regardless of RLS.)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) ALL POLICIES (the main one — "find all of them") ─────────────────────
-- cmd: SELECT/INSERT/UPDATE/DELETE/ALL · permissive: PERMISSIVE(OR) vs RESTRICTIVE(AND)
select
  tablename,
  policyname,
  cmd,
  permissive,
  roles,
  qual        as using_expr,
  with_check  as with_check_expr
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- ── 2) RLS STATUS + POLICY COUNT for EVERY table ────────────────────────────
-- Spot the danger cases: rls_enabled = true AND policy_count = 0  -> nobody can
-- touch it; rls_enabled = false -> table is wide open (any logged-in user).
select
  c.relname                                              as table_name,
  c.relrowsecurity                                       as rls_enabled,
  c.relforcerowsecurity                                  as rls_forced,
  (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by rls_enabled desc, policy_count, table_name;

-- ── 3) TABLE-LEVEL GRANTS (what anon / authenticated / service_role can do) ──
select
  table_name,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
group by table_name, grantee
order by table_name, grantee;

-- ── 4) INCONSISTENCY HUNTER ─────────────────────────────────────────────────
-- Your repo links users to auth via `auth_user_id = auth.uid()`. Any policy that
-- instead uses `id = auth.uid()` is comparing the app PK to the auth uid and will
-- (almost certainly) match NO ONE. These rows are bugs:
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual ilike '%where id = auth.uid()%' or with_check ilike '%where id = auth.uid()%')
order by tablename;

-- ── 5) HELPER FUNCTIONS used inside policies (e.g. current_user_role) ────────
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_functiondef(p.oid)                 as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('current_user_role', 'is_admin', 'is_staff', 'auth_role');
