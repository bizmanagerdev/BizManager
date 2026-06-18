-- ════════════════════════════════════════════════════════════════════════════
-- VAT tracking for project payments — Phase 1 + Phase 2 schema.
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Model (see also project_financials_view_vat_aware.sql):
--   • Each payment stores what ARRIVED (amount_total, gross) and how much COUNTS
--     toward the project price (net_amount). VAT = amount_total − net_amount.
--   • "official" (requires_split = true) is the ONLY thing that strips VAT; the
--     payment METHOD is irrelevant. Non-official payments count in full
--     (net_amount = amount_total, vat_amount = 0).
--   • The VAT rate is a single editable business setting, FROZEN onto each
--     payment row (payments.vat_rate) so changing the rate never alters old rows.
--   • Phase 2 (projects.price_includes_vat): when on, the project's target price
--     is the gross (base × (1 + project vat_rate)); those projects record every
--     payment in full (no per-payment "official" toggle).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Editable VAT rate (single-row settings table, mirrors morning_settings) ──
create table if not exists public.business_settings (
  id boolean primary key default true,
  vat_rate numeric not null default 0.18,
  updated_at timestamptz default now(),
  updated_by uuid,
  constraint business_settings_singleton check (id = true)
);

insert into public.business_settings (id, vat_rate)
values (true, 0.18)
on conflict (id) do nothing;

alter table public.business_settings enable row level security;

drop policy if exists business_settings_select on public.business_settings;
create policy business_settings_select on public.business_settings
  for select to authenticated using (true);

drop policy if exists business_settings_write on public.business_settings;
create policy business_settings_write on public.business_settings
  for all to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.auth_user_id = auth.uid() and u.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.auth_user_id = auth.uid() and u.role = 'admin'
    )
  );

-- ── 2. Payment columns: frozen rate + explicit VAT amount ──────────────────────
alter table public.payments add column if not exists vat_rate numeric;
alter table public.payments add column if not exists vat_amount numeric;

-- Backfill: non-official rows count in full; official rows split off VAT.
update public.payments
set net_amount = amount_total
where net_amount is null and coalesce(requires_split, false) = false;

update public.payments
set
  vat_amount = round((coalesce(amount_total, 0) - coalesce(net_amount, amount_total, 0))::numeric, 2),
  vat_rate = case when coalesce(requires_split, false) then 0.18 else 0 end
where vat_amount is null or vat_rate is null;

-- ── 3. Row-level consistency: arrived = counts + VAT, on every payment ─────────
alter table public.payments drop constraint if exists payment_amounts_valid;
alter table public.payments drop constraint if exists payments_split_consistency_chk;

alter table public.payments
  add constraint payments_split_consistency_chk
  check (
    (
      requires_split = false
      and amount_total is not null
      and round(net_amount::numeric, 2) = round(amount_total::numeric, 2)
      and amount_including_vat is null
      and amount_before_vat is null
      and (vat_amount is null or round(vat_amount::numeric, 2) = 0)
    )
    or
    (
      requires_split = true
      and amount_total is not null
      and amount_including_vat is not null
      and amount_before_vat is not null
      and round(amount_including_vat::numeric, 2) = round(amount_total::numeric, 2)
      and round(net_amount::numeric, 2) = round(amount_before_vat::numeric, 2)
      and round(coalesce(vat_amount, 0)::numeric, 2) = round((amount_total - net_amount)::numeric, 2)
    )
  );

-- ── 4. Project VAT mode (Phase 2) ──────────────────────────────────────────────
-- price_includes_vat = false (default): agreed price is NET; official payments
--   strip VAT; VAT never inflates the project price.
-- price_includes_vat = true: the customer pays base + VAT; the project's tracked
--   total is the gross (base × (1 + vat_rate)); every payment counts in full.
-- projects.vat_rate freezes the rate used for that project's gross target.
alter table public.projects add column if not exists price_includes_vat boolean not null default false;
alter table public.projects add column if not exists vat_rate numeric;
