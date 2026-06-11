-- Run this in the Supabase SQL Editor.
-- Fixes open orders that show ₪0 in the orders list: some orders rows have
-- total_amount = 0 even though their order_items carry real prices.
-- 1) Backfills orders.subtotal / orders.total_amount from order_items.
-- 2) Re-creates order_overview_view so total_amount / remaining_balance /
--    payment_status fall back to the items-derived total whenever the stored
--    orders.total_amount is 0 — so the list can never show 0 for a priced order.
--    Column order MATCHES update_order_overview_view_invoice_fields.sql exactly
--    (CREATE OR REPLACE only allows appending columns, never reordering).

-- 1) Backfill stored totals from items
with item_totals as (
  select
    oi.order_id,
    coalesce(
      sum(
        coalesce(oi.quantity_ordered, 0) * coalesce(oi.unit_price, 0)
          - coalesce(oi.discount_amount, 0)
      ),
      0
    )::numeric as items_total
  from public.order_items oi
  group by oi.order_id
)
update public.orders o
set
  subtotal = it.items_total,
  total_amount = greatest(it.items_total - coalesce(o.discount_amount, 0), 0)
from item_totals it
where it.order_id = o.id
  and coalesce(o.total_amount, 0) = 0
  and it.items_total > 0;

-- 2) View fallback: effective total = stored total, or items total when stored is 0
create or replace view public.order_overview_view as
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
    min(case when p.payment_status = 'pending' then p.due_date end)::date as next_due_date
  from public.payments p
  where p.order_id is not null
  group by p.order_id
),
item_totals as (
  select
    oi.order_id,
    coalesce(
      sum(
        coalesce(oi.quantity_ordered, 0) * coalesce(oi.unit_price, 0)
          - coalesce(oi.discount_amount, 0)
      ),
      0
    )::numeric as items_total
  from public.order_items oi
  group by oi.order_id
),
orders_effective as (
  select
    o.*,
    case
      when coalesce(o.total_amount, 0) > 0 then o.total_amount
      else greatest(coalesce(it.items_total, 0) - coalesce(o.discount_amount, 0), 0)
    end::numeric as effective_total
  from public.orders o
  left join item_totals it on it.order_id = o.id
)
select
  o.id as order_id,
  o.customer_id,
  coalesce(
    nullif(trim(c.name), ''),
    nullif(trim(c.name_for_invoice), ''),
    'לקוח'
  )::text as customer_name,
  nullif(trim(c.email), '')::text as customer_email,
  nullif(trim(c.phone), '')::text as customer_phone,
  nullif(trim(c.address), '')::text as customer_address,
  nullif(trim(split_part(coalesce(c.address, ''), '|', 1)), '')::text as customer_city,
  o.order_date,
  o.created_at,
  coalesce(o.status::text, 'draft') as status,
  case
    when coalesce(pt.collected_amount, 0) <= 0 then 'unpaid'
    when coalesce(pt.collected_amount, 0) + 0.009 >= o.effective_total then 'paid'
    else 'partial'
  end::text as payment_status,
  coalesce(o.discount_amount, 0)::numeric as discount_amount,
  o.effective_total as total_amount,
  coalesce(pt.collected_amount, 0)::numeric as total_paid,
  coalesce(pt.collected_amount, 0)::numeric as collected_amount,
  coalesce(pt.pending_amount, 0)::numeric as pending_amount,
  coalesce(pt.overdue_pending_amount, 0)::numeric as overdue_amount,
  pt.next_due_date,
  greatest(o.effective_total - coalesce(pt.collected_amount, 0), 0)::numeric as remaining_balance,
  coalesce(pt.payment_count, 0)::bigint as payment_count,
  o.created_by as created_by_user_id,
  coalesce(
    nullif(trim(u.full_name), ''),
    nullif(trim(u.email), '')
  )::text as created_by_name,
  nullif(trim(o.notes), '')::text as notes,
  nullif(trim(c.name_for_invoice), '')::text as customer_name_for_invoice,
  o.needs_invoice,
  o.invoice_sent_at,
  o.delivery_confirmed_at
from orders_effective o
left join public.customers c
  on c.id = o.customer_id
left join payment_totals pt
  on pt.order_id = o.id
left join public.users u
  on u.id = o.created_by;

grant select on public.order_overview_view to authenticated;
