-- ════════════════════════════════════════════════════════════════════════════
-- Fix legacy `id = auth.uid()` identity checks (post users↔auth decoupling)
--
-- When users were decoupled from auth (decouple_users_from_auth_for_no_access_
-- workers.sql), the auth link moved to public.users.auth_user_id and public.
-- users.id became an independent app PK. Most code migrated to auth_user_id,
-- but a few objects still compared the PK to auth.uid(). They work today only
-- because current active logins self-provisioned with id = auth.uid(); they
-- silently deny / mis-role any user whose id <> auth_user_id (e.g. a staff
-- member created via admin_upsert_user_profile). This normalises them.
--
-- Each definition below is byte-for-byte the live one with ONLY the WHERE
-- identity column changed: id -> auth_user_id. Attributes (SECURITY DEFINER,
-- STABLE, search_path) are preserved exactly.
--
-- Deliberately NOT changed here: policy "policy users_can_insert_self" on
-- public.users — it governs first-login self-bootstrap and is coupled to the
-- signup flow, so it's a separate, intentional decision.
--
-- CLI is filtered on the dev machine → apply by pasting this whole file into the
-- Supabase SQL editor. Safe to re-run (create or replace + alter policy).
-- ════════════════════════════════════════════════════════════════════════════

-- current_user_role(): used INSIDE RLS policies, so it must stay SECURITY
-- DEFINER (bypass the users table's own RLS) — preserved.
CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS user_role_enum
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role
  FROM public.users
  WHERE auth_user_id = auth.uid();
$function$;

-- set_audit_logging(): admin-only toggle. Only the admin gate's WHERE changed.
CREATE OR REPLACE FUNCTION public.set_audit_logging(p_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
begin
  -- Only admins may toggle.
  if not exists (
    select 1 from public.users
    where auth_user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'forbidden';
  end if;

  -- Enable/disable each trigger backed by public.log_changes, by exact name,
  -- so we never touch unrelated business triggers on the same table.
  for r in
    select c.relname as table_name, tg.tgname as trigger_name
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and tg.tgfoid = 'public.log_changes'::regproc
      and not tg.tgisinternal
  loop
    execute format(
      'alter table public.%I %s trigger %I',
      r.table_name,
      case when p_enabled then 'enable' else 'disable' end,
      r.trigger_name
    );
  end loop;

  update public.business_settings
    set audit_logging_enabled = p_enabled
    where id = true;

  return p_enabled;
end;
$function$;

-- Self-view policy: broaden from the PK to the auth link. Strictly safe — any
-- login that works today already satisfies auth_user_id = auth.uid() (that's how
-- requireRouteAccess reads the profile), so no one loses access; mismatched
-- future logins gain it.
ALTER POLICY users_can_view_self ON public.users
  USING (auth_user_id = auth.uid());
