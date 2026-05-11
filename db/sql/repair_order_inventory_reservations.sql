-- Run in Supabase SQL Editor after applying:
--   db/sql/sync_inventory_from_movements_trigger.sql
--   db/sql/create_sales_order_rpc.sql
--   db/sql/update_sales_order_rpc.sql
--   db/sql/delete_sales_order_rpc.sql
--
-- Purpose:
-- Fix existing order-linked inventory movements that were written as `out`
-- even when the order was still open. Open orders should reserve stock,
-- delivered/completed orders should consume stock, and cancelled orders
-- should not keep inventory movements at all.
--
-- Safe to run more than once.

begin;

-- 1) Ensure delivered quantity matches the order status model.
update public.order_items oi
set quantity_delivered = case
  when lower(coalesce(o.status, '')) in ('delivered', 'completed') then oi.quantity_ordered
  else 0
end
from public.orders o
where o.id = oi.order_id
  and oi.quantity_delivered is distinct from case
    when lower(coalesce(o.status, '')) in ('delivered', 'completed') then oi.quantity_ordered
    else 0
  end;

-- 2) Open orders should reserve stock, not remove it from on-hand.
-- The inventory trigger will automatically revert the old `out` effect and
-- apply the new `reserve` effect on update.
update public.inventory_movements im
set movement_type = 'reserve'
from public.orders o
where im.source_type = 'order'
  and im.source_id = o.id
  and lower(coalesce(o.status, '')) not in ('delivered', 'completed', 'cancelled')
  and im.movement_type = 'out';

-- 3) Delivered/completed orders must consume stock.
-- This also fixes any rows that may already have been changed to `reserve`.
update public.inventory_movements im
set movement_type = 'out'
from public.orders o
where im.source_type = 'order'
  and im.source_id = o.id
  and lower(coalesce(o.status, '')) in ('delivered', 'completed')
  and im.movement_type = 'reserve';

-- 4) Cancelled orders should not hold inventory at all.
-- Deleting the movements causes the inventory trigger to revert their effect.
delete from public.inventory_movements im
using public.orders o
where im.source_type = 'order'
  and im.source_id = o.id
  and lower(coalesce(o.status, '')) = 'cancelled';

commit;

-- Suggested validation queries to run after the repair:
--
-- A. Check order-linked movements by order status
-- select
--   lower(coalesce(o.status, '')) as order_status,
--   im.movement_type,
--   count(*) as movement_rows,
--   sum(im.quantity) as total_qty
-- from public.inventory_movements im
-- join public.orders o on o.id = im.source_id
-- where im.source_type = 'order'
-- group by 1, 2
-- order by 1, 2;
--
-- B. Spot open orders that still have `out` movements
-- select o.id, o.status, im.product_id, im.quantity, im.movement_type, im.created_at
-- from public.inventory_movements im
-- join public.orders o on o.id = im.source_id
-- where im.source_type = 'order'
--   and lower(coalesce(o.status, '')) not in ('delivered', 'completed', 'cancelled')
--   and im.movement_type = 'out'
-- order by im.created_at desc;
--
-- C. Spot cancelled orders that still have movements
-- select o.id, o.status, im.product_id, im.quantity, im.movement_type, im.created_at
-- from public.inventory_movements im
-- join public.orders o on o.id = im.source_id
-- where im.source_type = 'order'
--   and lower(coalesce(o.status, '')) = 'cancelled'
-- order by im.created_at desc;
