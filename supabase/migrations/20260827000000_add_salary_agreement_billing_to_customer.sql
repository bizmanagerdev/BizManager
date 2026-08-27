-- ════════════════════════════════════════════════════════════════════════════
-- Allow a project-linked monthly/hourly salary agreement to be (partly) billed
-- to the customer, mirroring attendance_sessions.is_billable_to_customer /
-- bill_to_customer_amount. Until now a payslip's project-attributed salary
-- (see 20260630000002_add_salary_agreement_business_domain) only ever landed
-- as pure cost — there was no way to add any of it to the project's expected
-- customer price the way billable sessions and billed expenses already can.
--
-- The flag/amount lives on the salary AGREEMENT (like project_id already
-- does), so it applies to every payslip generated while that agreement is
-- active. The cost side is untouched — the full salary always counts as an
-- expense; the billed amount is ADDITIONALLY counted toward the customer's
-- price, so this stays profit-neutral when billed = cost and only moves
-- profit by the markup/discount, exactly like session billing.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.salary_agreements
  add column if not exists is_billable_to_customer boolean not null default false;

alter table public.salary_agreements
  add column if not exists bill_to_customer_amount numeric(12,2);

-- Recreate worker_debt_items_view (full definition from
-- 20260630000002_add_salary_agreement_business_domain.sql) appending the two
-- new columns at the END — CREATE OR REPLACE VIEW cannot drop/reorder columns.
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
    coalesce(s.labor_cost, 0)::numeric(12,2) as earned_amount,
    coalesce(s.business_domain, 'general_business')::text as business_domain,
    s.property_id,
    coalesce(s.is_billable_to_customer, false) as is_billable_to_customer,
    s.bill_to_customer_amount
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
    active_agreement.project_id,
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
    coalesce(p.gross_salary, 0)::numeric(12,2) as earned_amount,
    coalesce(active_agreement.business_domain, 'general_business')::text as business_domain,
    active_agreement.property_id,
    coalesce(active_agreement.is_billable_to_customer, false) as is_billable_to_customer,
    active_agreement.bill_to_customer_amount
  from public.payslips p
  join public.users u on u.id = p.user_id
  left join public.payroll_periods pp on pp.id = p.payroll_period_id
  left join lateral (
    select
      sa.due_day_of_next_month,
      sa.business_domain,
      sa.project_id,
      sa.property_id,
      sa.is_billable_to_customer,
      sa.bill_to_customer_amount
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
  b.due_date,
  b.business_domain,
  b.property_id,
  b.is_billable_to_customer,
  b.bill_to_customer_amount
from base_items b
left join allocation_totals a
  on a.source_type = b.source_type
 and a.source_id = b.source_id;

grant select on public.worker_debt_items_view to authenticated;

-- Recreate project_financials_view (full definition from
-- 20260707000000_project_financials_include_payslip_salary.sql), adding a
-- payslip_billed_totals CTE wired in exactly where session_totals.
-- billable_session_amounts already is. total_expenses/gross_profit keep
-- counting the FULL salary as cost — only expenses_billed/effective_price
-- gain the additional billed amount.
create or replace view public.project_financials_view as
with expense_totals as (
  select
    p.id as project_id,
    coalesce(
      sum(
        case
          when coalesce(pe.billed_to_customer, false) = true then coalesce(e.amount, 0)
          else 0
        end
      ),
      0
    )::numeric as billed_expense_amounts,
    coalesce(sum(coalesce(e.amount, 0)), 0)::numeric as all_expense_costs
  from public.projects p
  left join public.project_expenses pe
    on pe.project_id = p.id
  left join public.expenses e
    on e.id = pe.expense_id
  group by p.id
),
session_totals as (
  select
    s.project_id,
    coalesce(
      sum(
        case
          when coalesce(s.is_billable_to_customer, false) = false then coalesce(s.labor_cost, 0)
          else 0
        end
      ),
      0
    )::numeric as non_billable_labor_cost,
    coalesce(
      sum(
        case
          when coalesce(s.is_billable_to_customer, false) = true
          then coalesce(s.bill_to_customer_amount, 0)
          else 0
        end
      ),
      0
    )::numeric as billable_session_amounts,
    coalesce(sum(coalesce(s.labor_cost, 0)), 0)::numeric as all_labor_costs
  from public.attendance_sessions s
  where s.project_id is not null
  group by s.project_id
),
payslip_salary_totals as (
  -- Whole monthly salary of payslip workers whose salary agreement points at this
  -- project (earned = incurred for the period). Session rows are excluded here —
  -- they're already in session_totals — so nothing is double counted.
  select
    d.project_id,
    coalesce(sum(coalesce(d.earned_amount, 0)), 0)::numeric as payslip_salary_cost
  from public.worker_debt_items_view d
  where d.source_type = 'payslip'
    and d.project_id is not null
  group by d.project_id
),
payslip_billed_totals as (
  -- Portion of a project-attributed monthly salary the agreement marks as
  -- billable to the customer. Additive to price only — the cost side above
  -- (payslip_salary_cost) always counts the full salary regardless.
  select
    d.project_id,
    coalesce(
      sum(
        case
          when coalesce(d.is_billable_to_customer, false) = true
          then coalesce(d.bill_to_customer_amount, 0)
          else 0
        end
      ),
      0
    )::numeric as payslip_billed_amount
  from public.worker_debt_items_view d
  where d.source_type = 'payslip'
    and d.project_id is not null
  group by d.project_id
),
payment_totals as (
  -- COLLECTION SPLIT on the amount that COUNTS toward the price (net_amount).
  -- gross_collected / vat_collected are tracked separately for display + tax.
  select
    p.project_id,
    coalesce(
      sum(
        case
          when coalesce(p.payment_status, 'cleared') not in ('pending', 'rejected')
          then coalesce(p.net_amount, p.amount_total, 0)
          else 0
        end
      ),
      0
    )::numeric as collected_payments,
    coalesce(
      sum(case when p.payment_status = 'pending' then coalesce(p.net_amount, p.amount_total, 0) else 0 end),
      0
    )::numeric as pending_payments,
    coalesce(
      sum(
        case
          when p.payment_status = 'pending'
            and p.due_date is not null
            and p.due_date <= current_date
          then coalesce(p.net_amount, p.amount_total, 0)
          else 0
        end
      ),
      0
    )::numeric as overdue_payments,
    coalesce(
      sum(
        case
          when coalesce(p.payment_status, 'cleared') not in ('pending', 'rejected')
          then coalesce(p.amount_total, 0)
          else 0
        end
      ),
      0
    )::numeric as gross_collected,
    coalesce(
      sum(
        case
          when coalesce(p.payment_status, 'cleared') not in ('pending', 'rejected')
          then coalesce(p.vat_amount, 0)
          else 0
        end
      ),
      0
    )::numeric as vat_collected,
    min(case when p.payment_status = 'pending' then p.due_date end)::date as next_due_date,
    max(
      case
        when coalesce(p.payment_status, 'cleared') not in ('pending', 'rejected')
        then p.payment_date
      end
    )::date as last_payment_date
  from public.payments p
  where p.project_id is not null
  group by p.project_id
),
revenue_base as (
  -- The agreed/actual price, grossed up by VAT for price_includes_vat projects.
  select
    p.id as project_id,
    case
      when coalesce(p.actual_price, 0) > 0
        then p.actual_price::numeric
          * case when coalesce(p.price_includes_vat, false) then (1 + coalesce(p.vat_rate, 0.18)) else 1 end
      when coalesce(p.agreed_base_price, 0) > 0
        then p.agreed_base_price::numeric
          * case when coalesce(p.price_includes_vat, false) then (1 + coalesce(p.vat_rate, 0.18)) else 1 end
      else coalesce(pt.collected_payments, 0)::numeric
    end as base_revenue
  from public.projects p
  left join payment_totals pt
    on pt.project_id = p.id
),
effective_revenue as (
  -- מחיר בפועל = the HIGHER of the expected customer price vs money counted.
  select
    p.id as project_id,
    greatest(
      coalesce(rb.base_revenue, 0)::numeric
        + coalesce(et.billed_expense_amounts, 0)::numeric
        + coalesce(st.billable_session_amounts, 0)::numeric
        + coalesce(pbt.payslip_billed_amount, 0)::numeric,
      coalesce(pt.collected_payments, 0)::numeric
    )::numeric as effective_price
  from public.projects p
  left join revenue_base rb on rb.project_id = p.id
  left join expense_totals et on et.project_id = p.id
  left join session_totals st on st.project_id = p.id
  left join payslip_billed_totals pbt on pbt.project_id = p.id
  left join payment_totals pt on pt.project_id = p.id
)
-- Column ORDER must stay identical to the live view (19 columns). Only the
-- expenses_billed and effective_price/downstream EXPRESSIONS change.
select
  p.id,
  p.name,
  p.agreed_base_price,
  p.actual_price,
  (
    coalesce(et.all_expense_costs, 0) +
    coalesce(st.all_labor_costs, 0) +
    coalesce(ps.payslip_salary_cost, 0)
  )::numeric as total_expenses,
  (
    coalesce(er.effective_price, 0)::numeric -
    coalesce(et.all_expense_costs, 0)::numeric -
    coalesce(st.all_labor_costs, 0)::numeric -
    coalesce(ps.payslip_salary_cost, 0)::numeric
  )::numeric as gross_profit,
  (
    coalesce(et.billed_expense_amounts, 0) +
    coalesce(st.billable_session_amounts, 0) +
    coalesce(pbt.payslip_billed_amount, 0)
  )::numeric as expenses_billed,
  coalesce(er.effective_price, 0)::numeric as customer_total_price,
  -- Collection columns: money counted toward price vs still expected
  coalesce(pt.collected_payments, 0)::numeric as total_paid,
  coalesce(pt.collected_payments, 0)::numeric as collected_amount,
  coalesce(pt.pending_payments, 0)::numeric as pending_amount,
  coalesce(pt.overdue_payments, 0)::numeric as overdue_amount,
  pt.next_due_date,
  pt.last_payment_date,
  greatest(
    coalesce(er.effective_price, 0)::numeric - coalesce(pt.collected_payments, 0),
    0
  )::numeric as outstanding_amount,
  -- ── Appended VAT columns — keep at the END ──
  p.price_includes_vat,
  p.vat_rate,
  coalesce(pt.gross_collected, 0)::numeric as gross_collected,
  coalesce(pt.vat_collected, 0)::numeric as vat_collected
from public.projects p
left join expense_totals et
  on et.project_id = p.id
left join session_totals st
  on st.project_id = p.id
left join payslip_salary_totals ps
  on ps.project_id = p.id
left join payslip_billed_totals pbt
  on pbt.project_id = p.id
left join revenue_base rb
  on rb.project_id = p.id
left join effective_revenue er
  on er.project_id = p.id
left join payment_totals pt
  on pt.project_id = p.id;

grant select on public.project_financials_view to authenticated;
