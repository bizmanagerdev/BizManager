-- Unified worker debt and payment reporting views.
-- Run after creating:
-- - users.pay_tracking_mode
-- - worker_payments
-- - worker_payment_allocations

create or replace view public.worker_debt_items_view as
with session_items as (
  select
    'session'::text as source_type,
    s.id as source_id,
    s.user_id,
    s.project_id,
    null::uuid as payslip_id,
    null::uuid as payroll_period_id,
    (s.clock_in at time zone 'utc')::date as source_date,
    to_char(date_trunc('month', s.clock_in), 'YYYY-MM') as period_month,
    coalesce(s.worked_minutes, 0)::numeric as worked_minutes,
    coalesce(s.labor_cost, 0)::numeric(12,2) as earned_amount
  from public.attendance_sessions s
  join public.users u on u.id = s.user_id
  where u.pay_tracking_mode = 'session'
    and coalesce(s.labor_cost, 0) > 0
),
payslip_items as (
  select
    'payslip'::text as source_type,
    p.id as source_id,
    p.user_id,
    null::uuid as project_id,
    p.id as payslip_id,
    p.payroll_period_id,
    coalesce(pp.end_date, current_date) as source_date,
    coalesce(pp.period_month, to_char(current_date, 'YYYY-MM')) as period_month,
    coalesce(p.total_work_minutes, 0)::numeric as worked_minutes,
    coalesce(p.gross_salary, 0)::numeric(12,2) as earned_amount
  from public.payslips p
  join public.users u on u.id = p.user_id
  left join public.payroll_periods pp on pp.id = p.payroll_period_id
  where u.pay_tracking_mode = 'payslip'
    and coalesce(p.gross_salary, 0) > 0
),
base_items as (
  select * from session_items
  union all
  select * from payslip_items
),
allocation_totals as (
  select
    a.source_type,
    coalesce(a.attendance_session_id, a.payslip_id) as source_id,
    sum(coalesce(a.amount, 0))::numeric(12,2) as paid_amount,
    max(wp.payment_date) as last_payment_date
  from public.worker_payment_allocations a
  join public.worker_payments wp on wp.id = a.worker_payment_id
  group by a.source_type, coalesce(a.attendance_session_id, a.payslip_id)
)
select
  b.source_type,
  b.source_id,
  b.user_id,
  b.project_id,
  b.payslip_id,
  b.payroll_period_id,
  b.source_date,
  b.period_month,
  b.worked_minutes,
  b.earned_amount,
  coalesce(a.paid_amount, 0)::numeric(12,2) as paid_amount,
  (b.earned_amount - coalesce(a.paid_amount, 0))::numeric(12,2) as owed_amount,
  case
    when coalesce(a.paid_amount, 0) <= 0 then 'unpaid'
    when coalesce(a.paid_amount, 0) + 0.009 < b.earned_amount then 'partial'
    when abs(coalesce(a.paid_amount, 0) - b.earned_amount) < 0.01 then 'paid'
    else 'overpaid'
  end as payment_status,
  a.last_payment_date
from base_items b
left join allocation_totals a
  on a.source_type = b.source_type
 and a.source_id = b.source_id;

create or replace view public.worker_balance_summary_view as
select
  d.user_id,
  count(*)::bigint as item_count,
  count(*) filter (where d.owed_amount > 0.009)::bigint as open_item_count,
  sum(d.earned_amount)::numeric(12,2) as earned_amount,
  sum(d.paid_amount)::numeric(12,2) as paid_amount,
  sum(d.owed_amount)::numeric(12,2) as owed_amount,
  case
    when sum(d.paid_amount) <= 0 then 'unpaid'
    when sum(d.owed_amount) > 0.009 then 'partial'
    when sum(d.owed_amount) < -0.009 then 'overpaid'
    else 'paid'
  end as payment_status,
  max(d.last_payment_date) as last_payment_date
from public.worker_debt_items_view d
group by d.user_id;

create or replace view public.project_worker_balance_view as
select
  d.project_id,
  count(*)::bigint as item_count,
  sum(d.earned_amount)::numeric(12,2) as earned_amount,
  sum(d.paid_amount)::numeric(12,2) as paid_amount,
  sum(d.owed_amount)::numeric(12,2) as owed_amount
from public.worker_debt_items_view d
where d.source_type = 'session'
  and d.project_id is not null
group by d.project_id;

create or replace view public.monthly_worker_balance_view as
select
  d.period_month,
  count(*)::bigint as item_count,
  count(*) filter (where d.owed_amount > 0.009)::bigint as open_item_count,
  sum(d.earned_amount)::numeric(12,2) as earned_amount,
  sum(d.paid_amount)::numeric(12,2) as paid_amount,
  sum(d.owed_amount)::numeric(12,2) as owed_amount
from public.worker_debt_items_view d
where d.period_month is not null
group by d.period_month;

grant select on public.worker_debt_items_view to authenticated;
grant select on public.worker_balance_summary_view to authenticated;
grant select on public.project_worker_balance_view to authenticated;
grant select on public.monthly_worker_balance_view to authenticated;
