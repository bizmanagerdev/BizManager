-- ════════════════════════════════════════════════════════════════════════════
-- FINANCIAL RECONCILIATION & INTEGRITY  (read-only; Supabase SQL editor)
--
-- Two jobs:
--   PART 1 — INTEGRITY: surface the "one wrong line messes it all up" rows
--            (missing/typo'd domain or status, refunds, duplicate-looking
--            payments). These are the things that silently miscategorise money.
--   PART 2 — RECONCILE: rebuild income & expenses straight from the raw tables,
--            grouped by domain × bucket × month, so every figure on /financial
--            is just the sum of rows you can see and drill into.
--
-- Engine rules encoded here (from lib/financial + lib/orders/paymentStatus):
--   • Income = GROSS payments.amount_total, SIGNED (a negative row = refund,
--     so it subtracts automatically).
--   • "Collected" (actual cash in / בפועל) = payment_status NOT IN
--     ('pending','rejected'). 'pending' = future-dated/uncleared (expected, not
--     in yet); 'rejected' = bounced (counts as nothing).
--     NOTE: the /financial P&L additionally treats an un-cleared CHECK as pending
--     even if its status text differs — so if you use checks, read the check rows
--     in Part 1.D with that in mind.
--   • Expense "actual cash out" = payment_status = 'paid' (not_paid/partial =
--     pending). A paid expense lands on paid_date when present, else expense_date.
--
-- Run the whole file, or one query at a time (clear the editor between).
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1.A — every business_domain on PAYMENTS (spot NULL / unexpected values)
-- A NULL or typo'd domain is money that lands in the wrong bucket on /financial.
select coalesce(business_domain::text, '⚠️ NULL') as business_domain,
       count(*) as rows,
       sum(amount_total) as gross_total
from public.payments
group by business_domain
order by gross_total desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1.B — every business_domain on EXPENSES (same check, expense side)
select coalesce(business_domain::text, '⚠️ NULL') as business_domain,
       count(*) as rows,
       sum(amount) as total
from public.expenses
group by business_domain
order by total desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1.C — every payment_status value in use (spot typos / unexpected states)
-- Anything outside paid/partial/unpaid/pending/cleared/rejected is suspect.
select coalesce(payment_status, '⚠️ NULL') as payment_status,
       count(*) as rows,
       sum(amount_total) as gross_total
from public.payments
group by payment_status
order by rows desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1.D — REFUNDS (negative payments) + all CHECK payments, fully listed
-- Refunds are the only negative rows; checks are the only ones with the
-- cleared/pending nuance. Eyeball them — there should be few.
select id, payment_date, due_date, amount_total, payment_method, payment_status,
       business_domain, order_id, project_id, property_id, notes
from public.payments
where amount_total < 0
   or lower(coalesce(payment_method,'')) = 'check'
   or coalesce(payment_method,'') like '%צ%'
order by payment_date desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1.E — DUPLICATE-looking payments (same link + amount + date, more than 1)
-- A double-entered payment inflates income. Investigate any group with cnt > 1.
select coalesce(order_id::text, project_id::text, property_id::text, 'unlinked') as link,
       payment_date, amount_total, count(*) as cnt,
       array_agg(id) as payment_ids
from public.payments
group by link, payment_date, amount_total
having count(*) > 1
order by cnt desc, payment_date desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2.A — INCOME by month × domain × bucket  (rebuilt from raw payments)
-- 'collected' = actual cash in (what /financial calls בפועל). 'pending' =
-- expected money not in yet. 'rejected' is excluded from cash entirely.
-- Refunds subtract inside 'collected' because we SUM the signed amount_total.
select to_char(date_trunc('month', payment_date), 'YYYY-MM') as month,
       coalesce(business_domain::text, '⚠️ NULL') as business_domain,
       case
         when lower(coalesce(payment_status,'')) = 'pending' then 'pending (expected)'
         when lower(coalesce(payment_status,'')) = 'rejected' then 'rejected (excluded)'
         else 'collected (actual)'
       end as bucket,
       count(*) as rows,
       sum(amount_total) as gross
from public.payments
group by month, business_domain, bucket
order by month desc, business_domain, bucket;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2.B — EXPENSES by month × domain × status  (rebuilt from raw expenses)
-- 'paid' = actual cash out (בפועל); not_paid/partial = pending (committed, not
-- yet left the account). A paid expense is dated on paid_date when present.
select to_char(date_trunc('month', coalesce(paid_date, expense_date)), 'YYYY-MM') as month,
       coalesce(business_domain::text, '⚠️ NULL') as business_domain,
       coalesce(payment_status, '⚠️ NULL') as payment_status,
       count(*) as rows,
       sum(amount) as total
from public.expenses
group by month, business_domain, payment_status
order by month desc, business_domain, payment_status;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2.C — DRILL-DOWN: every payment behind one month+domain bucket.
-- Edit the month and domain, then read the actual rows that make up the total.
-- This is the proof: the bucket total above == the sum of these rows.
select id, payment_date, due_date, amount_total, payment_method, payment_status,
       order_id, project_id, property_id, reference_number, notes
from public.payments
where to_char(date_trunc('month', payment_date), 'YYYY-MM') = '2026-06'   -- ← edit
  and business_domain::text = 'sales'                                      -- ← edit
order by payment_date, id;
