-- Partial delivery for sales orders.
--
-- Lets an order be delivered in parts: order_items.quantity_delivered becomes the
-- authoritative per-line fulfillment number, stock movements are derived per line
-- from delivered-vs-ordered (deliver some now → consume those units, reserve the
-- rest), and a new `partially_delivered` status keeps the order in both the open
-- orders tab and the deliveries queue until everything is handed over.
--
-- Idempotent: all statements are drop-if-exists / create-or-replace.

begin;

-- 1) Allow the new status (and align the CHECK with the values the app already
--    uses — the baseline only permitted 4 of them, which was latent drift).
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (
  status = any (array[
    'draft',
    'reserved',
    'confirmed',
    'processing',
    'out_for_delivery',
    'partially_delivered',
    'delivered',
    'completed',
    'closed',
    'cancelled'
  ]::text[])
);

-- 2) Keep partially-delivered orders in the deliveries queue.
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
  'out_for_delivery',
  'partially_delivered'
);

grant select on public.delivery_overview_view to authenticated;

-- 3) create_sales_order: derive stock movements per line from delivered qty.
--    delivered units → 'out'; remaining ordered units → 'reserve'; cancelled → none.
--    quantity_delivered is optional in the payload; when absent it falls back to
--    the status (delivered/completed/closed → full, else 0), preserving old behavior.
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
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    if v_product_id is null or v_qty <= 0 then
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
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity_ordered')::numeric;
    v_delivered := (v_item->>'quantity_delivered')::numeric;
    v_remaining := v_qty - v_delivered;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_discount := (v_item->>'discount_amount')::numeric;

    -- Lock the stock row (backorders allowed — no hard block).
    perform 1 from public.inventory i where i.product_id = v_product_id for update;

    insert into public.order_items (
      order_id, product_id, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      v_order_id, v_product_id, v_qty, v_delivered,
      v_unit_price, v_line_discount, nullif(v_item->>'notes', '')
    )
    returning id into v_item_id;

    -- Consume the delivered units; reserve the rest. Cancelled holds nothing.
    if v_normalized_status <> 'cancelled' and v_delivered > 0 then
      insert into public.inventory_movements (
        product_id, movement_type, quantity, source_type, source_id, performed_by, notes
      ) values (
        v_product_id, 'out', v_delivered, 'order', v_order_id, p_created_by,
        concat('Sales order item ', v_item_id, ' delivered')
      );
    end if;
    if v_normalized_status <> 'cancelled' and v_remaining > 0 then
      insert into public.inventory_movements (
        product_id, movement_type, quantity, source_type, source_id, performed_by, notes
      ) values (
        v_product_id, 'reserve', v_remaining, 'order', v_order_id, p_created_by,
        concat('Sales order item ', v_item_id, ' reserved')
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
  uuid, timestamptz, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, boolean
) to authenticated;

-- 4) update_sales_order: same per-line movement model, plus preserve prior
--    delivered progress when the payload omits quantity_delivered (normal edits).
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
  v_delivered numeric;
  v_remaining numeric;
  v_prior numeric;
  v_target_status text;
  v_effective_status text;
  v_prior_delivered jsonb;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
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

  perform set_config('app.skip_order_total_recalc', 'on', true);

  -- Snapshot delivered-so-far per product BEFORE we delete the lines, so a normal
  -- edit (which sends no quantity_delivered) doesn't wipe delivery progress.
  select coalesce(jsonb_object_agg(product_id::text, delivered), '{}'::jsonb)
  into v_prior_delivered
  from (
    select product_id, sum(quantity_delivered) as delivered
    from public.order_items
    where order_id = p_order_id
    group by product_id
  ) s;

  -- Resolve delivered qty per line, decide effective status.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    if v_product_id is null or v_qty <= 0 or v_unit_price < 0 or v_line_discount < 0 then
      raise exception 'Invalid order item payload';
    end if;

    if v_target_status = 'cancelled' then
      v_delivered := 0;
    elsif v_item ? 'quantity_delivered' then
      -- Authoritative (the אישור אספקה flow sends cumulative delivered per line).
      v_delivered := least(greatest(coalesce((v_item->>'quantity_delivered')::numeric, 0), 0), v_qty);
    else
      -- Restore from the pre-edit snapshot (drained across duplicate product lines).
      v_prior := coalesce((v_prior_delivered->>v_product_id::text)::numeric, 0);
      v_delivered := least(v_prior, v_qty);
      v_prior_delivered := jsonb_set(
        v_prior_delivered, array[v_product_id::text], to_jsonb(greatest(v_prior - v_delivered, 0))
      );
    end if;

    v_total_qty := v_total_qty + v_qty;
    v_total_delivered := v_total_delivered + v_delivered;

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
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
      delivery_confirmed_at = coalesce(p_delivery_date, delivery_confirmed_at)
  where id = p_order_id;

  for v_item in select value from jsonb_array_elements(v_resolved)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity_ordered')::numeric;
    v_delivered := (v_item->>'quantity_delivered')::numeric;
    v_remaining := v_qty - v_delivered;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_discount := (v_item->>'discount_amount')::numeric;

    perform 1 from public.inventory i where i.product_id = v_product_id for update;

    insert into public.order_items (
      order_id, product_id, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      p_order_id, v_product_id, v_qty, v_delivered,
      v_unit_price, v_line_discount, nullif(v_item->>'notes', '')
    )
    returning id into v_item_id;

    if v_target_status <> 'cancelled' and v_delivered > 0 then
      insert into public.inventory_movements (
        product_id, movement_type, quantity, source_type, source_id, performed_by, notes
      ) values (
        v_product_id, 'out', v_delivered, 'order', p_order_id, p_updated_by,
        concat('Sales order item ', v_item_id, ' delivered')
      );
    end if;
    if v_target_status <> 'cancelled' and v_remaining > 0 then
      insert into public.inventory_movements (
        product_id, movement_type, quantity, source_type, source_id, performed_by, notes
      ) values (
        v_product_id, 'reserve', v_remaining, 'order', p_order_id, p_updated_by,
        concat('Sales order item ', v_item_id, ' reserved')
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
  uuid, uuid, timestamptz, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, timestamptz
) to authenticated;

commit;
