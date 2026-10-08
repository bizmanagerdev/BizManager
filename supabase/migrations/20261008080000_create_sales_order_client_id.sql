-- create_sales_order can keep the id the app gave the order (owner's OK,
-- 2026-10-08): an order saved on the phone first (lib/orders/device-order-writes.ts)
-- is the same order once the server has it — it doesn't vanish and come back
-- under another number, and a page open on it stays on it.
--
-- One new, optional, last parameter: p_order_id. Given, the order gets that
-- id (a clash with an existing order is refused by the database — the route
-- answers a repeat with the order it already made); left out — as every
-- existing caller does — the database picks one, exactly as before. Nothing
-- else in the function changes (body copied from the 15-parameter version in
-- 20261004170000_guard_definer_functions.sql). The lines and payments keep
-- ids the database picks.
--
-- The 15-parameter version is dropped: next to a 16-parameter one whose last
-- parameter has a default, a call without p_order_id would match both
-- (PostgREST refuses an ambiguous call). Same permissions as before.

drop function if exists public.create_sales_order(
  uuid, timestamp with time zone, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, boolean, date, uuid
);

-- create_sales_order (16 params) — callable by: any active role (admin, office, worker)
create or replace function public.create_sales_order(
  p_customer_id uuid,
  p_order_date timestamp with time zone,
  p_status text,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_total_amount numeric,
  p_payment_status text,
  p_created_by uuid,
  p_notes text,
  p_items jsonb,
  p_payment_terms text default null::text,
  p_due_date date default null::date,
  p_needs_invoice boolean default null::boolean,
  p_requested_delivery_date date default null::date,
  p_branch_id uuid default null::uuid,
  p_order_id uuid default null::uuid
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_description text;
  v_qty numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_delivered numeric;
  v_remaining numeric;
  v_normalized_status text;
  v_effective_status text;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
begin
  perform public.require_app_role();  -- guard: require_app_role
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

  -- Resolve delivered qty per line, then decide the effective status.
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

    if v_normalized_status = 'cancelled' then
      v_delivered := 0;
    elsif v_item ? 'quantity_delivered' then
      v_delivered := least(greatest(coalesce((v_item->>'quantity_delivered')::numeric, 0), 0), v_qty);
    else
      v_delivered := case
        when v_normalized_status in ('delivered', 'completed', 'closed') then v_qty
        else 0
      end;
    end if;

    v_total_qty := v_total_qty + v_qty;
    v_total_delivered := v_total_delivered + v_delivered;

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'description', v_description,
      'quantity_ordered', v_qty,
      'quantity_delivered', v_delivered,
      'unit_price', v_unit_price,
      'discount_amount', v_line_discount,
      'notes', nullif(trim(coalesce(v_item->>'notes', '')), '')
    ));
  end loop;

  -- Safety: a "delivered/closed" header with an unfinished line is really partial.
  v_effective_status := case
    when v_normalized_status in ('delivered', 'completed', 'closed')
      and v_total_delivered + 0.0000001 < v_total_qty then 'partially_delivered'
    else v_normalized_status
  end;

  insert into public.orders (
    id, customer_id, order_date, status, subtotal, discount_amount, total_amount,
    payment_status, created_by, notes, payment_terms, due_date, needs_invoice,
    requested_delivery_date, branch_id
  ) values (
    coalesce(p_order_id, gen_random_uuid()),
    p_customer_id, p_order_date, v_effective_status,
    coalesce(p_subtotal, 0), coalesce(p_discount_amount, 0), coalesce(p_total_amount, 0),
    coalesce(nullif(trim(p_payment_status), ''), 'unpaid'), p_created_by,
    nullif(trim(coalesce(p_notes, '')), ''), nullif(trim(coalesce(p_payment_terms, '')), ''),
    p_due_date, p_needs_invoice, p_requested_delivery_date, p_branch_id
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_resolved)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := v_item->>'description';
    v_qty := (v_item->>'quantity_ordered')::numeric;
    v_delivered := (v_item->>'quantity_delivered')::numeric;
    v_remaining := v_qty - v_delivered;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_discount := (v_item->>'discount_amount')::numeric;

    -- Lock the stock row (backorders allowed — no hard block). Custom lines
    -- have no product to lock.
    if v_product_id is not null then
      perform 1 from public.inventory i where i.product_id = v_product_id for update;
    end if;

    insert into public.order_items (
      order_id, product_id, description, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      v_order_id, v_product_id, v_description, v_qty, v_delivered,
      v_unit_price, v_line_discount, nullif(v_item->>'notes', '')
    )
    returning id into v_item_id;

    -- Custom (product-less) lines carry no stock — never move inventory.
    if v_product_id is not null and v_normalized_status <> 'cancelled' then
      if v_delivered > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'out', v_delivered, 'order', v_order_id, p_created_by,
          concat('Sales order item ', v_item_id, ' delivered')
        );
      end if;
      if v_remaining > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'reserve', v_remaining, 'order', v_order_id, p_created_by,
          concat('Sales order item ', v_item_id, ' reserved')
        );
      end if;
    end if;
  end loop;

  return v_order_id;
exception
  when others then
    raise;
end;
$function$;

grant execute on function public.create_sales_order(
  uuid, timestamp with time zone, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, boolean, date, uuid, uuid
) to anon, authenticated, service_role;

-- PostgREST picks up the new signature.
notify pgrst, 'reload schema';
