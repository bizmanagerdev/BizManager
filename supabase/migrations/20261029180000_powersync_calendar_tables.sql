-- ════════════════════════════════════════════════════════════════════════════
-- PowerSync: follow the payment promises, the one table the payments calendar
-- (/financial/payments-calendar, צפי תזרים) reads that devices don't have yet —
-- so a staff device can draw the calendar itself and open it with no
-- connection (owner, 2026-10-29: "yes go ahead with 1-3"). Read-only access for
-- powersync_role; devices get the rows only through powersync/sync-config.yaml
-- (v1.15), admins and office, as the table's RLS ("Staff manage payment
-- promises"). No row changes. recurring_expense_templates is already followed
-- (more of its columns go to devices in v1.15).
--
-- ROLLBACK: supabase/rollbacks/20261029180000_powersync_calendar_tables.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

grant select on table public.payment_promises to powersync_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'powersync' and schemaname = 'public' and tablename = 'payment_promises'
  ) then
    alter publication powersync add table public.payment_promises;
  end if;
end $$;
