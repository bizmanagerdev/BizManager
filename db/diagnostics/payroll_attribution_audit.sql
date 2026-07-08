-- ════════════════════════════════════════════════════════════════════════════
-- PAYROLL & ATTRIBUTION AUDIT  (read-only; Supabase SQL editor)
--
-- Companion to financial_reconciliation.sql. That file audits payments/expenses;
-- THIS one audits WORKER PAYROLL — the class of bug behind the recent שוטף /
-- project-salary issues. Every check answers: "is this money landing in the
-- right domain / project, or silently defaulting to שוטף (general_business)?"
--
-- Attribution rules encoded here (from lib/financial/entries.ts + worker_debt_items_view):
--   • Hourly (session) pay      → the SESSION's business_domain + project_id.
--   • Monthly (payslip) pay      → the worker's active salary_agreement domain +
--                                   project_id; if none, defaults to general_business (שוטף).
--   • Anything with no session AND no project-linked agreement lands in שוטף.
--
-- Run the whole file or one query at a time. Nothing here writes.
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 0 — ONE-LINE HEALTH CHECK: monthly salary by "decided vs guessed".
-- The fastest read. "decided → …" = an active salary agreement chose the bucket
-- (project / שוטף / other) on purpose. "⚠️ guessed → שוטף" = NO agreement covered
-- that month, so the salary defaulted to שוטף — the only rows that need a human.
-- Aim for a ₪0 "guessed" line.
with payslip_months as (
  select p.user_id,
         coalesce(pp.end_date, current_date) as period_end,
         coalesce(p.gross_salary, 0) as gross_salary
  from public.payslips p
  left join public.payroll_periods pp on pp.id = p.payroll_period_id
  where coalesce(p.gross_salary, 0) > 0
)
select
  case
    when sa.id is null then '⚠️ guessed → שוטף (no agreement)'
    when sa.project_id is not null then 'decided → project'
    when coalesce(sa.business_domain,'general_business') = 'general_business' then 'decided → שוטף'
    else 'decided → other domain'
  end as attribution,
  count(*) as worker_months,
  round(sum(pm.gross_salary), 0) as salary
from payslip_months pm
left join lateral (
  select sa.id, sa.business_domain, sa.project_id
  from public.salary_agreements sa
  where sa.user_id = pm.user_id
    and sa.valid_from <= pm.period_end
    and (sa.valid_to is null or sa.valid_to >= pm.period_end)
  order by sa.valid_from desc, sa.id desc
  limit 1
) sa on true
group by attribution
order by salary desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- A — WHERE DOES PAYROLL LAND?  Cost by source × domain × (project-attributed?)
-- The big picture. A large "payslip / general_business / no project" row is the
-- שוטף salary pile — expected if that's genuine office overhead, a red flag if
-- those salaries should belong to a project.
select
  d.source_type,                                             -- session (hourly) | payslip (monthly)
  coalesce(d.business_domain, '⚠️ NULL') as business_domain,
  case when d.project_id is not null then 'project ✓' else 'no project' end as project_link,
  count(*) as rows,
  round(sum(coalesce(d.earned_amount, 0)), 0) as earned,     -- incurred cost
  round(sum(coalesce(d.paid_amount, 0)), 0)   as paid,       -- cash out
  round(sum(coalesce(d.owed_amount, 0)), 0)   as owed        -- still owed
from public.worker_debt_items_view d
group by d.source_type, d.business_domain, project_link
order by earned desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- B — MONTHLY SALARIES SITTING IN שוטף  (payslip pay with no project link)
-- Each row is a worker-month whose whole salary went to general_business. Decide
-- per worker: is this real office overhead, or should their salary_agreement
-- point at a project (business_domain='logistics_projects' + project_id)?
select
  d.period_month,
  u.full_name as worker,
  round(coalesce(d.earned_amount, 0), 0) as salary,
  d.payment_status
from public.worker_debt_items_view d
join public.users u on u.id = d.user_id
where d.source_type = 'payslip'
  and coalesce(d.business_domain, 'general_business') = 'general_business'
