-- Run this script in Supabase SQL Editor.
-- It creates an atomic RPC used by POST /api/orders/create.

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
  p_items jsonb
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
  v_final_total numeric;
  v_has_inventory_order_id boolean;
  v_has_inventory_product_id boolean;
  v_has_inventory_movement_type boolean;
  v_has_inventory_quantity boolean;
  v_has_inventory_reference_type boolean;
  v_has_inventory_reference_id boolean;
  v_has_inventory_movement_date boolean;
  v_has_inventory_notes boolean;
  v_has_inventory_created_by boolean;
  v_has_financial_order_id boolean;
  v_inventory_sql text;
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

  insert into public.orders (
    customer_id,
    order_date,
    status,
    subtotal,
    discount_amount,
    total_amount,
    payment_status,
    created_by,
    notes
  ) values (
    p_customer_id,
    p_order_date,
    coalesce(nullif(trim(p_status), ''), 'draft'),
    0,
    coalesce(p_discount_amount, 0),
    0,
    coalesce(nullif(trim(p_payment_status), ''), 'unpaid'),
    p_created_by,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_order_id;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'order_id'
  ) into v_has_inventory_order_id;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'product_id'
  ) into v_has_inventory_product_id;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'movement_type'
  ) into v_has_inventory_movement_type;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'quantity'
  ) into v_has_inventory_quantity;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'reference_type'
  ) into v_has_inventory_reference_type;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'reference_id'
  ) into v_has_inventory_reference_id;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'movement_date'
  ) into v_has_inventory_movement_date;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'notes'
  ) into v_has_inventory_notes;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_movements'
      and column_name = 'created_by'
  ) into v_has_inventory_created_by;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'financial_records'
      and column_name = 'order_id'
  ) into v_has_financial_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    if v_product_id is null or v_qty <= 0 then
      raise exception 'Invalid order item payload';
    end if;

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
      v_qty,
      v_unit_price,
      v_line_discount,
      nullif(trim(coalesce(v_item->>'notes', '')), '')
    )
    returning id into v_item_id;

    if v_has_inventory_product_id and v_has_inventory_movement_type and v_has_inventory_quantity then
      v_inventory_sql := format(
        'insert into public.inventory_movements (product_id,movement_type,quantity%s%s%s%s%s%s) values (%L::uuid,%L,%s%s%s%s%s%s)',
        case when v_has_inventory_order_id then ',order_id' else '' end,
        case when v_has_inventory_reference_type then ',reference_type' else '' end,
        case when v_has_inventory_reference_id then ',reference_id' else '' end,
        case when v_has_inventory_movement_date then ',movement_date' else '' end,
        case when v_has_inventory_notes then ',notes' else '' end,
        case when v_has_inventory_created_by then ',created_by' else '' end,
        v_product_id::text,
        'out',
        v_qty::text,
        case when v_has_inventory_order_id then format(',%L::uuid', v_order_id::text) else '' end,
        case when v_has_inventory_reference_type then format(',%L', 'order') else '' end,
        case when v_has_inventory_reference_id then format(',%L::uuid', v_order_id::text) else '' end,
        case when v_has_inventory_movement_date then format(',%L::timestamptz', p_order_date::text) else '' end,
        case when v_has_inventory_notes then format(',%L', concat('Sales order item ', v_item_id)) else '' end,
        case when v_has_inventory_created_by then format(',%L::uuid', p_created_by::text) else '' end
      );

      execute v_inventory_sql;
    end if;
  end loop;

  select total_amount
  into v_final_total
  from public.orders
  where id = v_order_id;

  if v_has_financial_order_id then
    insert into public.financial_records (
      order_id,
      target_type,
      target_id,
      record_date,
      entry_type,
      amount,
      notes,
      created_by
    ) values (
      v_order_id,
      'order',
      v_order_id,
      p_order_date,
      'income',
      coalesce(v_final_total, 0),
      concat('Sales order ', v_order_id),
      p_created_by
    );
  else
    insert into public.financial_records (
      target_type,
      target_id,
      record_date,
      entry_type,
      amount,
      notes,
      created_by
    ) values (
      'order',
      v_order_id,
      p_order_date,
      'income',
      coalesce(v_final_total, 0),
      concat('Sales order ', v_order_id),
      p_created_by
    );
  end if;

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
  jsonb
) to authenticated;
