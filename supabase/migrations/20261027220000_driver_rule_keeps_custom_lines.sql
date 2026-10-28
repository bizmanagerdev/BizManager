-- ════════════════════════════════════════════════════════════════════════════
-- The driver rule (20261027190000) keeps an order's off-catalog lines.
--
-- It refused every line without a catalog product, so a driver could not
-- confirm an order that had an off-catalog ("custom") line — a description
-- and no product, which order_items.product_id is nullable for
-- (20260724020000_order_items_custom_lines.sql). CI's e2e worker-deliveries
-- tests confirm exactly such an order and failed on 76e5b33f. None of the 406
-- lines on live is off-catalog today, so no driver was refused.
--
-- Now an off-catalog line that is already on the order is allowed and keeps
-- its stored price and discount, matched by its description, as a catalog
-- line keeps its own. A NEW off-catalog line from a driver is still refused:
-- the delivery-confirm screen only adds catalog products, and its price
-- would be the driver's.
--
-- Same marker lines, so 20261027190000's rollback still takes the whole rule
-- out.
--
-- ROLLBACK: supabase/rollbacks/20261027220000_driver_rule_keeps_custom_lines.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

do $mig$
declare
  v_fn regprocedure := to_regprocedure(
    'public.update_sales_order(uuid,uuid,timestamp with time zone,text,numeric,numeric,numeric,text,uuid,text,jsonb,text,date,timestamp with time zone,date,uuid,jsonb,jsonb)'
  );
  v_def text;
  v_new text;
  v_rule text := $rule$  -- driver rule (20261027190000) begin
  if public.current_user_role() = 'worker' then
    if not public.order_is_worker_deliverable(p_order_id)
       or v_target_status in ('cancelled', 'closed') then
      raise exception 'No access' using errcode = '42501';
    end if;

    -- A catalog product, or an off-catalog line already on the order
    -- (by its description, 20261027220000).
    if exists (
      select 1 from jsonb_array_elements(p_items) i
      where case
        when nullif(i->>'product_id', '') is not null then not exists (
          select 1 from public.products pr where pr.id = (i->>'product_id')::uuid
        )
        else not exists (
          select 1 from public.order_items oi
          where oi.order_id = p_order_id
            and oi.product_id is null
            and oi.description is not distinct from i->>'description'
        )
      end
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
    left join public.products pr on pr.id = nullif(t.i->>'product_id', '')::uuid
    left join lateral (
      select oi.unit_price, oi.discount_amount
      from public.order_items oi
      where oi.order_id = p_order_id
        and case
          when pr.id is not null then oi.product_id = pr.id
          else oi.product_id is null and oi.description is not distinct from t.i->>'description'
        end
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
  if position('(by its description, 20261027220000)' in v_def) = 0 then
    v_new := regexp_replace(
      v_def,
      E'  -- driver rule \\(20261027190000\\) begin\\n.*?  -- driver rule end\\n',
      replace(v_rule, E'\\', E'\\\\')
    );
    if v_new = v_def then
      raise exception 'driver rule (20261027190000) not found in update_sales_order';
    end if;
    execute v_new;
  end if;
end
$mig$;
