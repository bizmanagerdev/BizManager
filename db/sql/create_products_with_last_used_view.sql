-- Run in Supabase SQL Editor.
-- Adds order_count (number of times this product appeared on an order) and
-- last_used_at (most recent order date) to products so the new-order form
-- can sort most-frequently-ordered products to the top.

create index if not exists idx_order_items_product_id on public.order_items (product_id);

create or replace view public.products_with_last_used as
with order_stats as (
  select
    oi.product_id,
    count(*)::bigint as order_count,
    max(o.order_date)::timestamptz as last_used_at
  from public.order_items oi
  inner join public.orders o on o.id = oi.order_id
  where oi.product_id is not null
  group by oi.product_id
)
select
  p.*,
  os.last_used_at,
  coalesce(os.order_count, 0)::bigint as order_count
from public.products p
left join order_stats os on os.product_id = p.id;

grant select on public.products_with_last_used to authenticated;
