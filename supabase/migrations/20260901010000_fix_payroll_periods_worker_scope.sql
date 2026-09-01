-- ════════════════════════════════════════════════════════════════════════════
-- payroll_periods had a policy (payroll_periods_view_all_logged) that let ANY
-- logged-in user read every payroll period — no role check at all:
--   USING (auth.uid() IS NOT NULL)
-- Flagged in the 2026-06-02 RLS audit, still present as of the 2026-09-01
-- re-audit. Every other payroll-adjacent table (salary_agreements, payslips,
-- hourly_salary_overrides) already follows the correct shape — admin/office
-- full access + a worker "view own" policy — this one just never got it.
--
-- Fix: drop the blanket policy, replace it with a worker policy scoped to
-- periods the worker actually has a payslip in (same join payslips already
-- uses to resolve its own "view own" policy). admin_full (is_admin()) and
-- office_manage (current_user_role()='office') policies are untouched and
-- keep full access.
--
-- Verified via a rolled-back dry run against prod (2026-09-01):
--   • admin: 5/5 periods, unchanged.
--   • worker with payslips in all 5 periods: 5/5, unchanged (this is the
--     worker /profile page's own payroll history — app/(app)/profile/page.tsx
--     resolves payroll_periods by the period ids on the worker's OWN payslip
--     rows, so "own periods" is exactly what that page needs).
--   • worker with zero payslips: 0/5 (was 5/5 before this fix).
--
-- Idempotent / safe to re-run. Run in the Supabase SQL Editor, or
-- `npm run db:push`.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "payroll_periods_view_all_logged" on public.payroll_periods;

create policy "payroll_periods_worker_view_own"
on public.payroll_periods
for select
to authenticated
using (
  exists (
    select 1 from public.payslips p
    where p.payroll_period_id = payroll_periods.id
      and p.user_id = public.current_app_user_id()
  )
);
