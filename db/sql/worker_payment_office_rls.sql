-- Run this in Supabase SQL Editor.
-- Grants office role the access it needs to manage sessions and worker payments.

-- ── worker_payments ──────────────────────────────────────────────────────────
drop policy if exists "Office can manage worker payments" on public.worker_payments;
create policy "Office can manage worker payments"
on public.worker_payments
for all
to authenticated
using (current_user_role() = 'office'::user_role_enum)
with check (current_user_role() = 'office'::user_role_enum);

-- ── worker_payment_allocations ───────────────────────────────────────────────
drop policy if exists "Office can manage worker payment allocations" on public.worker_payment_allocations;
create policy "Office can manage worker payment allocations"
on public.worker_payment_allocations
for all
to authenticated
using (current_user_role() = 'office'::user_role_enum)
with check (current_user_role() = 'office'::user_role_enum);

-- ── payslips ─────────────────────────────────────────────────────────────────
-- Saving/editing a session regenerates payslips (SELECT + INSERT + UPDATE).
-- Replace the insert-only policy with full access.
drop policy if exists "payslips_office_insert" on public.payslips;
drop policy if exists "Office can manage payslips" on public.payslips;
create policy "Office can manage payslips"
on public.payslips
for all
to authenticated
using (current_user_role() = 'office'::user_role_enum)
with check (current_user_role() = 'office'::user_role_enum);

-- ── salary_agreements (read-only for office) ─────────────────────────────────
-- Payslip regeneration reads salary agreements to compute correct labor costs.
drop policy if exists "Office can read salary agreements" on public.salary_agreements;
create policy "Office can read salary agreements"
on public.salary_agreements
for select
to authenticated
using (current_user_role() = 'office'::user_role_enum);
