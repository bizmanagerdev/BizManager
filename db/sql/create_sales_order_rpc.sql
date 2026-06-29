-- Run this script in Supabase SQL Editor.
-- Atomic RPC used by POST /api/orders/create.
-- Aligned to inventory_movements schema:
-- product_id, movement_type, quantity, source_type, source_id, performed_by, notes, created_at
--
-- The order's payment_terms / due_date / needs_invoice are set HERE at INSERT
-- time (not via a follow-up UPDATE in the route). That follow-up UPDATE fired
-- the audit trigger and made every brand-new order show a spurious "עודכן" row
-- in /activity right after "נוצר". Setting them inline keeps creation to a
-- single orders INSERT. (collect_payment_on_delivery stays in the route as a
-- best-effort write — its column only exists after add_collect_payment_on_delivery.sql.)

-- Drop the previous 10-arg signature so adding the new args doesn't leave a
-- second overload (which would make PostgREST ambiguous).
drop function if exists public.create_sales_order(
  uuid, timestamptz, text, numeric, numeric, numeric, text, uuid, text, jsonb
);

create or replace function public.create_sales_order(
  p_customer_id uuid,
  p_order_date timestamptz,
  p_status text,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_total_amount numeric,
  p_payment_status text,
  p_created_by uuid,
  p_notes text,
  p_items jsonb,
  p_payment_terms text default null,
  p_due_date date default null,
  p_needs_invoice boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_qty numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_stock_on_hand numeric;
  v_stock_reserved numeric;
  v_stock_available numeric;
  v_normalized_status text;
  v_quantity_delivered numeric;
  v_inventory_movement_type text;
begin
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;
  if p_order_date is null then
    raise exception 'order_date is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;

  v_normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'draft'));

  -- Silence recalculate_order_totals() for this transaction: this RPC sets the
  -- order totals itself, so the per-item trigger would only re-derive the same
  -- values and emit redundant "עודכן · סכום" audit rows. See
  -- db/sql/fix_order_line_total_pricing.sql.
  perform set_config('app.skip_order_total_recalc', 'on', true);

  insert into public.orders (
    customer_id,
    order_date,
    status,
    subtotal,
    discount_amount,
    total_amount,
    payment_status,
    created_by,
    notes,
    payment_terms,
    due_date,
    needs_invoice
  ) values (
    p_customer_id,
    p_order_date,
    v_normalized_status,
    coalesce(p_subtotal, 0),
    coalesce(p_discount_amount, 0),
    coalesce(p_total_amount, 0),
    coalesce(nullif(trim(p_payment_status), ''), 'unpaid'),
    p_created_by,
    nullif(trim(coalesce(p_notes, '')), ''),
    nullif(trim(coalesce(p_payment_terms, '')), ''),
    p_due_date,
    p_needs_invoice
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    if v_product_id is null or v_qty <= 0 then
      raise exception 'Invalid order item payload';
    end if;

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
    v_stock_available := greatest(v_stock_on_hand - v_stock_reserved, 0);

    v_quantity_delivered := case
      when v_normalized_status in ('delivered', 'completed', 'closed') then v_qty
      else 0
    end;

    -- Stock model: delivered/completed/closed consume stock (`out`); cancelled
    -- holds nothing; every other open status reserves stock (`reserve`).
    v_inventory_movement_type := case
      when v_normalized_status in ('delivered', 'completed', 'closed') then 'out'
      when v_normalized_status = 'cancelled' then null
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
      v_order_id,
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
        v_order_id,
        p_created_by,
        concat('Sales order item ', v_item_id)
      );
    end if;
  end loop;

  return v_order_id;
exception
  when others then
    raise;
end;
$$;

grant execute on function public.create_sales_order(
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
  boolean
) to authenticated;
