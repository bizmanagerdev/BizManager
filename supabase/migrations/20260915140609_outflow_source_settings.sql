-- ════════════════════════════════════════════════════════════════════════════
-- "מקורות נוספים" on the תשלומים קבועים tab: per-source planning settings for
-- the money that reaches the payments calendar from elsewhere in the system —
-- a worker's monthly salary (payroll), a loan's instalment plan (the loan
-- page), a credit card's monthly charge (statements).
--
-- The amount and the date stay with their owner and are never copied here.
-- What is stored is only the planning layer the user asked for:
--   reminder_work_days_before — alert N WORK days before the date (Fri+Sat
--                               don't count, same as recurring bills); null =
--                               the kind's default (cards 3, others none),
--                               0 = off
--   account_id                — the bank account it leaves from, so the
--                               board's account filter / cash calculator can
--                               scope it
--   is_active                 — off = this source is not shown on the board and
--                               never alerts (a card no longer in use, a worker
--                               on leave); the source itself is untouched
--
-- One row per (kind, key): key = the worker's user id / the loan id / the
-- card label. Staff (admin/office) manage; every system user can read.
-- Idempotent; safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.outflow_source_settings (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('salary', 'loan', 'card')),
  source_key text not null,
  reminder_work_days_before integer
    check (reminder_work_days_before is null or (reminder_work_days_before >= 0 and reminder_work_days_before <= 30)),
  account_id uuid references public.accounts(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outflow_source_settings_kind_key_unique unique (source_kind, source_key)
);

-- `create table if not exists` skips a table that already exists, so a column
-- added to this file later must also be added on its own — re-running the
-- file then brings an older table up to date.
alter table public.outflow_source_settings
  add column if not exists is_active boolean not null default true;

alter table public.outflow_source_settings enable row level security;

drop policy if exists "System users can read outflow source settings" on public.outflow_source_settings;
create policy "System users can read outflow source settings"
on public.outflow_source_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
);

drop policy if exists "Admins and office can manage outflow source settings" on public.outflow_source_settings;
create policy "Admins and office can manage outflow source settings"
on public.outflow_source_settings
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
);

grant select, insert, update, delete on public.outflow_source_settings to authenticated;

-- The three heads-up rules (salary / loan / card), so they can be toggled in
-- Settings → התראות. The rules run without these rows; the rows only make
-- them configurable.
insert into public.push_alert_config (title, body, url, mode, rule_key, audience_role, enabled, send_hour_israel)
values
  ('תזכורת למשכורת קרובה', '', '/financial/payments-calendar', 'live', 'salary_payment_reminder', 'office', true, 8),
  ('תזכורת להחזר הלוואה קרוב', '', '/financial/payments-calendar', 'live', 'loan_installment_reminder', 'office', true, 8),
  ('חיוב כרטיס אשראי קרוב', '', '/financial/payments-calendar', 'live', 'card_charge_upcoming', 'office', true, 8)
on conflict (rule_key) where rule_key is not null do nothing;
