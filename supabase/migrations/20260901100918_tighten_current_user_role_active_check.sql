-- ════════════════════════════════════════════════════════════════════════════
-- Close a schema-wide RLS gap in the shared identity helper functions.
--
-- WHY THIS IS NEEDED
-- `current_user_role()` (and `is_admin()`, which is just `current_user_role()
-- = 'admin'`) is the building block almost every non-trivial RLS policy in
-- this schema is written against — not just `products`, but anywhere a policy
-- reads "if the caller is office/admin/worker, allow X". Confirmed live
-- (2026-09-01), its actual definition never checked `active` or
-- `system_access` — it only resolved whatever role a user's row has:
--
--   select role from public.users where auth_user_id = auth.uid();
--
-- Meaning a deactivated account, a `system_access = false` account, or a
-- `worker_no_access` role could still authenticate a Supabase session and,
-- via any policy built on `current_user_role()`/`is_admin()`, read or write
-- through Supabase's REST API directly — bypassing the active/system_access
-- check every app route enforces via `requireRouteAccess()`. This was low
-- practical risk only because every table access happened to be routed
-- through an app API first; it becomes a real gap the moment ANY table is
-- read directly from the client (the direct-to-Supabase routes initiative).
--
-- THE FIX
-- Tighten the function itself, once. Every policy built on
-- `current_user_role()` or `is_admin()` inherits the fix automatically —
-- no per-table policy edits needed, now or for any future table. A
-- deactivated/no-system-access account now resolves to NULL here, which
-- fails every `= 'admin'` / `= 'office'` / `= 'worker'` comparison and every
-- `is_admin()` check schema-wide.
--
-- This is a TIGHTENING, not a widening: any account passing `requireRouteAccess`
-- today already satisfies active=true and system_access=true, so no real
-- caller loses anything. Only a deactivated/no-access session hitting
-- Supabase directly stops being able to piggyback on a stale role.
--
-- Idempotent (CREATE OR REPLACE). db/sql is frozen; new schema goes here.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.current_user_role()
returns user_role_enum
language sql
stable security definer
set search_path to 'public'
as $function$
  select role
  from public.users
  where auth_user_id = auth.uid()
    and active = true
    and coalesce(system_access, false) = true;
$function$;

-- is_admin() needs no change — it already calls current_user_role() and
-- inherits the fix for free. Re-stated here only so this file is a complete
-- record of the live definition, not because the body changes.
create or replace function public.is_admin()
returns boolean
language sql
stable
as $function$
  select public.current_user_role() = 'admin';
$function$;
