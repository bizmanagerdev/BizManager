-- Fix: a worker payment with NO allocation (an advance / "paid for future work")
-- did not move the worker's balance at all — יתרה stayed 0 instead of going to -500
-- after handing the worker ₪500 up front.
--
-- Root cause: every balance view only counts payment money that was ALLOCATED to a
-- specific session/payslip (worker_payment_allocations). An unallocated payment lives
-- in worker_payments with no allocation row, so it was invisible to the balance — the
-- credit never showed and could not be "documented later" against a job.
--
-- Correct rule: a worker's open balance must also subtract money already handed to them
-- that is not yet tied to any item (the unallocated remainder of their payments).
--
--   owed = (sum of open item owed, which already zeroes not-yet-due payslips)
--          - (total paid to the worker - total already allocated to items)
--
-- So:
--   * ₪500 advance, no items            → owed = 0 - (500 - 0)   = -500  ('overpaid' / credit)
--   * later allocate that ₪500 to a job → owed = 0 - (500 - 500) =    0  ('paid', settled)
--
-- partial / unpaid / not_due / paid status for the positive side is unchanged and stays
-- based on the currently-open items only (see fix_worker_balance_partial_status.sql).

create or replace view public.worker_balance_summary_view as
with item_agg as (
  select
    d.user_id,
    count(*) as item_count,
    count(*) filter (where d.owed_amount > 0.009) as open_item_count,
    sum(d.earned_amount) as earned_amount,
    sum(d.owed_amount) as items_owed_amount,
    count(*) filter (where d.owed_amount > 0.009 and d.payment_status = 'partial') as partial_open_count,
    count(*) filter (where d.owed_amount > 0.009 and d.payment_status = 'unpaid') as unpaid_open_count,
    count(*) filter (where d.payment_status = 'not_due') as not_due_count,
    max(d.last_payment_date) as last_alloc_date
  from public.worker_debt_items_view d
  group by d.user_id
),
payment_agg as (
  -- All money actually handed to the worker, regardless of allocation.
  select
    wp.user_id,
    sum(coalesce(wp.amount, 0))::numeric(12,2) as total_paid,
    max(wp.payment_date) as last_payment_date
  from public.worker_payments wp
  group by wp.user_id
),
alloc_agg as (
  -- Of that money, how much is already tied to a specific session/payslip.
  select
    wp.user_id,
    sum(coalesce(a.amount, 0))::numeric(12,2) as total_allocated
  from public.worker_payment_allocations a
  join public.worker_payments wp on wp.id = a.worker_payment_id
  group by wp.user_id
),
ids as (
  select user_id from item_agg
  union
  select user_id from payment_agg
)
select
  ids.user_id,
  coalesce(i.item_count, 0)::bigint as item_count,
  coalesce(i.open_item_count, 0)::bigint as open_item_count,
  coalesce(i.earned_amount, 0)::numeric(12,2) as earned_amount,
  coalesce(p.total_paid, 0)::numeric(12,2) as paid_amount,
  (
    coalesce(i.items_owed_amount, 0)
    - greatest(coalesce(p.total_paid, 0) - coalesce(al.total_allocated, 0), 0)
  )::numeric(12,2) as owed_amount,
  case
    -- Net credit (advance for future work, or genuine overpayment) → overpaid.
    when coalesce(i.items_owed_amount, 0)
       - greatest(coalesce(p.total_paid, 0) - coalesce(al.total_allocated, 0), 0) < -0.009
      then 'overpaid'
    -- Positive side: decide only from currently-open items.
    when coalesce(i.partial_open_count, 0) > 0 then 'partial'
    when coalesce(i.unpaid_open_count, 0) > 0 then 'unpaid'
    when coalesce(i.not_due_count, 0) > 0 then 'not_due'
    else 'paid'
  end as payment_status,
  greatest(i.last_alloc_date, p.last_payment_date) as last_payment_date
from ids
left join item_agg i on i.user_id = ids.user_id
left join payment_agg p on p.user_id = ids.user_id
left join alloc_agg al on al.user_id = ids.user_id;

-- Recreating the view preserves its options, but re-assert security_invoker to be safe
-- (this view is read under the caller's RLS — see fix_rls_views_security_invoker.sql).
alter view public.worker_balance_summary_view set (security_invoker = on);

grant select on public.worker_balance_summary_view to authenticated;
