-- Run this after the worker payment views already exist.
--
-- Goal:
-- - Make payslip debt due on the 10th of the following month.
-- - Mark open payslip debt as `not_due` until that due date arrives.
-- - Keep worker balance statuses aligned with the item-level due-date rule.

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
    (s.clock_in at time zone 'utc')::date as due_date,
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
    (
      date_trunc('month', coalesce(pp.end_date, current_date)::timestamp + interval '1 month')::date
      + (
        least(
          greatest(coalesce(active_agreement.due_day_of_next_month, 10), 1),
          extract(day from (date_trunc('month', coalesce(pp.end_date, current_date)::timestamp + interval '2 month') - interval '1 day'))::int
        ) - 1
      )
    ) as due_date,
    coalesce(pp.period_month, to_char(current_date, 'YYYY-MM')) as period_month,
    coalesce(p.total_work_minutes, 0)::numeric as worked_minutes,
    coalesce(p.gross_salary, 0)::numeric(12,2) as earned_amount
  from public.payslips p
  join public.users u on u.id = p.user_id
  left join public.payroll_periods pp on pp.id = p.payroll_period_id
  left join lateral (
    select sa.due_day_of_next_month
    from public.salary_agreements sa
    where sa.user_id = p.user_id
      and sa.valid_from <= coalesce(pp.end_date, current_date)
      and (sa.valid_to is null or sa.valid_to >= coalesce(pp.end_date, current_date))
    order by sa.valid_from desc, sa.id desc
    limit 1
  ) active_agreement on true
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
  (
    case
      when b.source_type = 'payslip' and b.due_date > current_date then 0
      else (b.earned_amount - coalesce(a.paid_amount, 0))
    end
  )::numeric(12,2) as owed_amount,
  case
    when abs(coalesce(a.paid_amount, 0) - b.earned_amount) < 0.01 then 'paid'
    when coalesce(a.paid_amount, 0) > b.earned_amount + 0.009 then 'overpaid'
    when b.source_type = 'payslip' and b.due_date > current_date then 'not_due'
    when coalesce(a.paid_amount, 0) > 0 and coalesce(a.paid_amount, 0) + 0.009 < b.earned_amount then 'partial'
    when coalesce(a.paid_amount, 0) <= 0 then 'unpaid'
    else 'overpaid'
  end as payment_status,
  a.last_payment_date,
  b.due_date
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
    when sum(d.owed_amount) < -0.009 then 'overpaid'
    when count(*) filter (where d.owed_amount > 0.009 and d.payment_status in ('unpaid', 'partial')) > 0
      then case when sum(d.paid_amount) > 0 then 'partial' else 'unpaid' end
    when count(*) filter (where d.payment_status = 'not_due') > 0 then 'not_due'
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
