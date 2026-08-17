-- בונוסים וימי חופש — two things payroll had no home for.
--
-- 1. **בונוס** — extra money for a worker on a given day. It is a רכיב שכר, so it
--    lives in `payslip_items` like every other one; this adds the three columns
--    that let a worker record his own:
--      • user_id    — whose item it is. Until now that was only knowable through
--                     the payslip it hung off, so an item could not exist before
--                     the payslip did.
--      • item_date  — which DAY it is for ("worked ten hours today → ₪300").
--      • payslip_id becomes NULLABLE — a bonus recorded mid-month has no payslip
--                     yet. It sits loose until that month's payslip is generated,
--                     which adopts every loose item dated inside the period
--                     (attachLooseItemsToPayslip) and folds it into the ברוטו.
--    No approval step: the worker writes it and it counts. What he may write is
--    narrow — see the RLS policies below.
--
-- 2. **יום חופש / היעדרות** — a day a GLOBAL (monthly) worker didn't work. It
--    changes no money on purpose (he's paid the full month either way); it exists
--    so the exported hours sheet leaves that day empty instead of printing the
--    standard 09:00–18:00 it otherwise assumes for every Sun–Thu.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. payslip_items grows an owner and a date
-- ════════════════════════════════════════════════════════════════════════════

alter table public.payslip_items
  add column if not exists user_id uuid references public.users(id) on delete cascade;

alter table public.payslip_items
  add column if not exists item_date date;

alter table public.payslip_items
  add column if not exists created_by uuid references public.users(id) on delete set null;

-- Existing rows all hang off a payslip, which is where their owner comes from.
update public.payslip_items pi
set user_id = p.user_id
from public.payslips p
where pi.payslip_id = p.id
  and pi.user_id is null;

alter table public.payslip_items alter column payslip_id drop not null;

-- Every item must belong to SOMEONE, whether or not it's on a payslip yet.
do $$
begin
  if not exists (select 1 from public.payslip_items where user_id is null) then
    alter table public.payslip_items alter column user_id set not null;
  end if;
end
$$;

-- The app has offered these nine types for a long time, but the check constraint
-- still only allowed the original seven — so picking "דמי נסיעה" or "חודש חלקי"
-- failed with a constraint violation. Widened to the list the UI actually shows,
-- keeping the legacy values so old rows stay valid.
alter table public.payslip_items drop constraint if exists payslip_items_item_type_check;
alter table public.payslip_items
  add constraint payslip_items_item_type_check
  check (item_type in (
    'bonus', 'overtime_extra', 'travel_allowance', 'meal_allowance', 'advance',
    'deduction', 'exception_absence', 'exception_partial_month', 'manual_adjustment',
    -- legacy values from the original schema
    'fine', 'travel', 'expense_reimbursement', 'other'
  ));

create index if not exists payslip_items_user_date_idx
  on public.payslip_items (user_id, item_date desc);

-- The ones still waiting to be rolled into a payslip.
create index if not exists payslip_items_unattached_idx
  on public.payslip_items (user_id, item_date)
  where payslip_id is null;

-- ── RLS: a worker may add his OWN bonus ─────────────────────────────────────

alter table public.payslip_items enable row level security;

-- Read: his own items, whether or not they've reached a payslip yet. (Replaces the
-- payslip-join-only version from 20260810000000, which couldn't see a loose row.)
drop policy if exists "payslip_items_view_own" on public.payslip_items;
create policy "payslip_items_view_own"
on public.payslip_items
for select
to authenticated
using (
  user_id = public.current_app_user_id()
  or exists (
    select 1
    from public.payslips p
    where p.id = payslip_items.payslip_id
      and p.user_id = public.current_app_user_id()
  )
);

-- Write: a POSITIVE BONUS, for himself, not yet attached to a payslip. He cannot
-- write himself a travel allowance, a negative deduction, an item for someone else,
-- or an item straight onto an existing (possibly locked) payslip.
drop policy if exists "payslip_items_worker_add_own_bonus" on public.payslip_items;
create policy "payslip_items_worker_add_own_bonus"
on public.payslip_items
for insert
to authenticated
with check (
  user_id = public.current_app_user_id()
  and created_by = public.current_app_user_id()
  and item_type = 'bonus'
  and amount > 0
  and payslip_id is null
);

-- Taking it back — only while it hasn't been rolled into a payslip. Once it's on
-- the payslip it's payroll, and payroll is the admin's.
drop policy if exists "payslip_items_worker_delete_own_unattached" on public.payslip_items;
create policy "payslip_items_worker_delete_own_unattached"
on public.payslip_items
for delete
to authenticated
using (
  user_id = public.current_app_user_id()
  and item_type = 'bonus'
  and payslip_id is null
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. worker_absences — "he wasn't here that day"
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.worker_ledger_touch_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.worker_absences (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  absence_date date not null,
  absence_type text not null default 'day_off',
  -- Global workers keep their full salary; the flag exists so an unpaid day can
  -- be recorded honestly if that ever comes up. Nothing reads it for money yet.
  paid boolean not null default true,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  -- One row per worker per day: marking the same day twice is always a mistake.
  unique (user_id, absence_date)
);

alter table public.worker_absences drop constraint if exists worker_absences_type_check;
alter table public.worker_absences
  add constraint worker_absences_type_check
  check (absence_type in ('day_off', 'vacation', 'sick', 'holiday', 'unpaid', 'other'));

create index if not exists worker_absences_user_date_idx
  on public.worker_absences (user_id, absence_date desc);

create index if not exists worker_absences_date_idx
  on public.worker_absences (absence_date);

drop trigger if exists worker_absences_set_updated_at on public.worker_absences;
create trigger worker_absences_set_updated_at
  before update on public.worker_absences
  for each row execute function public.worker_ledger_touch_updated_at();

alter table public.worker_absences enable row level security;

-- No money moves here, so office manages it alongside the rest of the hours.
drop policy if exists "worker_absences_staff_manage" on public.worker_absences;
create policy "worker_absences_staff_manage"
on public.worker_absences
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office')
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office')
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
);

drop policy if exists "worker_absences_select_own" on public.worker_absences;
create policy "worker_absences_select_own"
on public.worker_absences
for select
to authenticated
using (user_id = public.current_app_user_id());
