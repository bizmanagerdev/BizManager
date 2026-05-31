-- Run this in Supabase SQL Editor.
-- AFTER running update_order_financials_view.sql and
-- update_project_financial_views_for_billed_expenses.sql (this view depends on
-- the collection columns they expose).
--
-- collections_view — one row per OPEN receivable source (order / project) that
-- still has money not yet collected. Powers the גבייה (collections) worklist:
-- who owes money, how much is collected vs still expected, what is overdue, and
-- when the next payment is due. Properties/rent are intentionally excluded for
-- now (rent has its own שכירות flow).
--
-- collection_status mirrors deriveCollectionStatus() in lib/orders/paymentStatus.ts:
--   collected | overdue | awaiting | partial | unpaid

create or replace view public.collections_view as
with sources as (
  -- Orders
  select
    'order'::text as source_type,
    o.id as source_id,
    o.customer_id,
    'sales'::text as business_domain,
    o.order_date::date as reference_date,
    coalesce(ofv.total_amount, 0)::numeric as total_amount,
    coalesce(ofv.collected_amount, 0)::numeric as collected_amount,
    coalesce(ofv.pending_amount, 0)::numeric as pending_amount,
    coalesce(ofv.overdue_amount, 0)::numeric as overdue_amount,
    coalesce(ofv.outstanding_amount, 0)::numeric as outstanding_amount,
    ofv.next_due_date,
    ofv.last_payment_date
  from public.orders o
  join public.order_financials_view ofv
    on ofv.order_id = o.id
  where coalesce(o.status::text, '') <> 'cancelled'

  union all

  -- Projects
  select
    'project'::text as source_type,
    p.id as source_id,
    p.customer_id,
    'logistics_projects'::text as business_domain,
    p.start_date::date as reference_date,
    coalesce(pfv.customer_total_price, 0)::numeric as total_amount,
    coalesce(pfv.collected_amount, 0)::numeric as collected_amount,
    coalesce(pfv.pending_amount, 0)::numeric as pending_amount,
    coalesce(pfv.overdue_amount, 0)::numeric as overdue_amount,
    coalesce(pfv.outstanding_amount, 0)::numeric as outstanding_amount,
    pfv.next_due_date,
    pfv.last_payment_date
  from public.projects p
  join public.project_financials_view pfv
    on pfv.id = p.id
  where coalesce(p.status::text, '') <> 'cancelled'
)
select
  s.source_type,
  s.source_id,
  s.source_type || ':' || s.source_id::text as collection_key,
  s.customer_id,
  coalesce(
    nullif(trim(c.name), ''),
    nullif(trim(c.name_for_invoice), ''),
    'לקוח'
  )::text as customer_name,
  nullif(trim(c.phone), '')::text as customer_phone,
  nullif(trim(c.whatsapp), '')::text as customer_whatsapp,
  s.business_domain,
  s.reference_date,
  s.total_amount,
  s.collected_amount,
  s.pending_amount,
  s.overdue_amount,
  s.outstanding_amount,
  s.next_due_date,
  s.last_payment_date,
  case
    when s.total_amount > 0 and s.collected_amount + 0.009 >= s.total_amount then 'collected'
    when s.overdue_amount > 0.009 then 'overdue'
    when s.pending_amount > 0.009 then 'awaiting'
    when s.collected_amount > 0.009 then 'partial'
    else 'unpaid'
  end::text as collection_status
from sources s
left join public.customers c
  on c.id = s.customer_id
-- Only sources that still have money outstanding (not fully collected)
where s.total_amount > 0.009
  and s.outstanding_amount > 0.009;

grant select on public.collections_view to authenticated;
