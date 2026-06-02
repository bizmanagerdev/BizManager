-- ════════════════════════════════════════════════════════════════════════════
-- EXTEND AUDITING — attach the log_changes trigger to ALL business tables
-- Run in the Supabase SQL Editor.
--
-- The existing trigger function public.log_changes() is generic: it uses
-- TG_TABLE_NAME, NEW.id / OLD.id, auth.uid() and to_jsonb(OLD/NEW). It therefore
-- works on any table that has a `uuid id` primary-key column. This script finds
-- every such public table that isn't already audited and attaches an
-- AFTER INSERT/UPDATE/DELETE row trigger named trg_audit_<table>.
--
-- DENYLIST (edit `v_deny` below to taste):
--   • audit_logs               — never audit the audit table itself.
--   • morning_documents /
--     morning_settings         — keep their richer app-side morning_* events
--                                instead of plain INSERT/UPDATE rows.
--   • Add high-volume/low-value tables you DON'T want flooding the log, e.g.
--     'inventory_movements', 'push_subscriptions'.
--
-- IMPORTANT (deploy order): run this BEFORE (or together with) deploying the app
-- change that adds documents/attendance_sessions/worker_payments to
-- TRIGGER_AUDITED_TABLES, so there is never a gap where neither logs them.
-- ════════════════════════════════════════════════════════════════════════════

-- ── STEP 1: DRY RUN — list the tables that WOULD get an audit trigger ────────
with deny as (
  select unnest(array[
    'audit_logs', 'morning_documents', 'morning_settings'
  ]) as t
)
select c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attname = 'id'
join pg_type ty on ty.oid = a.atttypid
where n.nspname = 'public'
  and c.relkind = 'r'
  and ty.typname = 'uuid'
  and not a.attisdropped
  and c.relname not in (select t from deny)
  and not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = c.oid
      and tg.tgfoid = 'public.log_changes'::regproc
      and not tg.tgisinternal
  )
order by c.relname;

-- ── STEP 2: ATTACH — idempotent; re-runnable; skips already-audited tables ──
do $$
declare
  r record;
  v_deny text[] := array['audit_logs', 'morning_documents', 'morning_settings'];
begin
  for r in
    select c.relname as table_name, c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'id'
    join pg_type ty on ty.oid = a.atttypid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and ty.typname = 'uuid'
      and not a.attisdropped
      and c.relname <> all(v_deny)
      and not exists (
        select 1 from pg_trigger tg
        where tg.tgrelid = c.oid
          and tg.tgfoid = 'public.log_changes'::regproc
          and not tg.tgisinternal
      )
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      || 'for each row execute function public.log_changes()',
      'trg_audit_' || r.table_name, r.table_name
    );
    raise notice 'audit trigger added on public.%', r.table_name;
  end loop;
end$$;
