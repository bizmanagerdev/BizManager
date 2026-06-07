-- Run this in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Module 9 — communication tracking + reminders, powering the גבייה center:
-- log every contact with a customer (who was called, what they said) and set
-- follow-up reminders (who to call again, when). Both tables are linkable to the
-- money owed (order/project/property/payment) so collection calls tie to what is
-- outstanding. `category` lets a future general-פניות center reuse these tables.

-- ─── communication_logs (תיעוד פניות) ──────────────────────────────────────────
create table if not exists public.communication_logs (
  id uuid primary key default gen_random_uuid()
);

-- Add columns defensively so a pre-existing/partial table gets patched too.
alter table public.communication_logs
  add column if not exists customer_id uuid references public.customers(id) on delete cascade,
  add column if not exists user_id uuid references public.users(id) on delete set null,
  add column if not exists channel text not null default 'phone',
  add column if not exists direction text not null default 'outgoing',
  add column if not exists content text,
  add column if not exists category text not null default 'collection',
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists property_id uuid references public.properties(id) on delete set null,
  add column if not exists payment_id uuid references public.payments(id) on delete set null,
  add column if not exists created_by uuid references public.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

create index if not exists communication_logs_customer_idx
  on public.communication_logs (customer_id, created_at desc);
create index if not exists communication_logs_category_idx
  on public.communication_logs (category, created_at desc);

-- ─── reminders (תזכורות) ────────────────────────────────────────────────────────
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid()
);

alter table public.reminders
  add column if not exists customer_id uuid references public.customers(id) on delete cascade,
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists assigned_to uuid references public.users(id) on delete set null,
  add column if not exists remind_at timestamptz,
  add column if not exists content text,
  add column if not exists action_type text not null default 'call',
  add column if not exists status text not null default 'pending',
  add column if not exists category text not null default 'collection',
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists property_id uuid references public.properties(id) on delete set null,
  add column if not exists payment_id uuid references public.payments(id) on delete set null,
  add column if not exists communication_log_id uuid references public.communication_logs(id) on delete set null,
  add column if not exists created_by uuid references public.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

-- remind_at is required for new rows; enforce only if no NULLs exist already.
do $$
begin
  if not exists (select 1 from public.reminders where remind_at is null) then
    begin
      alter table public.reminders alter column remind_at set not null;
    exception when others then
      -- ignore (e.g. column already not null)
      null;
    end;
  end if;
end $$;

-- Keep status within the app's canonical set (pending / done / cancelled).
-- Re-created idempotently in case an older/looser constraint exists.
alter table public.reminders drop constraint if exists reminders_status_check;
update public.reminders
set status = case
  when status in ('completed', 'complete', 'closed') then 'done'
  when status in ('canceled') then 'cancelled'
  else 'pending'
end
where status is null
   or status not in ('pending', 'done', 'cancelled');
alter table public.reminders
  add constraint reminders_status_check
  check (status in ('pending', 'done', 'cancelled'));

create index if not exists reminders_status_due_idx
  on public.reminders (status, remind_at);
create index if not exists reminders_customer_idx
  on public.reminders (customer_id, remind_at);
create index if not exists reminders_assigned_idx
  on public.reminders (assigned_to, status, remind_at);

-- keep updated_at fresh
create or replace function public.set_reminders_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reminders_set_updated_at on public.reminders;
create trigger reminders_set_updated_at
  before update on public.reminders
  for each row execute function public.set_reminders_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────────
alter table public.communication_logs enable row level security;
alter table public.reminders enable row level security;

-- Admin/office: full access to both tables.
drop policy if exists "Office manages communication logs" on public.communication_logs;
create policy "Office manages communication logs"
on public.communication_logs
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

drop policy if exists "Office manages reminders" on public.reminders;
create policy "Office manages reminders"
on public.reminders
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

-- A worker may see + update (e.g. mark done) reminders assigned to them.
drop policy if exists "Assignee reads own reminders" on public.reminders;
create policy "Assignee reads own reminders"
on public.reminders
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.id = public.reminders.assigned_to
      and u.active = true
  )
);

drop policy if exists "Assignee updates own reminders" on public.reminders;
create policy "Assignee updates own reminders"
on public.reminders
for update
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.id = public.reminders.assigned_to
      and u.active = true
  )
);

grant select, insert, update, delete on public.communication_logs to authenticated;
grant select, insert, update, delete on public.reminders to authenticated;
