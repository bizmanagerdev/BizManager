-- Run this in the Supabase SQL Editor. Safe to re-run (create or replace).
--
-- session_effective_payment_view — THE single source for "is this work session paid?".
--
-- Two kinds of workers, two rules:
--   • session-tracked (pay_tracking_mode = 'session'): paid per session, so the
--     status comes straight from the session's own debt row.
--   • payslip-tracked (monthly_payslip / hourly_payslip): paid on the MONTHLY
--     PAYSLIP, which covers ALL of that month's sessions. They have no per-session
--     debt row, so each session's status is derived from the covering month's
--     payslip (matched by user + YYYY-MM).
--
-- Every screen that shows a session's paid status should read THIS view instead of
-- re-deriving the payslip-coverage rule in app code. paid_amount / owed_amount are
-- per-session only for session-tracked workers (NULL for payslip-tracked, because a
-- payslip's amounts belong to the whole month, not a single session).

create or replace view public.session_effective_payment_view as
with payslip_status as (
  select
    d.user_id,
    d.period_month,
    d.payment_status,
    d.last_payment_date
  from public.worker_debt_items_view d
  where d.source_type = 'payslip'
)
select
  s.id as session_id,
  s.user_id,
  to_char(date_trunc('month', s.clock_in), 'YYYY-MM') as period_month,
  (u.pay_tracking_mode = 'payslip') as is_payslip_covered,
  case
    when u.pay_tracking_mode = 'payslip' then ps.payment_status
    else sd.payment_status
  end as payment_status,
  case
    when u.pay_tracking_mode = 'payslip' then null::numeric
    else sd.paid_amount
  end as paid_amount,
  case
    when u.pay_tracking_mode = 'payslip' then null::numeric
    else sd.owed_amount
  end as owed_amount,
  case
    when u.pay_tracking_mode = 'payslip' then ps.last_payment_date
    else sd.last_payment_date
  end as last_payment_date
from public.attendance_sessions s
join public.users u on u.id = s.user_id
left join public.worker_debt_items_view sd
  on sd.source_type = 'session' and sd.source_id = s.id
left join payslip_status ps
  on ps.user_id = s.user_id
 and ps.period_month = to_char(date_trunc('month', s.clock_in), 'YYYY-MM');

-- Respect the caller's RLS (no anon leak), matching the other hardened views.
alter view public.session_effective_payment_view set (security_invoker = on);

grant select on public.session_effective_payment_view to authenticated;
