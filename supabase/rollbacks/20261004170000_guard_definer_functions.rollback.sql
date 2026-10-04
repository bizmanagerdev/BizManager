-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for supabase/migrations/20261004170000_guard_definer_functions.sql
--
-- Restores the nine functions exactly as they were before the guard (the same
-- definitions, verified md5-identical to production on 2026-10-04), then drops
-- the helper. Run it in the SQL editor ONLY if the guard migration causes a
-- problem. This folder is not replayed by CI or "supabase db push".
-- ════════════════════════════════════════════════════════════════════════════

-- update_sales_order (18 params)
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
  p_delivery_date timestamptz default null,
  p_requested_delivery_date date default null,
  p_branch_id uuid default null,
  p_payments jsonb default '[]'::jsonb,
  p_refunds jsonb default '[]'::jsonb
)
returns jsonb
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
  v_delivered numeric;
  v_remaining numeric;
  v_prior numeric;
  v_target_status text;
  v_effective_status text;
  v_prior_delivered jsonb;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
  v_payment_id uuid;
  v_payment_ids jsonb := '[]'::jsonb;
  v_refund_ids jsonb := '[]'::jsonb;
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
  if p_payments is not null and jsonb_typeof(p_payments) <> 'array' then
    raise exception 'payments must be an array';
  end if;
  if p_refunds is not null and jsonb_typeof(p_refunds) <> 'array' then
    raise exception 'refunds must be an array';
  end if;

  select coalesce(nullif(lower(trim(p_status)), ''), lower(coalesce(o.status, 'draft')))
  into v_target_status
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  perform set_config('app.skip_order_total_recalc', 'on', true);

  -- Snapshot delivered-so-far per product BEFORE we delete the lines, so a normal
  -- edit (which sends no quantity_delivered) doesn't wipe delivery progress.
  -- Catalog lines only — a custom line has no product_id to key this by.
  select coalesce(jsonb_object_agg(product_id::text, delivered), '{}'::jsonb)
  into v_prior_delivered
  from (
    select product_id, sum(quantity_delivered) as delivered
    from public.order_items
    where order_id = p_order_id and product_id is not null
    group by product_id
  ) s;

  -- Resolve delivered qty per line, decide effective status.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    -- A line must be either a catalog product OR a described custom line.
    if (v_product_id is null and v_description is null)
       or v_qty <= 0 or v_unit_price < 0 or v_line_discount < 0 then
      raise exception 'Invalid order item payload';
    end if;

    if v_target_status = 'cancelled' then
      v_delivered := 0;
    elsif v_item ? 'quantity_delivered' then
      -- Authoritative (the אישור אספקה flow sends cumulative delivered per line).
      v_delivered := least(greatest(coalesce((v_item->>'quantity_delivered')::numeric, 0), 0), v_qty);
    elsif v_product_id is not null then
      -- Restore from the pre-edit snapshot (drained across duplicate product lines).
      v_prior := coalesce((v_prior_delivered->>v_product_id::text)::numeric, 0);
      v_delivered := least(v_prior, v_qty);
      v_prior_delivered := jsonb_set(
        v_prior_delivered, array[v_product_id::text], to_jsonb(greatest(v_prior - v_delivered, 0))
      );
    else
      -- Custom line, no quantity_delivered sent and nothing to restore — fall
      -- back to the status-derived default, same as a catalog line with no history.
      v_delivered := case
        when v_target_status in ('delivered', 'completed', 'closed') then v_qty
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

  v_effective_status := case
    when v_target_status in ('delivered', 'completed', 'closed')
      and v_total_delivered + 0.0000001 < v_total_qty then 'partially_delivered'
    else v_target_status
  end;

  delete from public.inventory_movements
  where source_type = 'order' and source_id = p_order_id;

  delete from public.order_items where order_id = p_order_id;

  update public.orders
  set customer_id = p_customer_id,
      order_date = p_order_date,
      status = coalesce(nullif(trim(v_effective_status), ''), 'draft'),
      subtotal = coalesce(p_subtotal, 0),
      discount_amount = coalesce(p_discount_amount, 0),
      total_amount = coalesce(p_total_amount, 0),
      payment_status = coalesce(nullif(trim(p_payment_status), ''), 'unpaid'),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      payment_terms = nullif(trim(coalesce(p_payment_terms, '')), ''),
      due_date = p_due_date,
      -- only the "אישור אספקה" flow sends a delivery date; never wipe an existing one
      delivery_confirmed_at = coalesce(p_delivery_date, delivery_confirmed_at),
      -- freely editable any time the wizard is saved, unlike delivery_confirmed_at
      requested_delivery_date = p_requested_delivery_date,
      branch_id = p_branch_id
  where id = p_order_id;

  for v_item in select value from jsonb_array_elements(v_resolved)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := v_item->>'description';
    v_qty := (v_item->>'quantity_ordered')::numeric;
    v_delivered := (v_item->>'quantity_delivered')::numeric;
    v_remaining := v_qty - v_delivered;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_discount := (v_item->>'discount_amount')::numeric;

    if v_product_id is not null then
      perform 1 from public.inventory i where i.product_id = v_product_id for update;
    end if;

    insert into public.order_items (
      order_id, product_id, description, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      p_order_id, v_product_id, v_description, v_qty, v_delivered,
      v_unit_price, v_line_discount, nullif(v_item->>'notes', '')
    )
    returning id into v_item_id;

    if v_product_id is not null and v_target_status <> 'cancelled' then
      if v_delivered > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'out', v_delivered, 'order', p_order_id, p_updated_by,
          concat('Sales order item ', v_item_id, ' delivered')
        );
      end if;
      if v_remaining > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'reserve', v_remaining, 'order', p_order_id, p_updated_by,
          concat('Sales order item ', v_item_id, ' reserved')
        );
      end if;
    end if;
  end loop;

  -- ── Money rows, same transaction ──────────────────────────────────────────
  -- Rows arrive already shaped by buildPaymentInsert (amounts, VAT split,
  -- payment_status by method, due_date). A refund is a negative amount_total.
  -- Identity columns come from the RPC arguments, not from the row.
  for v_item in
    select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
  loop
    if nullif(v_item->>'amount_total', '') is null
       or (v_item->>'amount_total')::numeric <= 0
       or nullif(trim(coalesce(v_item->>'payment_method', '')), '') is null then
      raise exception 'Invalid payment payload';
    end if;

    insert into public.payments (
      payment_date, amount_total, payment_method, reference_number, check_number,
      amount_including_vat, amount_before_vat, net_amount, vat_amount, vat_rate,
      payment_status, business_domain, project_id, order_id, property_id,
      due_date, requires_split, notes, recorded_by, account_id
    ) values (
      coalesce((v_item->>'payment_date')::timestamptz, now()),
      (v_item->>'amount_total')::numeric,
      trim(v_item->>'payment_method'),
      nullif(v_item->>'reference_number', ''),
      nullif(v_item->>'check_number', ''),
      (v_item->>'amount_including_vat')::numeric,
      (v_item->>'amount_before_vat')::numeric,
      coalesce((v_item->>'net_amount')::numeric, (v_item->>'amount_total')::numeric),
      coalesce((v_item->>'vat_amount')::numeric, 0),
      coalesce((v_item->>'vat_rate')::numeric, 0),
      coalesce(nullif(v_item->>'payment_status', ''), 'pending')::payment_status_enum,
      'sales'::business_domain_enum,
      null,
      p_order_id,
      null,
      (v_item->>'due_date')::date,
      coalesce((v_item->>'requires_split')::boolean, false),
      nullif(v_item->>'notes', ''),
      p_updated_by,
      nullif(v_item->>'account_id', '')::uuid
    )
    returning id into v_payment_id;

    v_payment_ids := v_payment_ids || to_jsonb(v_payment_id);
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_refunds, '[]'::jsonb))
  loop
    if nullif(v_item->>'amount_total', '') is null
       or (v_item->>'amount_total')::numeric >= 0
       or nullif(trim(coalesce(v_item->>'payment_method', '')), '') is null then
      raise exception 'Invalid refund payload';
    end if;

    insert into public.payments (
      payment_date, amount_total, payment_method, reference_number, check_number,
      amount_including_vat, amount_before_vat, net_amount, vat_amount, vat_rate,
      payment_status, business_domain, project_id, order_id, property_id,
      due_date, requires_split, notes, recorded_by, account_id
    ) values (
      coalesce((v_item->>'payment_date')::timestamptz, now()),
      (v_item->>'amount_total')::numeric,
      trim(v_item->>'payment_method'),
      nullif(v_item->>'reference_number', ''),
      nullif(v_item->>'check_number', ''),
      (v_item->>'amount_including_vat')::numeric,
      (v_item->>'amount_before_vat')::numeric,
      coalesce((v_item->>'net_amount')::numeric, (v_item->>'amount_total')::numeric),
      coalesce((v_item->>'vat_amount')::numeric, 0),
      coalesce((v_item->>'vat_rate')::numeric, 0),
      coalesce(nullif(v_item->>'payment_status', ''), 'pending')::payment_status_enum,
      'sales'::business_domain_enum,
      null,
      p_order_id,
      null,
      (v_item->>'due_date')::date,
      coalesce((v_item->>'requires_split')::boolean, false),
      nullif(v_item->>'notes', ''),
      p_updated_by,
      nullif(v_item->>'account_id', '')::uuid
    )
    returning id into v_payment_id;

    v_refund_ids := v_refund_ids || to_jsonb(v_payment_id);
  end loop;

  return jsonb_build_object(
    'order_id', p_order_id,
    'payment_ids', v_payment_ids,
    'refund_ids', v_refund_ids
  );
