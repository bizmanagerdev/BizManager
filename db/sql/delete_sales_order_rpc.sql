-- Run in Supabase SQL Editor
-- Deletes a sales order and its related records atomically.
--
-- ⚠️ DO NOT DEPLOY THIS AS-IS. It is INCOMPLETE: it only removes
-- inventory_movements, financial_records, order_items and the order. It does
-- NOT remove payments, morning_documents, document_links, documents or storage
-- files, so deleting an order that has any of those will FK-fail or orphan rows.
-- The app currently (and deliberately) deletes orders via the comprehensive JS
-- path in app/api/orders/delete/route.ts. Stock release is handled by
-- release_order_inventory (db/sql/release_order_inventory_rpc.sql). Only deploy
-- this function after extending it to mirror that JS cleanup.

create or replace function public.delete_sales_order(
  p_order_id uuid,
  p_deleted_by uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_financial_order_id boolean;
  v_deleted_count int;
begin
  if p_order_id is null then
    raise exception 'order_id is required';
  end if;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'financial_records'
      and column_name = 'order_id'
  ) into v_has_financial_order_id;

  delete from public.inventory_movements
  where source_type = 'order' and source_id = p_order_id;

  if v_has_financial_order_id then
    delete from public.financial_records where order_id = p_order_id;
  end if;

  delete from public.financial_records
  where target_type = 'order' and target_id = p_order_id;

  delete from public.order_items where order_id = p_order_id;

  delete from public.orders where id = p_order_id;
  get diagnostics v_deleted_count = row_count;

  if v_deleted_count = 0 then
    raise exception 'order not found';
  end if;

  return true;
exception
  when others then
    raise;
end;
$$;

grant execute on function public.delete_sales_order(uuid, uuid) to authenticated;
