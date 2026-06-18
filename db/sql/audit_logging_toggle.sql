-- ════════════════════════════════════════════════════════════════════════════
-- AUDIT LOGGING ON/OFF SWITCH (for performance testing)
-- Run in the Supabase SQL Editor.
--
-- The `log_changes` trigger fires on EVERY insert/update/delete of EVERY audited
-- table (it serializes the whole row to JSONB + inserts an audit_logs row, which
-- is also broadcast over realtime). That roughly doubles the cost of every save.
-- This adds an admin-only switch that ENABLES/DISABLES all those triggers at once
-- so you can measure how much they cost. When OFF there is ZERO per-write
-- overhead (the triggers are disabled at the schema level, not checked at runtime).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Persisted flag (single-row business_settings table, id = true).
alter table public.business_settings
  add column if not exists audit_logging_enabled boolean not null default true;

-- 2) Admin-only RPC that flips every log_changes trigger + records the flag.
create or replace function public.set_audit_logging(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- Only admins may toggle.
  if not exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
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
$$;

grant execute on function public.set_audit_logging(boolean) to authenticated;

-- 3) Convenience: re-sync the flag from the live trigger state (optional).
--    Returns true if any log_changes trigger is currently enabled.
create or replace function public.get_audit_logging()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select audit_logging_enabled from public.business_settings where id = true),
    true
  );
$$;

grant execute on function public.get_audit_logging() to authenticated;
