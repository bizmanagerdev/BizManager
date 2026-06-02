-- ════════════════════════════════════════════════════════════════════════════
-- CLEANUP — remove the OLD duplicate audit rows
-- Run in the Supabase SQL Editor. SAFE: preview first, then delete.
--
-- Background: for the trigger-covered tables, the DB trigger `log_changes` wrote
-- a detailed row (UPPERCASE action: INSERT/UPDATE/DELETE, with JSON data) AND the
-- app ALSO wrote a bare row (lowercase action: create/update/delete/..., no data).
-- This deletes ONLY the bare lowercase app rows on those tables.
--
-- It does NOT touch:
--   • the UPPERCASE trigger rows (the detailed ones we keep),
--   • semantic events (morning_customer_linked, morning_auto_invoice_failed, ...),
--   • app rows on tables the trigger did NOT cover yet (attendance_sessions,
--     worker_payments, documents) — those are the only audit record for that past.
-- ════════════════════════════════════════════════════════════════════════════

-- ── STEP 1: PREVIEW — how many rows will be deleted (run this first) ─────────
select table_name, action, count(*) as rows_to_delete
from public.audit_logs
where table_name in (
        'orders','order_items','payments','projects','customers',
        'users','contacts','expenses','tasks'
      )
  and action in ('create','update','delete','status_changed','priority_changed')
group by table_name, action
order by table_name, action;
-- Expected: ~134 rows total (projects 20, tasks 20, payments 27, expenses 52, orders 15).

-- ── STEP 2: DELETE — run after the preview looks right ──────────────────────
begin;

delete from public.audit_logs
where table_name in (
        'orders','order_items','payments','projects','customers',
        'users','contacts','expenses','tasks'
      )
  and action in ('create','update','delete','status_changed','priority_changed');

-- Sanity check inside the transaction: these should all be 0 now.
select count(*) as remaining_bare_rows
from public.audit_logs
where table_name in (
        'orders','order_items','payments','projects','customers',
        'users','contacts','expenses','tasks'
      )
  and action in ('create','update','delete','status_changed','priority_changed');

commit;  -- change to ROLLBACK; if anything looks wrong
