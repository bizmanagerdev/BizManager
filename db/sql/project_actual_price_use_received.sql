-- ════════════════════════════════════════════════════════════════════════════
-- מחיר בפועל / רווח גולמי — reflect the amount ACTUALLY RECEIVED when it's higher
-- Run in the Supabase SQL Editor.
--
-- Before: project revenue = actual_price (forced equal to agreed_base_price) +
--   customer-billed add-ons. If a customer paid MORE than that, the extra was
--   ignored — מחיר בפועל and רווח גולמי stayed at the agreed price.
--
-- After: revenue = GREATEST(expected price, money collected), where
--   expected price = base_revenue + billed expenses + billable session amounts.
--   • Overpaid  → מחיר בפועל / gross profit rise to what was received.
--   • Underpaid → stays at the expected price (so 'נותר לגבייה' still shows the gap).
--   • Collected = cleared/legacy payments only (pending/future-dated excluded),
--     and refunds (negative payments) net out automatically.
--
-- Only project_financials_view is recreated — it's the single view the app reads
-- for project financials (list, detail, customers, dashboard, monthly summary).
-- ════════════════════════════════════════════════════════════════════════════

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
  -- COLLECTION SPLIT: collected = money actually in (cleared/legacy); pending =
  -- future-dated / uncleared; overdue = pending past its due_date.
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
),
effective_revenue as (
  -- מחיר בפועל = the HIGHER of the expected customer price vs money received.
  select
    p.id as project_id,
    greatest(
      coalesce(rb.base_revenue, 0)::numeric
        + coalesce(et.billed_expense_amounts, 0)::numeric
        + coalesce(st.billable_session_amounts, 0)::numeric,
      coalesce(pt.collected_payments, 0)::numeric
    )::numeric as effective_price
  from public.projects p
  left join revenue_base rb on rb.project_id = p.id
  left join expense_totals et on et.project_id = p.id
  left join session_totals st on st.project_id = p.id
  left join payment_totals pt on pt.project_id = p.id
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
    coalesce(er.effective_price, 0)::numeric -
    coalesce(et.all_expense_costs, 0)::numeric -
    coalesce(st.all_labor_costs, 0)::numeric
  )::numeric as gross_profit,
  (
    coalesce(et.billed_expense_amounts, 0) +
    coalesce(st.billable_session_amounts, 0)
  )::numeric as expenses_billed,
  coalesce(er.effective_price, 0)::numeric as customer_total_price,
  -- Collection columns: money in vs money still expected
  coalesce(pt.collected_payments, 0)::numeric as total_paid,
  coalesce(pt.collected_payments, 0)::numeric as collected_amount,
  coalesce(pt.pending_payments, 0)::numeric as pending_amount,
  coalesce(pt.overdue_payments, 0)::numeric as overdue_amount,
  pt.next_due_date,
  pt.last_payment_date,
  greatest(
    coalesce(er.effective_price, 0)::numeric - coalesce(pt.collected_payments, 0),
    0
  )::numeric as outstanding_amount
from public.projects p
left join expense_totals et
  on et.project_id = p.id
left join session_totals st
  on st.project_id = p.id
left join revenue_base rb
  on rb.project_id = p.id
left join effective_revenue er
  on er.project_id = p.id
left join payment_totals pt
  on pt.project_id = p.id;

grant select on public.project_financials_view to authenticated;
