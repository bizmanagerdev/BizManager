-- ════════════════════════════════════════════════════════════════════════════
-- FOLLOW-UP to 20260909120000_project_financials_view_not_materialized.sql —
-- that migration marked expense_totals, session_totals, payslip_billed_totals
-- and payment_totals NOT MATERIALIZED but MISSED a 5th multiply-referenced
-- CTE: revenue_base. It's joined directly in the final SELECT (`LEFT JOIN
-- revenue_base rb`) AND again inside effective_revenue (`LEFT JOIN
-- revenue_base rb_1`) — two references, so Postgres still MATERIALIZES it by
-- default (fully executes it as its own fenced result set) unless declared
-- NOT MATERIALIZED. Left fenced, it blocks the outer WHERE/`.eq("id", …)`
-- from pushing down through it, so project_dashboard_view,
-- customer_overview_view and collections_view — all of which join
-- project_financials_view — still pay for a full unfiltered scan of
-- public.projects (plus payment_totals through it) on every read.
--
-- FIX: mark revenue_base NOT MATERIALIZED too, so it inlines into the same
-- query tree as the other 4 already-fixed CTEs, letting the planner push an
-- outer id filter all the way down to the base table scans.
--
-- SECURITY: this changes ONLY a query-planning hint. The view's logic,
-- columns, column order and security_invoker=on (restated below — see the
-- warning in 20260901000000_fix_financial_views_security_invoker_leak.sql:
-- `create or replace view` silently drops security_invoker unless it's
-- re-specified in the SAME statement) are all byte-identical to the current
-- live definition (supabase/migrations/20260909120000_
-- project_financials_view_not_materialized.sql). Same rows, same numbers,
-- same RLS enforcement, same caller-facing behavior — only the amount of work
-- Postgres does to compute them changes.
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.project_financials_view
with (security_invoker = on) as
with expense_totals as not materialized (
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
session_totals as not materialized (
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
payslip_billed_totals as not materialized (
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
payment_totals as not materialized (
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
revenue_base as not materialized (
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
-- Column ORDER must stay identical to the live view (19 columns). Nothing
-- below this line changed from the current live definition.
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
