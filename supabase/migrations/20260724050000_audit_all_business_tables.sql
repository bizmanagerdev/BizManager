-- Track everything: attach the generic public.log_changes() audit trigger to
-- EVERY current business table (uuid `id` PK) that isn't already audited.
--
-- WHY: auditing was first attached by a one-time DO-loop over the tables that
-- existed then (db/sql/extend_audit_to_all_tables.sql). Every table added since
-- — task_comments, task_members, loans, loan_repayments, tags, entity_tags,
-- accounts, inquiries, communications, expense_installments, card_statements,
-- push_alert_config, … — has silently produced NO activity-feed rows. This
-- re-runs the attach over all current uuid-PK tables so the drift is closed in
-- one shot, and is safe to re-run (skips tables already audited).
--
-- DENYLIST — deliberately NOT audited:
--   audit_logs               recursion (never audit the audit table)
--   idempotency_keys         internal request-dedup plumbing
--   inventory                derived stock levels, rewritten on every movement
--                            (inventory_movements is already audited)
--   reminders                the system-rules engine reconciles it on a schedule
--                            → hundreds of rows; intentionally un-audited in
--                            migration 20260724040000, summarized as one row instead
--   morning_documents /
--   morning_settings         keep their richer app-side morning_* events
--   expense_merchant_mappings  merchant-memory churn, no user-facing meaning
--   card_statement_rows      bulk per-transaction import noise (the card_statements
--                            header IS audited → "imported statement")
--
-- Idempotent.

do $$
declare
  r record;
  v_deny text[] := array[
    'audit_logs',
    'idempotency_keys',
    'inventory',
    'reminders',
    'morning_documents',
    'morning_settings',
    'expense_merchant_mappings',
    'card_statement_rows'
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
