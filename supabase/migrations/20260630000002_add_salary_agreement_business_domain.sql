-- Add a business domain (and optional specific project) to salary agreements so
-- monthly/global workers' salary expenses land in the right financial domain /
-- project instead of always defaulting to "general_business" (שוטף).
--
-- Hourly workers keep deriving their domain/project from each work session; these
-- columns drive the domain (and project) for payslip-based (monthly) debt, which
-- has no linked session. When the domain is "פרויקטים" (logistics_projects) the
-- agreement can also point at one specific project — the whole monthly salary is
-- then booked as an expense on that project.

alter table public.salary_agreements
  add column if not exists business_domain text not null default 'general_business';

alter table public.salary_agreements
  add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table public.salary_agreements
  add column if not exists property_id uuid references public.properties(id) on delete set null;

-- Surface the active agreement's domain on payslip debt items so the financial
-- engine can read it. Session items carry the session's own domain.
--
-- SUPERSEDED (2026-09-10, during the migration-baseline backfill — see
-- foundation-hardening memory): this statement recreated worker_debt_items_view
-- in an OLDER, SMALLER shape than what supabase/migrations/20250101000000_
-- baseline.sql now captures (baseline was backfilled from the CURRENT live
-- schema, not the historical 2026-06-29 one it's dated as). Postgres's
-- `CREATE OR REPLACE VIEW` cannot drop columns, so on a from-scratch replay
-- this statement fails against the already-current baseline version — which
-- is fine, since baseline's version already IS this migration's end state
-- (verified against live production). Removed rather than commented out
-- wholesale so the file stays readable; the column-adds above (which this
-- view's SELECT needs) are unaffected and still run.
--
-- Roll project-attributed monthly salaries (payslip rows that now carry a
-- project_id) into the project's worker-cost total, alongside hourly sessions.
create or replace view public.project_worker_balance_view as
select
  d.project_id,
  count(*)::bigint as item_count,
  sum(d.earned_amount)::numeric(12,2) as earned_amount,
  sum(d.paid_amount)::numeric(12,2) as paid_amount,
  sum(d.owed_amount)::numeric(12,2) as owed_amount
from public.worker_debt_items_view d
where d.project_id is not null
group by d.project_id;

grant select on public.project_worker_balance_view to authenticated;
