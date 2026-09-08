-- session_effective_payment_view didn't expose a due_date, so a session whose
-- effective status is "not_due" (covered by a payslip that isn't due yet) had
-- no date for the UI to show — the badge could only say "not due", never
-- WHEN. Add it, mirroring the same payslip-vs-session branch every other
-- column here already uses.

create or replace view public.session_effective_payment_view as
with payslip_status as (
  select
    d.user_id,
    d.period_month,
    d.payment_status,
    d.last_payment_date,
    d.due_date
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
  end as last_payment_date,
  case
    when u.pay_tracking_mode = 'payslip' then ps.due_date
    else sd.due_date
  end as due_date
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
