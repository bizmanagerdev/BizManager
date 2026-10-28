-- Rollback for 20261027220000_driver_rule_keeps_custom_lines.sql.
--
-- Puts back the driver rule as 20261027190000 wrote it (every line without a
-- catalog product refused). To take the whole rule out, run
-- 20261027190000_drivers_confirm_deliveries_only.rollback.sql instead.

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
    return;
  end if;

  v_def := replace(pg_get_functiondef(v_fn), E'\r\n', E'\n');
  if position('(by its description, 20261027220000)' in v_def) > 0 then
    v_new := regexp_replace(
      v_def,
      E'  -- driver rule \\(20261027190000\\) begin\\n.*?  -- driver rule end\\n',
      replace(v_rule, E'\\', E'\\\\')
    );
    execute v_new;
  end if;
end
$mig$;
