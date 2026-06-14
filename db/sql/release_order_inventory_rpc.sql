-- Run this script in Supabase SQL Editor.
--
-- Releases the inventory a sales order is holding by deleting its
-- inventory_movements rows. The trg_sync_inventory_from_movements trigger then
-- reverts each deleted movement's effect:
--   'reserve' rows -> quantity_reserved drops  (stock moves from שמור back to זמין)
--   'out'     rows -> quantity_on_hand restored (delivered/closed goods come back)
--
-- security definer so order deletion releases stock for EVERY role
-- (admin/office), independent of the inventory_movements RLS policies. The JS
-- delete path runs as the logged-in user, which can be RLS-blocked from
-- deleting movement rows and would then leak the reservation silently.
--
-- Used by POST /api/orders/delete. Safe to run more than once; idempotent.

create or replace function public.release_order_inventory(
  p_order_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer;
begin
  if p_order_id is null then
    raise exception 'order_id is required';
  end if;

  delete from public.inventory_movements
  where source_type = 'order'
    and source_id = p_order_id;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

grant execute on function public.release_order_inventory(uuid) to authenticated;
