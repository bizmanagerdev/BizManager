-- Run this in Supabase SQL Editor.
-- Expands order_overview_view so the sales orders list can rely on SQL-backed
-- customer/contact/payment summary fields instead of rebuilding them in JS.

create or replace view public.order_overview_view as
with payment_totals as (
  select
    p.target_id as order_id,
    count(*)::bigint as payment_count,
    coalesce(sum(coalesce(p.amount_total, 0)), 0)::numeric as total_paid
  from public.payments p
  where p.target_type = 'order'
    and p.target_id is not null
  group by p.target_id
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
  coalesce(o.payment_status::text, 'unpaid') as payment_status,
  coalesce(o.discount_amount, 0)::numeric as discount_amount,
  coalesce(o.total_amount, 0)::numeric as total_amount,
  coalesce(pt.total_paid, 0)::numeric as total_paid,
  greatest(coalesce(o.total_amount, 0) - coalesce(pt.total_paid, 0), 0)::numeric as remaining_balance,
  coalesce(pt.payment_count, 0)::bigint as payment_count,
  o.created_by as created_by_user_id,
  coalesce(
    nullif(trim(u.full_name), ''),
    nullif(trim(u.email), '')
  )::text as created_by_name,
  nullif(trim(o.notes), '')::text as notes
from public.orders o
left join public.customers c
  on c.id = o.customer_id
left join payment_totals pt
  on pt.order_id = o.id
left join public.users u
  on u.id = o.created_by;

grant select on public.order_overview_view to authenticated;
