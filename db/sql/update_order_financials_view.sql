-- Run this in Supabase SQL Editor.
-- Expands order_financials_view so order detail readers can rely on SQL for
-- totals, balances, payment counts, and payment status.

create or replace view public.order_financials_view as
with payment_totals as (
  select
    p.target_id as order_id,
    count(*)::bigint as payment_count,
    coalesce(sum(coalesce(p.amount_total, 0)), 0)::numeric as paid_amount,
    max(p.payment_date)::date as last_payment_date
  from public.payments p
  where p.target_type = 'order'
    and p.target_id is not null
  group by p.target_id
)
select
  o.id as order_id,
  o.id as id,
  o.customer_id,
  coalesce(o.total_amount, 0)::numeric as order_total,
  coalesce(o.total_amount, 0)::numeric as total_amount,
  coalesce(pt.paid_amount, 0)::numeric as paid_amount,
  coalesce(pt.paid_amount, 0)::numeric as total_paid,
  greatest(coalesce(o.total_amount, 0) - coalesce(pt.paid_amount, 0), 0)::numeric as outstanding_amount,
  greatest(coalesce(o.total_amount, 0) - coalesce(pt.paid_amount, 0), 0)::numeric as remaining_balance,
  coalesce(pt.payment_count, 0)::bigint as payment_count,
  case
    when coalesce(pt.paid_amount, 0) <= 0 then 'unpaid'
    when coalesce(pt.paid_amount, 0) + 0.009 >= coalesce(o.total_amount, 0) then 'paid'
    else 'partial'
  end::text as payment_status,
  pt.last_payment_date
from public.orders o
left join payment_totals pt
  on pt.order_id = o.id;

grant select on public.order_financials_view to authenticated;
