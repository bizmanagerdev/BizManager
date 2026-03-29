-- Run this in Supabase SQL Editor.
-- Expands customer_overview_view so the customers page can rely on a single
-- SQL-backed customer summary row for most fields.

create or replace view public.customer_overview_view as
with order_totals as (
  select
    o.customer_id,
    count(*)::bigint as orders_count,
    coalesce(sum(coalesce(o.total_amount, 0)), 0)::numeric as total_sales,
    max(o.order_date)::timestamptz as last_order_at
  from public.orders o
  where o.customer_id is not null
  group by o.customer_id
),
project_totals as (
  select
    p.customer_id,
    count(*)::bigint as projects_count
  from public.projects p
  where p.customer_id is not null
  group by p.customer_id
),
payment_totals as (
  select
    o.customer_id,
    coalesce(sum(coalesce(pay.amount_total, 0)), 0)::numeric as total_paid,
    max(pay.payment_date)::timestamptz as last_payment_at
  from public.payments pay
  inner join public.orders o
    on pay.target_type = 'order'
   and pay.target_id = o.id
  where o.customer_id is not null
  group by o.customer_id
)
select
  c.id as customer_id,
  coalesce(
    nullif(trim(c.name), ''),
    nullif(trim(c.name_for_invoice), ''),
    'לקוח'
  )::text as customer_name,
  nullif(trim(c.email), '')::text as email,
  nullif(trim(c.phone), '')::text as phone,
  coalesce(ot.orders_count, 0)::bigint as orders_count,
  coalesce(pt.projects_count, 0)::bigint as projects_count,
  coalesce(ot.total_sales, 0)::numeric as total_sales,
  coalesce(payt.total_paid, 0)::numeric as total_paid,
  greatest(coalesce(ot.total_sales, 0) - coalesce(payt.total_paid, 0), 0)::numeric as open_balance,
  ot.last_order_at,
  payt.last_payment_at,
  nullif(trim(c.address), '')::text as address,
  coalesce(c.active, true) as active,
  nullif(trim(c.notes), '')::text as notes,
  nullif(trim(c.name_for_invoice), '')::text as name_for_invoice,
  nullif(trim(c.registration_number), '')::text as registration_number
from public.customers c
left join order_totals ot
  on ot.customer_id = c.id
left join project_totals pt
  on pt.customer_id = c.id
left join payment_totals payt
  on payt.customer_id = c.id;

grant select on public.customer_overview_view to authenticated;
