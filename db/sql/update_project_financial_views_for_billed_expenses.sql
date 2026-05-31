-- Run this in Supabase SQL Editor.
--
-- Goal:
-- - Add financial tracking fields to attendance_sessions so salary sessions can act like project costs.
-- - Keep billed-to-customer items separate from internal cash flow.
-- - Treat project gross profit as:
--     base_price + customer_billable_addons - total_project_cost
--   where:
--     base_price = coalesce(projects.actual_price, projects.agreed_base_price, 0)
--     customer_billable_addons =
--       billed project expenses + billable attendance session customer amounts
--     total_project_cost =
--       all project expenses + attendance session labor cost
--
-- Notes:
-- - total_expenses in the views below represents total real project cost.
-- - expenses_billed includes both billed project expenses and billed attendance session amounts.
-- - customer_total_price represents the amount the customer should pay after billable add-ons.

alter table public.attendance_sessions
  add column if not exists labor_cost numeric(12,2),
  add column if not exists is_billable_to_customer boolean not null default false,
  add column if not exists bill_to_customer_amount numeric(12,2),
  add column if not exists billing_status text not null default 'not_billable';

update public.attendance_sessions
set billing_status = case
  when is_billable_to_customer then 'billable'
  else 'not_billable'
end
where billing_status is distinct from case
  when is_billable_to_customer then 'billable'
  else 'not_billable'
end;

create or replace view public.project_expenses_summary_view as
with expense_totals as (
  select
    p.id as project_id,
    count(pe.id) as expense_count,
    coalesce(
      sum(
        case
          when coalesce(pe.billed_to_customer, false) = false then coalesce(e.amount, 0)
          else 0
        end
      ),
      0
    )::numeric as total_expenses,
    coalesce(
      sum(
        case
          when coalesce(pe.included_in_base_price, false) = true
            and coalesce(pe.billed_to_customer, false) = false
          then coalesce(e.amount, 0)
          else 0
        end
      ),
      0
    )::numeric as expenses_included,
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
)
select
  p.id as project_id,
  coalesce(et.expense_count, 0) as expense_count,
  (
    coalesce(et.all_expense_costs, 0) +
    coalesce(st.all_labor_costs, 0)
  )::numeric as total_expenses,
  coalesce(et.expenses_included, 0)::numeric as expenses_included,
  (
    coalesce(et.billed_expense_amounts, 0) +
    coalesce(st.billable_session_amounts, 0)
  )::numeric as expenses_billed
from public.projects p
left join expense_totals et
  on et.project_id = p.id
left join session_totals st
  on st.project_id = p.id;

create or replace view public.financial_project_view as
with expense_totals as (
  select
    p.id as project_id,
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
    coalesce(sum(coalesce(s.labor_cost, 0)), 0)::numeric as all_labor_costs
  from public.attendance_sessions s
  where s.project_id is not null
  group by s.project_id
)
select
  p.id as project_id,
  p.name as project_name,
  (
    coalesce(et.all_expense_costs, 0) +
    coalesce(st.all_labor_costs, 0)
  )::numeric as total_expenses
from public.projects p
left join expense_totals et
  on et.project_id = p.id
left join session_totals st
  on st.project_id = p.id;

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
payment_totals as (
  -- COLLECTION SPLIT (2026-05): collected = money actually in (cleared/legacy);
  -- pending = future-dated / uncleared (payment_status='pending'); overdue =
  -- pending past its due_date. The revenue fallback below uses collected money so
  -- expected (not-yet-received) money never inflates an unpriced project's revenue.
  select
    p.project_id,
    coalesce(
      sum(
        case
          when coalesce(p.payment_status, 'cleared') not in ('pending', 'rejected')
          then coalesce(p.amount_total, 0)
          else 0
        end
      ),
      0
    )::numeric as collected_payments,
    coalesce(
      sum(case when p.payment_status = 'pending' then coalesce(p.amount_total, 0) else 0 end),
      0
    )::numeric as pending_payments,
    coalesce(
      sum(
        case
          when p.payment_status = 'pending'
            and p.due_date is not null
            and p.due_date <= current_date
          then coalesce(p.amount_total, 0)
          else 0
        end
      ),
      0
    )::numeric as overdue_payments,
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
  select
    p.id as project_id,
    case
      when coalesce(p.actual_price, 0) > 0 then p.actual_price::numeric
      when coalesce(p.agreed_base_price, 0) > 0 then p.agreed_base_price::numeric
      else coalesce(pt.collected_payments, 0)::numeric
    end as base_revenue
  from public.projects p
  left join payment_totals pt
    on pt.project_id = p.id
)
select
  p.id,
  p.name,
  p.agreed_base_price,
  p.actual_price,
  (
    coalesce(et.all_expense_costs, 0) +
    coalesce(st.all_labor_costs, 0)
  )::numeric as total_expenses,
  (
    coalesce(rb.base_revenue, 0)::numeric +
    coalesce(et.billed_expense_amounts, 0)::numeric +
    coalesce(st.billable_session_amounts, 0)::numeric -
    coalesce(et.all_expense_costs, 0)::numeric -
    coalesce(st.all_labor_costs, 0)::numeric
  )::numeric as gross_profit,
  (
    coalesce(et.billed_expense_amounts, 0) +
    coalesce(st.billable_session_amounts, 0)
  )::numeric as expenses_billed,
  (
    coalesce(rb.base_revenue, 0)::numeric +
    coalesce(et.billed_expense_amounts, 0)::numeric +
    coalesce(st.billable_session_amounts, 0)::numeric
  )::numeric as customer_total_price,
  -- Collection columns: money in vs money still expected
  coalesce(pt.collected_payments, 0)::numeric as total_paid,
  coalesce(pt.collected_payments, 0)::numeric as collected_amount,
  coalesce(pt.pending_payments, 0)::numeric as pending_amount,
  coalesce(pt.overdue_payments, 0)::numeric as overdue_amount,
  pt.next_due_date,
  pt.last_payment_date,
  greatest(
    (
      coalesce(rb.base_revenue, 0)::numeric +
      coalesce(et.billed_expense_amounts, 0)::numeric +
      coalesce(st.billable_session_amounts, 0)::numeric
    ) - coalesce(pt.collected_payments, 0),
    0
  )::numeric as outstanding_amount
from public.projects p
left join expense_totals et
  on et.project_id = p.id
left join session_totals st
  on st.project_id = p.id
left join revenue_base rb
  on rb.project_id = p.id
left join payment_totals pt
  on pt.project_id = p.id;

grant select on public.financial_project_view to authenticated;
grant select on public.project_financials_view to authenticated;
grant select on public.project_expenses_summary_view to authenticated;
