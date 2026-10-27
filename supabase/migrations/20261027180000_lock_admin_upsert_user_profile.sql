-- ════════════════════════════════════════════════════════════════════════════
-- Only an admin can create or change a user profile (security audit,
-- 2026-10-27; owner: "lock the admin function and drop the self-insert policy").
--
-- Two ways let anyone with a Supabase login make himself admin — and sign-up
-- was open, with new accounts confirmed at once:
-- 1. admin_upsert_user_profile is SECURITY DEFINER (it bypasses RLS) and checked
--    nothing: called straight through /rest/v1/rpc it wrote any user's role,
--    active, system_access and auth_user_id. Both versions could be called
--    signed out too (anon and PUBLIC kept EXECUTE).
--    Now each version starts with require_app_role(array['admin']) — the one
--    line marked "-- guard: require_app_role", the body otherwise unchanged
--    (20261004170000_guard_definer_functions.sql missed this function) — and
--    anon / PUBLIC lose EXECUTE. Signed-in users keep it: the app calls it as
--    the signed-in admin (api/users/create, api/payroll/workers/update and
--    /delete, all admin-only routes). The service-role key and direct database
--    sessions still pass the check.
-- 2. The users policy "policy users_can_insert_self" let a login insert its own
--    profile with any role — admin included. Nothing in the app inserts users
--    rows as the user (admins create them through the function above), so it
--    is dropped.
--
-- Before running on live, the old definitions, their EXECUTE lists and the
-- policy were saved in backup.security_20261027_admin_upsert.
--
-- ROLLBACK: supabase/rollbacks/20261027180000_lock_admin_upsert_user_profile.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. the admin check, and no EXECUTE for anon / PUBLIC ─────────────────────
do $mig$
declare
  v_name text;
  v_fn regprocedure;
  v_def text;
  v_new text;
begin
  foreach v_name in array array[
    'public.admin_upsert_user_profile(uuid,uuid,text,text,text,text,boolean,boolean)',
    'public.admin_upsert_user_profile(uuid,uuid,text,text,text,text,boolean,boolean,text,text,text,jsonb)'
  ] loop
    v_fn := to_regprocedure(v_name);
    continue when v_fn is null;

    v_def := replace(pg_get_functiondef(v_fn), E'\r\n', E'\n');
    if position('require_app_role' in v_def) = 0 then
      v_new := regexp_replace(
        v_def,
        '\mbegin\M(\s+)(if nullif\(trim\(coalesce\(p_full_name)',
        'begin\1perform public.require_app_role(array[''admin'']::public.user_role_enum[]);  -- guard: require_app_role\1\2'
      );
      if v_new = v_def then
        raise exception 'admin check not placed in %', v_name;
      end if;
      execute v_new;
    end if;

    execute format('revoke execute on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated, service_role', v_fn);
  end loop;
end
$mig$;

-- ── 2. no self-insert into users ────────────────────────────────────────────
drop policy if exists "policy users_can_insert_self" on public.users;
