-- Run this in Supabase SQL Editor.
-- Creates a transaction-level cash flow read model with one row per movement.
-- This is intended to complement the existing monthly aggregate cash_flow_view.

create or replace view public.cash_flow_entries_view as
with payment_entries as (
  select
    concat('payment:', p.id::text) as id,
    p.payment_date::date as entry_date,
    'income'::text as type,
    coalesce(p.amount_total, 0)::numeric as amount,
    coalesce(p.amount_total, 0)::numeric as signed_amount,
    case
      when p.target_type = 'project' and p.target_id is not null then p.target_id
      when p.target_type = 'order' then 'b1eac4a0-9ba5-4444-8778-ea605d09e7d7'::uuid
      else null
    end as project_id,
    coalesce(
      linked_project.name,
      orders_project.name,
      'פרויקט'
    )::text as project_name,
    coalesce(
      nullif(trim(p.notes), ''),
      nullif(trim(p.reference_number), ''),
      nullif(trim(p.payment_method), ''),
      case
        when p.target_type = 'order' and p.target_id is not null
          then 'תשלום עבור הזמנה ' || left(p.target_id::text, 8)
        when p.target_type = 'project' and p.target_id is not null
          then 'תשלום עבור פרויקט ' || left(p.target_id::text, 8)
        else 'תשלום'
      end
    )::text as description,
    coalesce(
      nullif(trim(p.reference_number), ''),
      case
        when p.target_type = 'order' and p.target_id is not null then p.target_id::text
        else p.id::text
      end
    )::text as reference,
    'payment'::text as source_type,
    p.id as source_id,
    coalesce(order_target.customer_id, linked_project.customer_id) as customer_id
  from public.payments p
  left join public.orders order_target
    on p.target_type = 'order'
   and order_target.id = p.target_id
  left join public.projects linked_project
    on p.target_type = 'project'
   and linked_project.id = p.target_id
  left join public.projects orders_project
    on p.target_type = 'order'
   and orders_project.id = 'b1eac4a0-9ba5-4444-8778-ea605d09e7d7'::uuid
  where p.payment_date is not null
),
expense_entries as (
  select
    concat('expense:', e.id::text) as id,
    e.expense_date::date as entry_date,
    'expense'::text as type,
    coalesce(e.amount, 0)::numeric as amount,
    -abs(coalesce(e.amount, 0)::numeric) as signed_amount,
    pe.project_id,
    coalesce(pr.name, 'פרויקט')::text as project_name,
    coalesce(
      nullif(trim(e.description), ''),
      nullif(trim(e.notes), ''),
      nullif(trim(e.category), ''),
      'הוצאה'
    )::text as description,
    coalesce(
      nullif(trim(e.category), ''),
      e.id::text
    )::text as reference,
    'expense'::text as source_type,
    e.id as source_id,
    null::uuid as customer_id
  from public.expenses e
  left join public.project_expenses pe
    on pe.expense_id = e.id
  left join public.projects pr
    on pr.id = pe.project_id
  where e.expense_date is not null
)
select
  id,
  entry_date,
  type,
  amount,
  signed_amount,
  project_id,
  project_name,
  description,
  reference,
  source_type,
  source_id,
  customer_id
from payment_entries

union all

select
  id,
  entry_date,
  type,
  amount,
  signed_amount,
  project_id,
  project_name,
  description,
  reference,
  source_type,
  source_id,
  customer_id
from expense_entries;

grant select on public.cash_flow_entries_view to authenticated;
