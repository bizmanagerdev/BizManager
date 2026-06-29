-- Run this in Supabase SQL Editor.
-- Keeps `inventory` synced from `inventory_movements`.
-- Supported movement_type values:
--   in, out, reserve, release, adjustment

-- Drop the previous 4-arg signature so adding p_check_guard doesn't leave an
-- ambiguous overload (the trigger calls this with positional args).
drop function if exists public.apply_inventory_movement_effect(uuid, text, numeric, integer);

create or replace function public.apply_inventory_movement_effect(
  p_product_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_sign integer default 1,
  -- When false, skip the negative-stock guard. Used for the REVERT leg of an
  -- UPDATE: reverting the old effect can transiently dip on-hand below zero even
  -- though the re-applied new effect lands it back in valid range (e.g. just
  -- relabeling an 'in' movement). Only the final apply leg is guarded.
  p_check_guard boolean default true
)
returns void
language plpgsql
as $$
declare
  v_type text;
  v_qty numeric;
  v_on_hand_delta numeric := 0;
  v_reserved_delta numeric := 0;
begin
  if p_product_id is null or p_quantity is null then
    return;
  end if;

  v_type := lower(coalesce(trim(p_movement_type), ''));
  v_qty := coalesce(p_quantity, 0);

  case v_type
    when 'in' then
      v_on_hand_delta := abs(v_qty) * p_sign;
    when 'out' then
      v_on_hand_delta := -abs(v_qty) * p_sign;
    when 'reserve' then
      v_reserved_delta := abs(v_qty) * p_sign;
    when 'release' then
      v_reserved_delta := -abs(v_qty) * p_sign;
    when 'adjustment' then
      -- Adjustment quantity is signed as-is.
      v_on_hand_delta := v_qty * p_sign;
    else
      raise exception 'Unsupported movement_type: %', p_movement_type;
  end case;

  insert into public.inventory (product_id, quantity_on_hand, quantity_reserved, updated_at)
  values (p_product_id, v_on_hand_delta, v_reserved_delta, now())
  on conflict (product_id) do update
    set quantity_on_hand = coalesce(public.inventory.quantity_on_hand, 0) + v_on_hand_delta,
        quantity_reserved = greatest(
          0,
          coalesce(public.inventory.quantity_reserved, 0) + v_reserved_delta
        ),
        updated_at = now();

  -- Guard rail: never allow negative on-hand by mistake (skipped on the revert
  -- leg of an UPDATE — only the final state is validated).
  if p_check_guard and exists (
    select 1
    from public.inventory i
    where i.product_id = p_product_id
      and coalesce(i.quantity_on_hand, 0) < 0
  ) then
    raise exception 'Inventory cannot be negative for product %', p_product_id;
  end if;
end;
$$;

create or replace function public.sync_inventory_from_movements()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.apply_inventory_movement_effect(
      new.product_id,
      new.movement_type,
      new.quantity,
      1
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Revert old effect (no guard — this leg can transiently go negative), then
    -- apply the new effect (guarded — validates the final on-hand).
    perform public.apply_inventory_movement_effect(
      old.product_id,
      old.movement_type,
      old.quantity,
      -1,
      false
    );
    perform public.apply_inventory_movement_effect(
      new.product_id,
      new.movement_type,
      new.quantity,
      1,
      true
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Revert deleted movement.
    perform public.apply_inventory_movement_effect(
      old.product_id,
      old.movement_type,
      old.quantity,
      -1
    );
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_sync_inventory_from_movements on public.inventory_movements;

create trigger trg_sync_inventory_from_movements
after insert or update or delete
on public.inventory_movements
for each row
execute function public.sync_inventory_from_movements();

