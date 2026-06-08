-- Run in Supabase SQL Editor AFTER applying:
--   db/sql/sync_inventory_from_movements_trigger.sql   (reserve-aware trigger)
--   db/sql/create_sales_order_rpc.sql                  (backorders allowed)
--   db/sql/update_sales_order_rpc.sql                  (backorders allowed)
--   db/sql/delete_sales_order_rpc.sql
--
-- Purpose:
--   1) Allow backorders: drop the reserved<=on_hand constraint so an order can
--      reserve more than is on hand. Available (on_hand - reserved) then goes
--      negative, which is how we flag an order as containing out-of-stock items.
--   2) Re-classify existing order-linked movements to the status model:
--        open orders            -> reserve
--        delivered/completed/closed -> out
--        cancelled              -> no movement
--   3) Rebuild `inventory` deterministically as the net of all movements. This is
--      safe and drift-proof because nothing writes inventory.quantity_on_hand /
--      quantity_reserved directly -- only the movement trigger does. We do the
--      re-classification with the trigger OFF, then recompute from scratch, so we
--      never depend on incremental revert arithmetic.
--
-- Safe to run more than once.

begin;

-- (1) Backorders allowed: reservations may exceed on-hand stock.
alter table public.inventory drop constraint if exists quantity_reserved_is_available;

-- Re-classify movement types with the sync trigger temporarily disabled.
alter table public.inventory_movements disable trigger trg_sync_inventory_from_movements;

-- (2a) Delivered quantity matches the status model.
update public.order_items oi
set quantity_delivered = case
  when lower(coalesce(o.status, '')) in ('delivered', 'completed', 'closed') then oi.quantity_ordered
  else 0
end
from public.orders o
where o.id = oi.order_id
  and oi.quantity_delivered is distinct from case
    when lower(coalesce(o.status, '')) in ('delivered', 'completed', 'closed') then oi.quantity_ordered
    else 0
  end;

-- (2b) Open orders reserve stock.
update public.inventory_movements im
set movement_type = 'reserve'
from public.orders o
where im.source_type = 'order'
  and im.source_id = o.id
  and lower(coalesce(o.status, '')) not in ('delivered', 'completed', 'closed', 'cancelled')
  and im.movement_type = 'out';

-- (2c) Delivered/completed/closed consume stock.
update public.inventory_movements im
set movement_type = 'out'
from public.orders o
where im.source_type = 'order'
  and im.source_id = o.id
  and lower(coalesce(o.status, '')) in ('delivered', 'completed', 'closed')
  and im.movement_type = 'reserve';

-- (2d) Cancelled orders hold no inventory.
delete from public.inventory_movements im
using public.orders o
where im.source_type = 'order'
  and im.source_id = o.id
  and lower(coalesce(o.status, '')) = 'cancelled';

alter table public.inventory_movements enable trigger trg_sync_inventory_from_movements;

-- (3) Rebuild inventory from the corrected movements (authoritative, drift-proof).
update public.inventory i
set quantity_on_hand = greatest(coalesce(a.on_hand, 0), 0),
    quantity_reserved = greatest(coalesce(a.reserved, 0), 0),
    updated_at = now()
from (
  select product_id,
    sum(case movement_type
          when 'in' then quantity
          when 'out' then -quantity
          when 'adjustment' then quantity
          else 0 end) as on_hand,
    sum(case movement_type
          when 'reserve' then quantity
          when 'release' then -quantity
          else 0 end) as reserved
  from public.inventory_movements
  group by product_id
) a
where a.product_id = i.product_id;

commit;

-- Validation after the repair:
--
-- A. Reserved should now be non-zero where open orders exist:
-- select count(*) filter (where quantity_reserved > 0) as products_reserved,
--        sum(quantity_reserved) as total_reserved
-- from public.inventory;
--
-- B. Out-of-stock / backordered products (available is negative):
-- select product_id, quantity_on_hand, quantity_reserved,
--        quantity_on_hand - quantity_reserved as available
-- from public.inventory
-- where quantity_reserved > quantity_on_hand;
--
-- C. Order-linked movements by status (sanity):
-- select lower(coalesce(o.status,'')) as status, im.movement_type,
--        count(*) rows, sum(im.quantity) total_qty
-- from public.inventory_movements im
-- join public.orders o on o.id = im.source_id
-- where im.source_type = 'order'
-- group by 1,2 order by 1,2;
