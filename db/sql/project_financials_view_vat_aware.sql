-- ════════════════════════════════════════════════════════════════════════════
-- project_financials_view — VAT-aware. SUPERSEDES project_actual_price_use_received.sql.
-- Run in the Supabase SQL Editor AFTER add_vat_tracking.sql. Safe to re-run.
--
-- What changed vs. the previous definition:
--   • "Collected toward the project price" now sums net_amount (the amount that
--     COUNTS), not amount_total (the gross that arrived). For non-official
--     payments net_amount = amount_total, so only official payments differ —
--     their VAT no longer inflates the price / actual price / gross profit.
--   • Phase 2: when projects.price_includes_vat is true, the expected price is
--     grossed up by (1 + project vat_rate) so the target IS the with-VAT total.
--   • Two new display columns: gross_collected (real cash in, incl. VAT) and
--     vat_collected (VAT stripped from official payments, for the tax bucket).
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
  -- (Counted = net for official payments, so VAT never raises it; genuine
  --  overpayment in non-official money still does.)
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
-- NOTE: column ORDER must match the previous view definition for the first 15
-- columns — CREATE OR REPLACE VIEW can only APPEND new columns at the end, never
-- reorder/rename. New VAT columns are therefore appended after outstanding_amount.
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
  -- ── Appended (new) columns — keep at the END ──
  p.price_includes_vat,
  p.vat_rate,
  -- Real cash in (gross) and VAT stripped from official payments
  coalesce(pt.gross_collected, 0)::numeric as gross_collected,
  coalesce(pt.vat_collected, 0)::numeric as vat_collected
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
