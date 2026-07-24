-- Off-catalog ("custom") order lines: a one-off charge such as "משלוח" or a
-- non-catalog item, entered with a free-text name + price and NO product_id.
--
-- 1) order_items.product_id becomes nullable, and a `description` column holds
--    the custom line's name (null for normal catalog lines).
-- 2) create_sales_order / update_sales_order accept a line with a null/empty
--    product_id as long as it carries a description; such lines skip all
--    inventory reservation/consumption (there's no product to move stock for).
--
-- Signatures are UNCHANGED (the custom fields ride inside the p_items jsonb), so
-- this is a pure CREATE OR REPLACE — the catalog path is byte-for-byte the same.
-- Idempotent: safe to run more than once.

alter table public.order_items alter column product_id drop not null;
alter table public.order_items add column if not exists description text;

-- ── create_sales_order ──────────────────────────────────────────────────────
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
  v_description text;
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

  perform set_config('app.skip_order_total_recalc', 'on', true);

  insert into public.orders (
    customer_id, order_date, status, subtotal, discount_amount, total_amount,
    payment_status, created_by, notes, payment_terms, due_date, needs_invoice
  ) values (
    p_customer_id, p_order_date, v_normalized_status,
    coalesce(p_subtotal, 0), coalesce(p_discount_amount, 0), coalesce(p_total_amount, 0),
    coalesce(nullif(trim(p_payment_status), ''), 'unpaid'), p_created_by,
    nullif(trim(coalesce(p_notes, '')), ''), nullif(trim(coalesce(p_payment_terms, '')), ''),
    p_due_date, p_needs_invoice
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    -- A line must be either a catalog product OR a described custom line.
    if (v_product_id is null and v_description is null) or v_qty <= 0 then
      raise exception 'Invalid order item payload';
    end if;

    v_quantity_delivered := case
      when v_normalized_status in ('delivered', 'completed', 'closed') then v_qty
      else 0
    end;

    insert into public.order_items (
      order_id, product_id, description, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      v_order_id, v_product_id, v_description, v_qty, v_quantity_delivered,
      v_unit_price, v_line_discount, nullif(trim(coalesce(v_item->>'notes', '')), '')
    )
    returning id into v_item_id;

    -- Custom (product-less) lines carry no stock, so they never move inventory.
    if v_product_id is not null then
      select coalesce(i.quantity_on_hand, 0), coalesce(i.quantity_reserved, 0)
      into v_stock_on_hand, v_stock_reserved
      from public.inventory i
      where i.product_id = v_product_id
      for update;
      if not found then
        v_stock_on_hand := 0;
        v_stock_reserved := 0;
      end if;
      v_stock_available := greatest(v_stock_on_hand - v_stock_reserved, 0);

      v_inventory_movement_type := case
        when v_normalized_status in ('delivered', 'completed', 'closed') then 'out'
        when v_normalized_status = 'cancelled' then null
        else 'reserve'
      end;

      if v_inventory_movement_type is not null then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, v_inventory_movement_type, v_qty, 'order', v_order_id, p_created_by,
          concat('Sales order item ', v_item_id)
        );
      end if;
    end if;
  end loop;

  return v_order_id;
exception
  when others then
    raise;
end;
$$;

grant execute on function public.create_sales_order(
  uuid, timestamptz, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, boolean
) to authenticated;

-- ── update_sales_order ──────────────────────────────────────────────────────
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
  v_description text;
  v_qty numeric;
  v_unit_price numeric;
  v_line_discount numeric;
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

  select coalesce(nullif(lower(trim(p_status)), ''), lower(coalesce(o.status, 'draft')))
  into v_target_status
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  -- Validate every line up front (catalog OR described custom line).
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    if (v_product_id is null and v_description is null)
       or v_qty <= 0 or v_unit_price < 0 or v_line_discount < 0 then
      raise exception 'Invalid order item payload';
    end if;
  end loop;

  perform set_config('app.skip_order_total_recalc', 'on', true);

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
      delivery_confirmed_at = coalesce(p_delivery_date, delivery_confirmed_at)
  where id = p_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    v_quantity_delivered := case
      when v_target_status in ('delivered', 'completed', 'closed') then v_qty
      else 0
    end;

    insert into public.order_items (
      order_id, product_id, description, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      p_order_id, v_product_id, v_description, v_qty, v_quantity_delivered,
      v_unit_price, v_line_discount, nullif(trim(coalesce(v_item->>'notes', '')), '')
    )
    returning id into v_item_id;

    -- Custom (product-less) lines carry no stock.
    if v_product_id is not null then
      v_inventory_movement_type := case
        when v_target_status in ('delivered', 'completed', 'closed') then 'out'
        when v_target_status = 'cancelled' then null
        else 'reserve'
      end;

      if v_inventory_movement_type is not null then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, v_inventory_movement_type, v_qty, 'order', p_order_id, p_updated_by,
          concat('Sales order item ', v_item_id, ' updated')
        );
      end if;
    end if;
  end loop;

  return p_order_id;
exception
  when others then
    raise;
end;
$$;

grant execute on function public.update_sales_order(
  uuid, uuid, timestamptz, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, timestamptz
) to authenticated;
