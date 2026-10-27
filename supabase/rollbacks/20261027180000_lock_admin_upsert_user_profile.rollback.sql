-- Rollback for 20261027180000_lock_admin_upsert_user_profile.sql.
--
-- This reopens the hole the migration closed: with sign-up on, anyone could
-- make himself admin. Run it only if the admin check breaks adding or editing
-- users, with "Allow new users to sign up" OFF in Supabase Auth.
--
-- The exact definitions from before are in backup.security_20261027_admin_upsert
-- (kind, name, definition, acl).

-- 2. the self-insert policy, as it was.
drop policy if exists "policy users_can_insert_self" on public.users;
create policy "policy users_can_insert_self" on public.users
  as permissive for insert to public
  with check ((id = (select auth.uid())) and (email = ((select auth.jwt()) ->> 'email')));

-- 1. no admin check; anon and PUBLIC may call it again.
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
    v_new := regexp_replace(
      v_def,
      '\s*perform public\.require_app_role\(array\[''admin''\]::public\.user_role_enum\[\]\);  -- guard: require_app_role',
      ''
    );
    if v_new <> v_def then
      execute v_new;
    end if;

    execute format('grant execute on function %s to public, anon, authenticated, service_role', v_fn);
  end loop;
end
$mig$;
