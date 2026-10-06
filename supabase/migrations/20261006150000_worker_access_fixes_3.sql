-- ════════════════════════════════════════════════════════════════════════════
-- Worker access fixes, part 3 (PowerSync plan, approved 2026-10-06):
-- workers see other people's NAME AND COLOUR only.
--
-- BEFORE: a worker could read every coworker's full user row — phone, email,
-- notes, pay settings, section access, notification settings — and nothing at
-- all about admins (so an admin's comment showed as "unknown user", and an
-- admin assignee had no name or avatar).
--
-- AFTER: a worker reads only their own user row. Everyone else comes from two
-- functions that run with the database's rights and hand back only:
--   user_directory()  — id, name, colour, role, active, and whether the
--                       person logs shifts (for the + menu attendance picker);
--                       everyone, admins included (approved 2026-10-06).
--   user_labels(ids)  — the name behind a user id or login id (comment
--                       authors, uploaders, history).
-- The app's task board, pickers, task card, attachments, + menu, vehicle page
-- and manual attendance now read these. Admins and office: no change in what
-- they can read.
--
-- Run this BEFORE deploying the app that calls these functions. Until that
-- deploy, workers see blank names on coworkers' tasks; nothing else changes.
--
-- ROLLBACK: supabase/rollbacks/20261006150000_worker_access_fixes_3.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.user_directory()
returns table (id uuid, full_name text, avatar_color text, role text, active boolean, logs_shifts boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform public.require_app_role();
  return query
    select u.id, u.full_name, u.avatar_color, u.role::text, u.active,
      -- Same rule as lib/payroll-worker-type.ts (normalizePayrollWorkerType +
      -- payrollWorkerTypeAllowsSessions).
      (u.role in ('worker'::user_role_enum, 'worker_no_access'::user_role_enum)
        and case
          when u.payroll_worker_type in ('session_only', 'hourly_payslip') then true
          when u.payroll_worker_type = 'monthly_payslip' then false
          else coalesce(u.pay_tracking_mode, '') <> 'payslip'
        end)
    from public.users u;
end;
$$;
revoke all on function public.user_directory() from public, anon;
grant execute on function public.user_directory() to authenticated, service_role;

create or replace function public.user_labels(p_values text[])
returns table (value text, full_name text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform public.require_app_role();
  return query
    select u.id::text, u.full_name from public.users u where u.id::text = any (p_values)
    union all
    select u.auth_user_id::text, u.full_name from public.users u
    where u.auth_user_id is not null and u.auth_user_id::text = any (p_values);
end;
$$;
revoke all on function public.user_labels(text[]) from public, anon;
grant execute on function public.user_labels(text[]) to authenticated, service_role;

drop policy if exists users_worker_view_coworkers on public.users;
