-- Run this script in Supabase SQL Editor.
--
-- Goal:
-- - Introduce users.payroll_worker_type as the explicit payroll behavior flag.
-- - Backfill conservatively from existing pay_tracking_mode, salary agreements, sessions, and payslips.
-- - Keep pay_tracking_mode synchronized for backward compatibility during rollout.

alter table public.users
  add column if not exists payroll_worker_type text;

alter table public.users
  drop constraint if exists users_payroll_worker_type_check;

alter table public.users
  add constraint users_payroll_worker_type_check
  check (payroll_worker_type in ('session_only', 'monthly_payslip', 'hourly_payslip'));

with ranked_agreements as (
  select
    sa.user_id,
    sa.salary_type,
    row_number() over (
      partition by sa.user_id
      order by
        case
          when sa.valid_from <= current_date
            and (sa.valid_to is null or sa.valid_to >= current_date)
          then 0
          else 1
        end,
        sa.valid_from desc,
        sa.id desc
    ) as row_number
  from public.salary_agreements sa
),
latest_agreements as (
  select user_id, salary_type
  from ranked_agreements
  where row_number = 1
),
session_counts as (
  select user_id, count(*)::bigint as session_count
  from public.attendance_sessions
  group by user_id
),
payslip_counts as (
  select user_id, count(*)::bigint as payslip_count
  from public.payslips
  group by user_id
)
update public.users u
set payroll_worker_type = case
  when u.pay_tracking_mode = 'session' then 'session_only'
  when la.salary_type = 'monthly' then 'monthly_payslip'
  when la.salary_type = 'hourly' then 'hourly_payslip'
  when coalesce(pc.payslip_count, 0) > 0 and coalesce(sc.session_count, 0) > 0 then 'hourly_payslip'
  when coalesce(pc.payslip_count, 0) > 0 then 'monthly_payslip'
  else 'session_only'
end
from latest_agreements la
full join session_counts sc
  on sc.user_id = la.user_id
full join payslip_counts pc
  on pc.user_id = coalesce(la.user_id, sc.user_id)
where u.id = coalesce(la.user_id, sc.user_id, pc.user_id)
  and (
    u.payroll_worker_type is null
    or u.payroll_worker_type not in ('session_only', 'monthly_payslip', 'hourly_payslip')
  );

update public.users
set payroll_worker_type = 'session_only'
where payroll_worker_type is null;

update public.users
set pay_tracking_mode = case
  when payroll_worker_type = 'session_only' then 'session'
  else 'payslip'
end
where coalesce(pay_tracking_mode, '') is distinct from case
  when payroll_worker_type = 'session_only' then 'session'
  else 'payslip'
end;

alter table public.users
  alter column payroll_worker_type set default 'session_only';

alter table public.users
  alter column payroll_worker_type set not null;

comment on column public.users.payroll_worker_type is
  'Explicit payroll behavior: session_only, monthly_payslip, or hourly_payslip.';
