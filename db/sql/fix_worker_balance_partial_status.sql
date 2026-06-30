-- Fix: worker balance showed "שולם חלקית" (partial) on a brand-new, fully-unpaid
-- month whenever the worker had ANY prior paid months.
--
-- Root cause: the aggregate partial-vs-unpaid decision used `sum(d.paid_amount) > 0`,
-- which is the worker's LIFETIME total paid across every month/session (no filter).
-- So once a worker had ever been paid, a completely-unpaid new payday read as 'partial'
-- instead of 'unpaid'.
--
-- Correct rule: base partial/unpaid only on the CURRENTLY-OWED (open) items. Past months
-- that are fully settled (owed_amount = 0) must not drag the open balance into 'partial'.
--   - 'partial'  → at least one open item is itself partially paid
--   - 'unpaid'   → open items exist but none has had any payment applied
-- not_due / paid / overpaid logic unchanged.

create or replace view public.worker_balance_summary_view as
select
  d.user_id,
  count(*)::bigint as item_count,
  count(*) filter (where d.owed_amount > 0.009)::bigint as open_item_count,
  sum(d.earned_amount)::numeric(12,2) as earned_amount,
  sum(d.paid_amount)::numeric(12,2) as paid_amount,
  sum(d.owed_amount)::numeric(12,2) as owed_amount,
  case
    when sum(d.owed_amount) < -0.009 then 'overpaid'
    -- Among currently-owed items only: any partially-paid open item → partial.
    when count(*) filter (where d.owed_amount > 0.009 and d.payment_status = 'partial') > 0 then 'partial'
    -- Otherwise, if there's any fully-unpaid open item → unpaid (regardless of past paid months).
    when count(*) filter (where d.owed_amount > 0.009 and d.payment_status = 'unpaid') > 0 then 'unpaid'
    when count(*) filter (where d.payment_status = 'not_due') > 0 then 'not_due'
    else 'paid'
  end as payment_status,
  max(d.last_payment_date) as last_payment_date
from public.worker_debt_items_view d
group by d.user_id;

grant select on public.worker_balance_summary_view to authenticated;
