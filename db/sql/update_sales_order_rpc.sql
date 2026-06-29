-- Run this script in Supabase SQL Editor.
-- Atomic RPC used by POST /api/orders/update.
--
-- payment_terms / due_date / delivery_confirmed_at are set HERE in the single
-- orders UPDATE (not via a follow-up UPDATE in the route) so one edit = one
-- "עודכן" audit row instead of several. The recalc trigger is also silenced for
-- this transaction (see fix_order_line_total_pricing.sql) so rewriting the
-- order_items doesn't emit a stray "עודכן · סכום" row per line.

-- Drop the previous 11-arg signature so the new args don't leave a second
-- overload (which would make PostgREST ambiguous).
drop function if exists public.update_sales_order(
  uuid, uuid, timestamptz, text, numeric, numeric, numeric, text, uuid, text, jsonb
);

create or replace function public.update_sales_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_order_date timestamptz,
  p_status text,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_total_amount numeric,
  p_payment_status text,
  p_updated_by uuid,
  p_notes text,
  p_items jsonb,
  p_payment_terms text default null,
  p_due_date date default null,
  p_delivery_date timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_qty numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_existing_movement_qty numeric;
  v_stock_on_hand numeric;
  v_stock_reserved numeric;
  v_stock_available numeric;
  v_target_status text;
  v_quantity_delivered numeric;
  v_inventory_movement_type text;
begin
  if p_order_id is null then
    raise exception 'order_id is required';
  end if;
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;
  if p_order_date is null then
    raise exception 'order_date is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;

  select
    coalesce(nullif(lower(trim(p_status)), ''), lower(coalesce(o.status, 'draft')))
  into v_target_status
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  -- Silence recalculate_order_totals() for this transaction: this RPC sets the
  -- order totals itself, so the per-item trigger would only emit redundant
  -- "עודכן · סכום" audit rows as the items are rewritten. See
  -- db/sql/fix_order_line_total_pricing.sql.
  perform set_config('app.skip_order_total_recalc', 'on', true);

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    if v_product_id is null or v_qty <= 0 or v_unit_price < 0 or v_line_discount < 0 then
      raise exception 'Invalid order item payload';
    end if;

    select coalesce(sum(im.quantity), 0)
    into v_existing_movement_qty
    from public.inventory_movements im
    where im.source_type = 'order'
      and im.source_id = p_order_id
      and im.product_id = v_product_id;

    select
      coalesce(i.quantity_on_hand, 0),
      coalesce(i.quantity_reserved, 0)
    into
      v_stock_on_hand,
      v_stock_reserved
    from public.inventory i
    where i.product_id = v_product_id
    for update;

    if not found then
      v_stock_on_hand := 0;
      v_stock_reserved := 0;
    end if;

    -- Backorders are allowed: an order may be placed for more than is in stock.
    -- The reservation can exceed on-hand (available goes negative), which is how
    -- we flag an order as containing out-of-stock items. No hard stock block.
    v_stock_available := greatest(v_stock_on_hand - v_stock_reserved, 0) + v_existing_movement_qty;
  end loop;

  delete from public.inventory_movements
  where source_type = 'order' and source_id = p_order_id;

  delete from public.order_items where order_id = p_order_id;

  update public.orders
  set customer_id = p_customer_id,
      order_date = p_order_date,
      status = coalesce(nullif(trim(v_target_status), ''), 'draft'),
      subtotal = coalesce(p_subtotal, 0),
      discount_amount = coalesce(p_discount_amount, 0),
      total_amount = coalesce(p_total_amount, 0),
      payment_status = coalesce(nullif(trim(p_payment_status), ''), 'unpaid'),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      payment_terms = nullif(trim(coalesce(p_payment_terms, '')), ''),
      due_date = p_due_date,
      -- only the "אישור אספקה" flow sends a delivery date; never wipe an existing one
      delivery_confirmed_at = coalesce(p_delivery_date, delivery_confirmed_at)
  where id = p_order_id;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    v_quantity_delivered := case
      when v_target_status in ('delivered', 'completed', 'closed') then v_qty
      else 0
    end;

    -- Stock model: delivered/completed/closed consume stock (`out`); cancelled
    -- holds nothing; every other open status reserves stock (`reserve`).
    v_inventory_movement_type := case
      when v_target_status in ('delivered', 'completed', 'closed') then 'out'
      when v_target_status = 'cancelled' then null
      else 'reserve'
    end;

    insert into public.order_items (
      order_id,
      product_id,
      quantity_ordered,
      quantity_delivered,
      unit_price,
      discount_amount,
      notes
    ) values (
      p_order_id,
      v_product_id,
      v_qty,
      v_quantity_delivered,
      v_unit_price,
      v_line_discount,
      nullif(trim(coalesce(v_item->>'notes', '')), '')
    )
    returning id into v_item_id;

    if v_inventory_movement_type is not null then
      insert into public.inventory_movements (
        product_id,
        movement_type,
        quantity,
        source_type,
        source_id,
        performed_by,
        notes
      ) values (
        v_product_id,
        v_inventory_movement_type,
        v_qty,
        'order',
        p_order_id,
        p_updated_by,
        concat('Sales order item ', v_item_id, ' updated')
      );
    end if;
  end loop;

  return p_order_id;
exception
  when others then
    raise;
end;
$$;

grant execute on function public.update_sales_order(
  uuid,
  uuid,
  timestamptz,
  text,
  numeric,
  numeric,
  numeric,
  text,
  uuid,
  text,
  jsonb,
  text,
  date,
  timestamptz
) to authenticated;
