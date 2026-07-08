-- ════════════════════════════════════════════════════════════════════════════
-- MONEY INTEGRITY AUDIT — non-payroll  (read-only; Supabase SQL editor)
--
-- Third diagnostic, alongside:
--   • financial_reconciliation.sql   — payments/expenses domains, statuses,
--                                       refunds, duplicate payments, rebuild-from-raw.
--   • payroll_attribution_audit.sql  — worker pay → domain/project.
-- THIS one covers the rest of the money surface: ACCOUNTS, LINKS, ORDERS, VAT,
-- INSTALLMENTS, DUPLICATES. Same idea every time: surface money that can't be
-- placed, doesn't reconcile, or looks double-entered.
--
-- The general method (applies to ANY money area):
--   1. ATTRIBUTION — is it assigned (account, domain, order/project/property)?
--   2. RECONCILE   — does the total equal the sum of the rows behind it?
--   3. ORPHANS     — does every link point at a row that still exists?
--   4. DUPLICATES  — same amount+date+link entered twice?
--   5. OVER/UNDER  — collected > billed, net+vat ≠ gross, installments ≠ parent.
--
-- NOTE: business_domain is an ENUM — cast ::text before comparing to a label.
-- Run one query at a time (highlight from select/with to the ;). Nothing writes.
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 0 — ACCOUNT COVERAGE (headline). Every payment/expense should name the bank/
-- cash account it moved through (once you use accounts). A big "missing" here
-- means account balances can't be trusted until the rows are back-filled.
select 'payments' as source,
       count(*) as rows,
       count(account_id) as with_account,
       count(*) - count(account_id) as missing_account,
       round(sum(case when account_id is null then coalesce(amount_total,0) else 0 end), 0) as amount_unassigned
from public.payments
union all
select 'expenses',
       count(*),
       count(account_id),
       count(*) - count(account_id),
       round(sum(case when account_id is null then coalesce(amount,0) else 0 end), 0)
from public.expenses;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1 — MONEY WITH NO ACCOUNT (the rows behind #0). Back-fill these so account
-- balances mean something. Payments first, then expenses.
select id, payment_date, amount_total, payment_method,
       coalesce(business_domain::text, '⚠️ NULL') as domain, order_id, project_id, property_id
from public.payments
where account_id is null
order by payment_date desc;

select id, expense_date, amount, category, payment_method,
       coalesce(business_domain::text, '⚠️ NULL') as domain, project_id, order_id
from public.expenses
where account_id is null
order by expense_date desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2 — ORPHAN LINKS: a payment/expense whose order/project/property was deleted.
-- The money still counts but points at a ghost — investigate or re-link each.
select 'payment' as kind, p.id, 'order' as link, p.order_id as missing_id
from public.payments p left join public.orders o on o.id = p.order_id
where p.order_id is not null and o.id is null
union all
select 'payment', p.id, 'project', p.project_id
from public.payments p left join public.projects pr on pr.id = p.project_id
where p.project_id is not null and pr.id is null
union all
select 'expense', e.id, 'order', e.order_id
from public.expenses e left join public.orders o on o.id = e.order_id
where e.order_id is not null and o.id is null
union all
select 'expense', e.id, 'project', e.project_id
from public.expenses e left join public.projects pr on pr.id = e.project_id
where e.project_id is not null and pr.id is null
order by kind, link;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3 — UNATTRIBUTED INCOME: a payment with no link AND no domain — it can't land
-- in any bucket on /financial. Should be empty.
select id, payment_date, amount_total, payment_method, reference_number, notes
from public.payments
where order_id is null and project_id is null and property_id is null
  and business_domain is null
order by payment_date desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4 — ORDERS THAT LOOK WRONG:
--   (a) total_amount = 0 on a live (non-cancelled) order — the classic
--       "order shows ₪0" bug (a recalc that zeroed the total).
--   (b) OVERPAID — collected more than the order total (double-charged / refund
--       owed). remaining_balance goes negative.
select 'zero-total (live order)' as issue, id::text as order_id,
       order_date::text, status, total_amount
from public.orders
where coalesce(total_amount, 0) = 0
  and lower(coalesce(status, '')) not in ('cancelled', 'בוטלה')
union all
select 'overpaid', order_id::text, order_date::text, status, (collected_amount - total_amount)
from public.order_overview_view
where collected_amount > total_amount + 1
order by 1, 4;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5 — VAT CONSISTENCY: on any payment carrying VAT, net + vat should equal the
-- gross amount_total (±1 for rounding). A mismatch means the split is wrong and
-- the tax bucket / net revenue will be off.
select id, payment_date, amount_total, net_amount, vat_amount,
       (coalesce(net_amount,0) + coalesce(vat_amount,0)) as net_plus_vat,
       (coalesce(net_amount,0) + coalesce(vat_amount,0) - coalesce(amount_total,0)) as diff
from public.payments
where coalesce(vat_amount, 0) <> 0
  and abs(coalesce(net_amount,0) + coalesce(vat_amount,0) - coalesce(amount_total,0)) > 1
order by abs(coalesce(net_amount,0) + coalesce(vat_amount,0) - coalesce(amount_total,0)) desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6 — INSTALLMENT INTEGRITY: an expense split into installments should have as
-- many rows as it declares (installment_count). A group whose actual row count
-- differs was partially created/deleted — its schedule is broken.
select installment_group_id,
       max(installment_count) as declared_count,
       count(*) as actual_rows,
       round(sum(coalesce(amount,0)), 0) as group_total
from public.expenses
where installment_group_id is not null
group by installment_group_id
having count(*) <> max(installment_count)
order by installment_group_id;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7 — DUPLICATE EXPENSES: same date + amount + description entered more than once
-- (e.g. a credit-card row imported twice). Each inflates outflow. Investigate cnt>1.
-- (Duplicate PAYMENTS have the same check in financial_reconciliation.sql Part 1.E.)
select expense_date, amount, description, count(*) as cnt, array_agg(id) as expense_ids
from public.expenses
group by expense_date, amount, description
having count(*) > 1
order by cnt desc, expense_date desc;
