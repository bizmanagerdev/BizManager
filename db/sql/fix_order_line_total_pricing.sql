-- Run this in the Supabase SQL Editor.
--
-- ROOT CAUSE of "orders show ₪0 stored total" + the spurious "עודכן · סכום:
-- ₪1,534 → ₪0" audit row right after every order create:
--
--   1) BEFORE trigger calculate_line_total() priced each line as
--        COALESCE(quantity_delivered, quantity_ordered) * unit_price - discount
--      COALESCE returns the first NON-NULL value, and create_sales_order writes
--      quantity_delivered = 0 (not NULL) for any non-delivered order — so the
--      line was priced at 0 * unit_price = 0.
--   2) AFTER trigger recalculate_order_totals() then summed those zero line
--      totals and wrote subtotal = 0 / total_amount = 0 back onto the order,
--      overwriting the correct total the RPC had just inserted.
--
-- An order's price is based on what was ORDERED (delivery is fulfillment, not
-- pricing) — matching what the API/RPC and the UI already compute. This also
-- fixes Morning invoice line amounts and the order-detail line totals, which
-- read order_items.line_total and were getting 0.
--
-- fix_zero_total_orders.sql was a one-time backfill + a view fallback that only
-- masked this; the trigger kept re-zeroing every new order. This fixes the
-- source so the masking is no longer needed.

-- 1) Price the line by quantity_ordered.
create or replace function public.calculate_line_total()
returns trigger
language plpgsql
as $$
begin
  new.line_total :=
    (coalesce(new.quantity_ordered, 0) * coalesce(new.unit_price, 0))
    - coalesce(new.discount_amount, 0);
  return new;
end;
$$;

-- 2) Recalc order totals from line_total. Now also:
--    - handles DELETE (OLD.order_id) so removing an item updates the order;
--    - SKIPS the write when nothing actually changed, so an order whose totals
--      the RPC already set correctly does NOT get a redundant UPDATE (which the
--      audit trigger would have logged as a stray "עודכן").
create or replace function public.recalculate_order_totals()
returns trigger
language plpgsql
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_subtotal numeric;
begin
  -- The create/update_sales_order RPCs compute and set the order totals
  -- authoritatively, then rewrite all order_items. Without this guard the
  -- per-row trigger would fire on every deleted/re-inserted line and log a
  -- stray "עודכן · סכום" audit row at each intermediate subtotal. The RPCs set
  -- this transaction-local flag so the trigger stays silent for their writes;
  -- it still runs for any item change made outside the RPCs.
  if coalesce(current_setting('app.skip_order_total_recalc', true), '') = 'on' then
    return null;
  end if;

  if v_order_id is null then
    return null;
  end if;

  select coalesce(sum(line_total), 0)
  into v_subtotal
  from public.order_items
  where order_id = v_order_id;

  update public.orders o
  set subtotal = v_subtotal,
      total_amount = v_subtotal - coalesce(o.discount_amount, 0),
      updated_at = now()
  where o.id = v_order_id
    and (o.subtotal is distinct from v_subtotal
         or o.total_amount is distinct from v_subtotal - coalesce(o.discount_amount, 0));

  return null;
end;
$$;

-- 3) One-time backfill of existing rows. Triggers are disabled for this block so
--    it neither recurses nor floods the activity feed with audit rows.
begin;
  alter table public.order_items disable trigger user;
  alter table public.orders      disable trigger user;

  update public.order_items
  set line_total =
        (coalesce(quantity_ordered, 0) * coalesce(unit_price, 0))
        - coalesce(discount_amount, 0)
  where line_total is distinct from
        ((coalesce(quantity_ordered, 0) * coalesce(unit_price, 0))
         - coalesce(discount_amount, 0));

  with t as (
    select order_id, coalesce(sum(line_total), 0) as s
    from public.order_items
    group by order_id
  )
  update public.orders o
  set subtotal     = t.s,
      total_amount = t.s - coalesce(o.discount_amount, 0)
  from t
  where t.order_id = o.id
    and (o.subtotal is distinct from t.s
         or o.total_amount is distinct from t.s - coalesce(o.discount_amount, 0));

  alter table public.order_items enable trigger user;
  alter table public.orders      enable trigger user;
commit;
