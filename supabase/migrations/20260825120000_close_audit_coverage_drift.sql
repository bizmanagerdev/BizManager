-- Close the audit-coverage drift that's built up since 20260724050000 last
-- swept ALL uuid-PK tables, and stop a new noise source before it floods.
--
-- Every table created after 20260724050000 ran has been silently un-audited
-- (no activity-feed rows) UNTIL something manually re-attaches the trigger for
-- it — that's how "phone_attendance_reports"/"recurring_task_template_assignees"
-- ended up showing raw English table names in the feed (they got attached by
-- hand at some point; app code (lib/audit.ts entityLabel) was never updated to
-- match). Re-running the same blanket attach here closes the drift in one shot
-- for every table still missing it (worker_absences and whatever else has been
-- added since), the same way 20260724050000 did originally.
--
-- notifications is added to the denylist first: it's a per-recipient delivery
-- record for every reminder/task/order/nightly alert sent (see
-- 20260703000000_notifications_center.sql) — created at the same high volume as
-- the reminders churn that 20260724040000 already had to silence, and it
-- predates 050000 (2026-07-02 vs 2026-07-24) so it's almost certainly been
-- attached and flooding the feed with raw "notifications · נוצר" rows this
-- whole time with nothing readable in them (no human title to resolve).
--
-- Idempotent — safe to re-run.

DROP TRIGGER IF EXISTS "trg_audit_notifications" ON "public"."notifications";

do $$
declare
  r record;
  v_deny text[] := array[
    'audit_logs',
    'idempotency_keys',
    'inventory',
    'reminders',
    'notifications',
    'morning_documents',
    'morning_settings',
    'expense_merchant_mappings',
    'card_statement_rows',
    'fcm_tokens',
    'push_subscriptions',
    'user_sessions'
  ];
begin
  for r in
    select c.relname as table_name
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
