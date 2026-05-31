-- Run this in Supabase SQL Editor.
-- Expands customer_overview_view so the customers page can rely on a single
-- SQL-backed customer summary row for most fields.
--
-- COLLECTION SPLIT (2026-05): total_paid / open_balance reflect ONLY collected
-- money (cleared or legacy rows). Future-dated / uncleared payments
-- (payment_status='pending') are surfaced as expected_amount / overdue_amount so
-- the customer card can show "צפוי לגבייה" separately from money actually in.

-- CREATE OR REPLACE with the NEW columns (expected_amount, overdue_amount)
-- appended at the END — preserving the original column order so dependent views
-- (e.g. customer_open_balance_view) keep working. Changing a column's expression
-- is allowed; only reordering/renaming columns is not.
create or replace view public.customer_overview_view as
with order_totals as (
  select
    o.customer_id,
    count(*)::bigint as orders_count,
    coalesce(sum(coalesce(o.total_amount, 0)), 0)::numeric as total_sales,
    max(o.order_date)::timestamptz as last_order_at
  from public.orders o
  where o.customer_id is not null
  group by o.customer_id
),
project_totals as (
  select
    p.customer_id,
    count(*)::bigint as projects_count,
    coalesce(sum(coalesce(pfv.customer_total_price, 0)), 0)::numeric as project_total_sales
  from public.projects p
  left join public.project_financials_view pfv
    on pfv.id = p.id
  where p.customer_id is not null
  group by p.customer_id
),
order_payment_totals as (
  select
    o.customer_id,
    coalesce(
      sum(
        case
          when coalesce(pay.payment_status, 'cleared') not in ('pending', 'rejected')
          then coalesce(pay.amount_total, 0)
          else 0
        end
      ),
      0
    )::numeric as collected,
    coalesce(
      sum(case when pay.payment_status = 'pending' then coalesce(pay.amount_total, 0) else 0 end),
      0
    )::numeric as pending,
    coalesce(
      sum(
        case
          when pay.payment_status = 'pending'
            and pay.due_date is not null
            and pay.due_date <= current_date
          then coalesce(pay.amount_total, 0)
          else 0
        end
      ),
      0
    )::numeric as overdue,
    max(
      case
        when coalesce(pay.payment_status, 'cleared') not in ('pending', 'rejected')
        then pay.payment_date
      end
    )::timestamptz as last_payment_at
  from public.payments pay
  inner join public.orders o
    on pay.order_id = o.id
  where o.customer_id is not null
  group by o.customer_id
),
project_payment_totals as (
  select
    p.customer_id,
    coalesce(
      sum(
        case
          when coalesce(pay.payment_status, 'cleared') not in ('pending', 'rejected')
          then coalesce(pay.amount_total, 0)
          else 0
        end
      ),
      0
    )::numeric as collected,
    coalesce(
      sum(case when pay.payment_status = 'pending' then coalesce(pay.amount_total, 0) else 0 end),
      0
    )::numeric as pending,
    coalesce(
      sum(
        case
          when pay.payment_status = 'pending'
            and pay.due_date is not null
            and pay.due_date <= current_date
          then coalesce(pay.amount_total, 0)
          else 0
        end
      ),
      0
    )::numeric as overdue,
    max(
      case
        when coalesce(pay.payment_status, 'cleared') not in ('pending', 'rejected')
        then pay.payment_date
      end
    )::timestamptz as last_payment_at
  from public.payments pay
  inner join public.projects p
    on pay.project_id = p.id
  where p.customer_id is not null
  group by p.customer_id
),
payment_totals as (
  select
    customer_id,
    coalesce(sum(collected), 0)::numeric as total_paid,
    coalesce(sum(pending), 0)::numeric as expected_amount,
    coalesce(sum(overdue), 0)::numeric as overdue_amount,
    max(last_payment_at)::timestamptz as last_payment_at
  from (
    select * from order_payment_totals
    union all
    select * from project_payment_totals
  ) payments_union
  group by customer_id
)
select
  c.id as customer_id,
  coalesce(
    nullif(trim(c.name), ''),
    nullif(trim(c.name_for_invoice), ''),
    'לקוח'
  )::text as customer_name,
  nullif(trim(c.email), '')::text as email,
  nullif(trim(c.phone), '')::text as phone,
  coalesce(ot.orders_count, 0)::bigint as orders_count,
  coalesce(pt.projects_count, 0)::bigint as projects_count,
  (
    coalesce(ot.total_sales, 0) +
    coalesce(pt.project_total_sales, 0)
  )::numeric as total_sales,
  coalesce(payt.total_paid, 0)::numeric as total_paid,
  greatest(
    (
      coalesce(ot.total_sales, 0) +
      coalesce(pt.project_total_sales, 0)
    ) - coalesce(payt.total_paid, 0),
    0
  )::numeric as open_balance,
  ot.last_order_at,
  payt.last_payment_at,
  nullif(trim(c.address), '')::text as address,
  coalesce(c.active, true) as active,
  nullif(trim(c.notes), '')::text as notes,
  nullif(trim(c.name_for_invoice), '')::text as name_for_invoice,
  nullif(trim(c.registration_number), '')::text as registration_number,
  -- New collection columns appended at the END (preserves original order)
  coalesce(payt.expected_amount, 0)::numeric as expected_amount,
  coalesce(payt.overdue_amount, 0)::numeric as overdue_amount
from public.customers c
left join order_totals ot
  on ot.customer_id = c.id
left join project_totals pt
  on pt.customer_id = c.id
left join payment_totals payt
  on payt.customer_id = c.id;

grant select on public.customer_overview_view to authenticated;