exception
  when others then
    raise;
end;
$$;

-- create_sales_order (13 params)
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
  v_delivered numeric;
  v_remaining numeric;
  v_normalized_status text;
  v_effective_status text;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
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
    customer_id, order_date, status, subtotal, discount_amount, total_amount,
    payment_status, created_by, notes, payment_terms, due_date, needs_invoice
  ) values (
    p_customer_id, p_order_date, v_effective_status,
    coalesce(p_subtotal, 0), coalesce(p_discount_amount, 0), coalesce(p_total_amount, 0),
    coalesce(nullif(trim(p_payment_status), ''), 'unpaid'), p_created_by,
    nullif(trim(coalesce(p_notes, '')), ''), nullif(trim(coalesce(p_payment_terms, '')), ''),
    p_due_date, p_needs_invoice
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
$$;

-- create_sales_order (14 params)
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
  p_needs_invoice boolean default null,
  p_requested_delivery_date date default null
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
  v_delivered numeric;
  v_remaining numeric;
  v_normalized_status text;
  v_effective_status text;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
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
    customer_id, order_date, status, subtotal, discount_amount, total_amount,
    payment_status, created_by, notes, payment_terms, due_date, needs_invoice,
    requested_delivery_date
  ) values (
    p_customer_id, p_order_date, v_effective_status,
    coalesce(p_subtotal, 0), coalesce(p_discount_amount, 0), coalesce(p_total_amount, 0),
    coalesce(nullif(trim(p_payment_status), ''), 'unpaid'), p_created_by,
    nullif(trim(coalesce(p_notes, '')), ''), nullif(trim(coalesce(p_payment_terms, '')), ''),
    p_due_date, p_needs_invoice, p_requested_delivery_date
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
$$;

-- create_sales_order (15 params)
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
  p_needs_invoice boolean default null,
  p_requested_delivery_date date default null,
  p_branch_id uuid default null
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
  v_delivered numeric;
  v_remaining numeric;
  v_normalized_status text;
  v_effective_status text;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
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
    customer_id, order_date, status, subtotal, discount_amount, total_amount,
    payment_status, created_by, notes, payment_terms, due_date, needs_invoice,
    requested_delivery_date, branch_id
  ) values (
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
$$;

-- tag_rollup (0 params)
create or replace function public.tag_rollup() RETURNS TABLE(tag_id uuid, total_expense_amount numeric, paid_expense_amount numeric, total_income_amount numeric, task_count bigint, open_task_count bigint, document_count bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    t.id as tag_id,
    coalesce(ex.total_amount, 0),
    coalesce(ex.paid_amount, 0),
    coalesce(pm.income_amount, 0),
    coalesce(tk.task_count, 0),
    coalesce(tk.open_task_count, 0),
    coalesce(dc.document_count, 0)
  from public.tags t
  left join (
    select et.tag_id,
           sum(e.amount) as total_amount,
           sum(case when e.payment_status = 'paid' then e.amount
                    else coalesce(e.paid_amount, 0) end) as paid_amount
    from public.entity_tags et
    join public.expenses e on e.id = et.entity_id
    where et.entity_type = 'expense'
    group by et.tag_id
  ) ex on ex.tag_id = t.id
  left join (
    select et.tag_id, sum(p.amount_total) as income_amount
    from public.entity_tags et
    join public.payments p on p.id = et.entity_id
    where et.entity_type = 'payment'
    group by et.tag_id
  ) pm on pm.tag_id = t.id
  left join (
    select et.tag_id,
           count(*) as task_count,
           count(*) filter (
             where coalesce(ts.status,'todo') not in ('done','cancelled')
           ) as open_task_count
    from public.entity_tags et
    join public.tasks ts on ts.id = et.entity_id
    where et.entity_type = 'task'
    group by et.tag_id
  ) tk on tk.tag_id = t.id
  left join (
    select et.tag_id, count(*) as document_count
    from public.entity_tags et
    where et.entity_type = 'document'
    group by et.tag_id
  ) dc on dc.tag_id = t.id;
$$;

-- release_order_inventory (1 params)
create or replace function public.release_order_inventory(p_order_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- set_audit_logging (1 params)
CREATE OR REPLACE FUNCTION public.set_audit_logging(p_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
begin
  -- Only admins may toggle.
  if not exists (
    select 1 from public.users
    where auth_user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'forbidden';
  end if;

  -- Enable/disable each trigger backed by public.log_changes, by exact name,
  -- so we never touch unrelated business triggers on the same table.
  for r in
    select c.relname as table_name, tg.tgname as trigger_name
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and tg.tgfoid = 'public.log_changes'::regproc
      and not tg.tgisinternal
  loop
    execute format(
      'alter table public.%I %s trigger %I',
      r.table_name,
      case when p_enabled then 'enable' else 'disable' end,
      r.trigger_name
    );
  end loop;

  update public.business_settings
    set audit_logging_enabled = p_enabled
    where id = true;

  return p_enabled;
end;
$function$;

-- get_alert_rule_metrics (1 params)
create or replace function public.get_alert_rule_metrics(days integer DEFAULT 30) RETURNS TABLE(rule_key text, fired integer, still_open integer, resolved integer, snoozed integer, pushed integer, resolved_unpushed integer, avg_resolve_hours numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    coalesce(nullif(split_part(r.dedupe_key, ':', 1), ''), 'manual')                    as rule_key,
    count(*)::int                                                                        as fired,
    count(*) filter (where r.status = 'pending')::int                                    as still_open,
    count(*) filter (where r.status in ('auto_resolved', 'done'))::int                   as resolved,
    count(*) filter (where r.snoozed_until is not null)::int                             as snoozed,
    count(*) filter (where r.notified_at is not null)::int                               as pushed,
    count(*) filter (where r.status in ('auto_resolved', 'done')
                       and r.notified_at is null)::int                                    as resolved_unpushed,
    round(
      avg(extract(epoch from (r.resolved_at - r.created_at)) / 3600.0)
        filter (where r.resolved_at is not null),
      1
    )                                                                                    as avg_resolve_hours
  from public.reminders r
  where r.source = 'system'
    and r.created_at >= now() - make_interval(days => greatest(days, 1))
    and exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.role = 'admin')
  group by 1
  order by fired desc;
$$;

-- get_alert_read_metrics (1 params)
create or replace function public.get_alert_read_metrics(days int default 30)
returns table (
  category   text,
  delivered  int,
  read_count int
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(nullif(n.category, ''), 'other')                as category,
    count(*)::int                                            as delivered,
    count(*) filter (where n.read_at is not null)::int       as read_count
  from public.notifications n
  where n.created_at >= now() - make_interval(days => greatest(days, 1))
    and exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.role = 'admin')
  group by 1
  order by delivered desc;
$$;

drop function if exists public.require_app_role(public.user_role_enum[]);