order by d.period_month desc, salary desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- C — SALARY-AGREEMENT COVERAGE  (why a payslip fell into שוטף)
-- A payslip only inherits a project/domain from an agreement whose validity
-- window covers the payslip's period. This lists every monthly worker's agreement
-- window vs their payslip months — a payslip month OUTSIDE every window (or with
-- no project on the covering agreement) is money that defaulted to שוטף.
with payslip_months as (
  select p.user_id,
         coalesce(pp.period_month, to_char(current_date, 'YYYY-MM')) as period_month,
         coalesce(pp.end_date, current_date) as period_end,
         coalesce(p.gross_salary, 0) as gross_salary
  from public.payslips p
  left join public.payroll_periods pp on pp.id = p.payroll_period_id
  where coalesce(p.gross_salary, 0) > 0
)
select
  u.full_name as worker,
  pm.period_month,
  round(pm.gross_salary, 0) as salary,
  sa.business_domain as agreement_domain,
  sa.project_id as agreement_project,
  case
    when sa.id is null then '⚠️ no agreement covers this month → שוטף'
    when coalesce(sa.business_domain,'general_business') = 'general_business' then 'שוטף (by agreement)'
    when sa.project_id is null then 'domain set, no project'
    else 'project-attributed ✓'
  end as verdict
from payslip_months pm
join public.users u on u.id = pm.user_id
left join lateral (
  select sa.id, sa.business_domain, sa.project_id
  from public.salary_agreements sa
  where sa.user_id = pm.user_id
    and sa.valid_from <= pm.period_end
    and (sa.valid_to is null or sa.valid_to >= pm.period_end)
  order by sa.valid_from desc, sa.id desc
  limit 1
) sa on true
order by pm.period_month desc, salary desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- D — UNTAGGED HOURLY WORK  (sessions with no domain or no project)
-- Hourly labor with a NULL/general domain or no project — its cost can't reach a
-- specific project. Sum is the labor_cost that stays generic.
-- NOTE: attendance_sessions.business_domain is an ENUM — cast to ::text before
-- coalescing to a label string, else Postgres rejects 'NULL' as an enum value.
select
  coalesce(business_domain::text, '⚠️ NULL') as business_domain,
  case when project_id is not null then 'project ✓' else 'no project' end as project_link,
  count(*) as sessions,
  round(sum(coalesce(labor_cost, 0)), 0) as labor_cost
from public.attendance_sessions
where business_domain is null
   or business_domain::text = 'general_business'
   or project_id is null
group by business_domain::text, project_link
order by labor_cost desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- E — ORPHAN / MALFORMED ALLOCATIONS  (money that can't be attributed at all)
-- An allocation should point at exactly one of a live session or a live payslip.
-- Rows here are payroll the engine can't place — investigate each.
select
  a.id as allocation_id,
  a.worker_payment_id,
  a.source_type,
  a.attendance_session_id,
  a.payslip_id,
  a.amount,
  case
    when wp.id is null then '⚠️ no matching worker_payment'
    when a.attendance_session_id is null and a.payslip_id is null then '⚠️ no session AND no payslip → שוטף'
    when a.attendance_session_id is not null and s.id is null then '⚠️ session id points nowhere'
    when a.payslip_id is not null and ps.id is null then '⚠️ payslip id points nowhere'
    else 'ok'
  end as problem
from public.worker_payment_allocations a
left join public.worker_payments wp on wp.id = a.worker_payment_id
left join public.attendance_sessions s on s.id = a.attendance_session_id
left join public.payslips ps on ps.id = a.payslip_id
where wp.id is null
   or (a.attendance_session_id is null and a.payslip_id is null)
   or (a.attendance_session_id is not null and s.id is null)
   or (a.payslip_id is not null and ps.id is null)
order by a.amount desc;


-- ─────────────────────────────────────────────────────────────────────────────
-- F — UNALLOCATED WORKER PAYMENTS  (advances / credit not tied to work)
-- A worker payment whose allocations don't add up to the payment is an advance /
-- unallocated credit — it reduces the worker's balance but isn't attributed to
-- any session/payslip domain. Big gaps are worth a look.
select
  wp.id as worker_payment_id,
  u.full_name as worker,
  wp.payment_date,
  round(wp.amount, 0) as payment_amount,
  round(coalesce(sum(a.amount), 0), 0) as allocated,
  round(wp.amount - coalesce(sum(a.amount), 0), 0) as unallocated
from public.worker_payments wp
join public.users u on u.id = wp.user_id
left join public.worker_payment_allocations a on a.worker_payment_id = wp.id
group by wp.id, u.full_name, wp.payment_date, wp.amount
having abs(wp.amount - coalesce(sum(a.amount), 0)) > 0.01
order by unallocated desc;
