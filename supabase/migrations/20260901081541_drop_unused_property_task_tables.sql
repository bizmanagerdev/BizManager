-- ════════════════════════════════════════════════════════════════════════════
-- Drop two tables that exist in the schema but nothing in the app reads or
-- writes:
--
--   property_expenses  — a property↔expense join table (id, property_id,
--     expense_id, notes) from the ORIGINAL property-management design.
--     Superseded before it was ever used: property linking actually happens
--     via a direct `property_id` column on `expenses`/`payments` (the same
--     pattern `project_id`/`order_id` already use there) — confirmed by a
--     comment left in 20260820124004_property_management_rls.sql itself
--     ("property_expenses: unused by app code today"). No route, action, or
--     component ever selects from or inserts into it.
--
--   task_time_reports  — a per-task time-in/time-out table scaffolded ahead
--     of a "time tracking on tasks" feature that was never actually built —
--     no API route or UI ever reads or writes it. Real time tracking exists
--     only at the attendance/payroll level (attendance_sessions), which is a
--     different concern (worker pay), not per-task time logging.
--
--     Three views were built on top of it as part of the same never-shipped
--     feature — task_bottleneck_view, task_time_summary_view,
--     user_workload_view — also confirmed to have zero application
--     consumers anywhere in app/. All three are in
--     __tests__/security/rls-policies.test.ts's PROTECTED_VIEWS list
--     (views granted SELECT to anon) — so beyond being dead code, they were
--     also unused attack surface exposed at the database level for no
--     benefit. Dropped here too, and removed from that test's list in the
--     same pass.
--
-- Neither table is dangerous as dead weight, but both have already caused
-- real confusion — each looks like a live table with the exact shape you'd
-- expect, right next to the table that actually IS used for the
-- same-sounding purpose. Dropping them removes the landmine instead of
-- documenting around it forever.
--
-- Guarded, not a blind drop: if either table unexpectedly holds rows (this
-- migration's whole premise is that both are empty — nothing has ever
-- written to them), abort loudly instead of silently discarding data. Same
-- principle as the accounts-scan fix in this same pass: a surprising state
-- should fail loud, not disappear quietly.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.property_expenses;
  if v_count > 0 then
    raise exception
      'property_expenses has % row(s) — expected 0 (confirmed unused by app code). Investigate before dropping.',
      v_count;
  end if;
end $$;

drop table if exists public.property_expenses;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.task_time_reports;
  if v_count > 0 then
    raise exception
      'task_time_reports has % row(s) — expected 0 (feature was never built, nothing ever wrote to it). Investigate before dropping.',
      v_count;
  end if;
end $$;

-- Drop the 3 dependent views explicitly (named, not CASCADE) so an
-- unexpected 4th dependent still fails the migration loudly instead of
-- being silently swept away.
drop view if exists public.task_bottleneck_view;
drop view if exists public.task_time_summary_view;
drop view if exists public.user_workload_view;

drop table if exists public.task_time_reports;
