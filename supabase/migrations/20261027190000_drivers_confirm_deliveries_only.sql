-- ════════════════════════════════════════════════════════════════════════════
-- A driver updates and confirms deliveries; the money stays the office's
-- (security audit, 2026-10-27). Owner: "on delivery the driver may change
-- quantities affecting the order price, he may record the payment partial or
-- full and needs access to anything that has to do with that: adding photos,
-- adding notes, confirming, updating … workers can give a refund; workers do
-- not create new orders themselves, only update and confirm delivery"; "he
-- could add items and remove and he could change the customer details and
-- dates".
--
-- update_sales_order and create_sales_order are SECURITY DEFINER (they bypass
-- RLS) and only checked that the caller is an active user, so a worker calling
-- /rest/v1/rpc/update_sales_order could set any price, discount or total on any
-- order — and the API route then issues Morning documents for it.
--
-- 1. update_sales_order, for a worker only (staff unchanged):
--    - the order must still be open for delivery (order_is_worker_deliverable),
--      and he can't cancel or close it;
--    - he may add and remove items, change quantities, the customer, the dates,
--      notes, payments and refunds — as the delivery-confirm screen does;
--    - prices are the office's: a line already on the order keeps its price and
--      discount, a product added on the spot gets its price-list price
--      (products.base_price, as the screen does) with no discount. Set here,
--      whatever the caller sent, so a driver is never refused over them. Only
--      catalog products (no custom lines);
--    - the order's discount, payment terms and due date stay as stored, and the
--      subtotal and total are worked out here from the lines (lib/orders/
--      order-input.ts's orderTotals), not taken from the caller;
--    - branch and requested delivery date stay as stored unless sent. The
--      delivery-confirm screen sends neither, and the route filled them with
--      blanks — every confirmation reset them (and the terms and due date);
--      a driver's no longer does.
--    The added block sits between the two "-- driver rule" marker lines.
-- 2. create_sales_order (all three versions): admin and office only.
--
-- ROLLBACK: supabase/rollbacks/20261027190000_drivers_confirm_deliveries_only.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. update_sales_order: the driver rule ──────────────────────────────────
do $mig$
declare
  v_fn regprocedure := to_regprocedure(
    'public.update_sales_order(uuid,uuid,timestamp with time zone,text,numeric,numeric,numeric,text,uuid,text,jsonb,text,date,timestamp with time zone,date,uuid,jsonb,jsonb)'
  );
  v_def text;
  v_new text;
  v_rule text := $rule$
  -- driver rule (20261027190000) begin
  if public.current_user_role() = 'worker' then
    if not public.order_is_worker_deliverable(p_order_id)
       or v_target_status in ('cancelled', 'closed') then
      raise exception 'No access' using errcode = '42501';
    end if;

    if exists (
      select 1 from jsonb_array_elements(p_items) i
      where not exists (
        select 1 from public.products pr where pr.id = nullif(i->>'product_id', '')::uuid
      )
    ) then
      raise exception 'No access' using errcode = '42501',
        hint = 'A driver adds catalog products only.';
    end if;

    select o.discount_amount, o.payment_terms, o.due_date,
           coalesce(p_requested_delivery_date, o.requested_delivery_date),
           coalesce(p_branch_id, o.branch_id)
    into p_discount_amount, p_payment_terms, p_due_date,
         p_requested_delivery_date, p_branch_id
    from public.orders o
    where o.id = p_order_id;

    select coalesce(jsonb_agg(
             t.i || jsonb_build_object(
               'unit_price', coalesce(ol.unit_price, pr.base_price, 0),
               'discount_amount', coalesce(ol.discount_amount, 0)
             ) order by t.ord), '[]'::jsonb)
    into p_items
    from jsonb_array_elements(p_items) with ordinality t(i, ord)
    join public.products pr on pr.id = (t.i->>'product_id')::uuid
    left join lateral (
      select oi.unit_price, oi.discount_amount
      from public.order_items oi
      where oi.order_id = p_order_id and oi.product_id = pr.id
      order by oi.id
      limit 1
    ) ol on true;

    select coalesce(sum(
             coalesce((i->>'quantity_ordered')::numeric, 0) * (i->>'unit_price')::numeric
             - (i->>'discount_amount')::numeric
           ), 0)
    into p_subtotal
    from jsonb_array_elements(p_items) i;
    p_total_amount := greatest(p_subtotal - coalesce(p_discount_amount, 0), 0);
  end if;
  -- driver rule end
$rule$;
begin
  if v_fn is null then
    raise exception 'update_sales_order not found';
  end if;

  v_def := replace(pg_get_functiondef(v_fn), E'\r\n', E'\n');
  if position('-- driver rule (20261027190000) begin' in v_def) = 0 then
    v_new := regexp_replace(
      v_def,
      E'(raise exception ''order not found'';\\n  end if;\\n)',
      E'\\1' || replace(v_rule, E'\\', E'\\\\')
    );
    if v_new = v_def then
      raise exception 'driver rule not placed in update_sales_order';
    end if;
    execute v_new;
  end if;
end
$mig$;

-- ── 2. create_sales_order: admin and office only ─────────────────────────────
do $mig$
declare
  v_fn regprocedure;
  v_def text;
  v_new text;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_sales_order'
  loop
    v_def := replace(pg_get_functiondef(v_fn), E'\r\n', E'\n');
    v_new := replace(
      v_def,
      'perform public.require_app_role();  -- guard: require_app_role',
      'perform public.require_app_role(array[''admin'', ''office'']::public.user_role_enum[]);  -- guard: require_app_role'
    );
    if v_new <> v_def then
      execute v_new;
    elsif position('array[''admin'', ''office'']' in v_def) = 0 then
      raise exception 'admin/office check not placed in %', v_fn;
    end if;
  end loop;
end
$mig$;
