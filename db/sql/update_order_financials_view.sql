-- Run this in Supabase SQL Editor.
-- Expands order_financials_view so order detail readers can rely on SQL for
-- totals, balances, payment counts, and payment status.
--
-- COLLECTION SPLIT (2026-05): payments with a future due_date / uncleared checks
-- are stored with payment_status='pending' — that money has NOT arrived yet.
-- "paid"/"total_paid" and payment_status now reflect ONLY collected money
-- (cleared or legacy rows with no status). Expected money is exposed separately
-- as pending_amount / overdue_amount / next_due_date so the גבייה worklist and
-- the UI can show "נגבה בפועל" vs "צפוי".

-- CREATE OR REPLACE with new columns appended at the END (preserving the
-- original column order) so dependents keep working. paid_amount / total_paid /
-- payment_status keep their names/positions but now reflect COLLECTED money only.
create or replace view public.order_financials_view as
with payment_totals as (
  select
    p.order_id as order_id,
    count(*)::bigint as payment_count,
    coalesce(
      sum(
        case
          when coalesce(p.payment_status, 'cleared') not in ('pending', 'rejected')
          then coalesce(p.amount_total, 0)
          else 0
        end
      ),
      0
    )::numeric as collected_amount,
    coalesce(
      sum(case when p.payment_status = 'pending' then coalesce(p.amount_total, 0) else 0 end),
      0
    )::numeric as pending_amount,
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
    )::numeric as overdue_pending_amount,
    min(case when p.payment_status = 'pending' then p.due_date end)::date as next_due_date,
    max(p.payment_date)::date as last_payment_date
  from public.payments p
  where p.order_id is not null
  group by p.order_id
)
select
  o.id as order_id,
  o.id as id,
  o.customer_id,
  coalesce(o.total_amount, 0)::numeric as order_total,
  coalesce(o.total_amount, 0)::numeric as total_amount,
  -- paid_amount / total_paid reflect COLLECTED money only (back-compat names)
  coalesce(pt.collected_amount, 0)::numeric as paid_amount,
  coalesce(pt.collected_amount, 0)::numeric as total_paid,
  greatest(coalesce(o.total_amount, 0) - coalesce(pt.collected_amount, 0), 0)::numeric as outstanding_amount,
  greatest(coalesce(o.total_amount, 0) - coalesce(pt.collected_amount, 0), 0)::numeric as remaining_balance,
  coalesce(pt.payment_count, 0)::bigint as payment_count,
  case
    when coalesce(pt.collected_amount, 0) <= 0 then 'unpaid'
    when coalesce(pt.collected_amount, 0) + 0.009 >= coalesce(o.total_amount, 0) then 'paid'
    else 'partial'
  end::text as payment_status,
  pt.last_payment_date,
  -- New collection columns appended at the END (preserves original order)
  coalesce(pt.collected_amount, 0)::numeric as collected_amount,
  coalesce(pt.pending_amount, 0)::numeric as pending_amount,
  coalesce(pt.overdue_pending_amount, 0)::numeric as overdue_amount,
  pt.next_due_date
from public.orders o
left join payment_totals pt
  on pt.order_id = o.id;

grant select on public.order_financials_view to authenticated;
