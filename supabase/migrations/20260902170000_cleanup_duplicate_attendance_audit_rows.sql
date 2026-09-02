-- ════════════════════════════════════════════════════════════════════════════
-- CLEANUP — remove OLD duplicate audit rows for phone_attendance_reports,
-- worker_absences, payslip_items.
--
-- Same bug as db/sql/cleanup_duplicate_app_audit_rows.sql, found later: these
-- three tables got the DB trigger `log_changes` (writes a detailed row,
-- UPPERCASE action: INSERT/UPDATE/DELETE, full to_jsonb(NEW) data) at
-- creation, but were missing from lib/audit.ts's `TRIGGER_AUDITED_TABLES`
-- until 2026-09-01 — so every app-level `logAuditEvent` call on them ALSO
-- wrote a bare row (lowercase action: create/update/delete, no data). Every
-- plain create/update/delete on these tables is doubled in audit_logs.
--
-- User-visible symptom: a phone_attendance_reports row created via the app
-- (source='app') showed TWO "נוצר" rows in /activity with the same
-- timestamp/actor — the real trigger row correctly labeled "מהאפליקציה", and
-- the bare app row with no `new_data` at all, which `entityLabel()` can't
-- read a `source` from, so it falls through to the phone-call default label
-- "דיווח נוכחות טלפוני" even though no call ever happened.
--
-- This deletes ONLY the bare lowercase app rows on these 3 tables. It does
-- NOT touch the UPPERCASE trigger rows (the detailed ones we keep). Safe to
-- re-run — a second run just deletes 0 rows.
-- ════════════════════════════════════════════════════════════════════════════

-- Preview (informational — shows in the migration log, does not fail the run).
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.audit_logs
  where table_name in ('phone_attendance_reports', 'worker_absences', 'payslip_items')
    and action in ('create', 'update', 'delete', 'status_changed', 'priority_changed');
  raise notice 'cleanup_duplicate_attendance_audit_rows: deleting % bare app-side rows', v_count;
end $$;

delete from public.audit_logs
where table_name in ('phone_attendance_reports', 'worker_absences', 'payslip_items')
  and action in ('create', 'update', 'delete', 'status_changed', 'priority_changed');
