-- Run this in Supabase SQL Editor.
-- Delivery-focused read model for the sales deliveries tab.
-- One row per order that is relevant to delivery planning.

create or replace view public.delivery_overview_view as
select
  o.id as order_id,
  o.customer_id,
  coalesce(
    nullif(trim(c.name), ''),
    nullif(trim(c.name_for_invoice), ''),
    'לקוח'
  )::text as customer_name,
  nullif(trim(c.phone), '')::text as customer_phone,
  nullif(trim(c.address), '')::text as customer_address,
  nullif(trim(split_part(coalesce(c.address, ''), '|', 1)), '')::text as customer_city,
  o.order_date,
  o.created_at,
  coalesce(o.status::text, 'draft') as status,
  coalesce(o.total_amount, 0)::numeric as total_amount,
  nullif(trim(o.notes), '')::text as notes
from public.orders o
left join public.customers c
  on c.id = o.customer_id
where coalesce(o.status::text, '') in (
  'draft',
  'confirmed',
  'processing',
  'out_for_delivery'
);

grant select on public.delivery_overview_view to authenticated;
