-- Collections restructure (Phase C): payment promises (הבטחת תשלום).
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- A promise is an AR-specific record: "customer promised ₪X by date Y". It feeds
-- expected income on the debtor, and a broken promise (date passed, still open)
-- surfaces as a system reminder via the rules engine.

create table if not exists public.payment_promises (
  id uuid not null default gen_random_uuid() primary key,
  customer_id uuid,
  order_id uuid,
  project_id uuid,
  amount numeric(12, 2) not null,
  promised_date date not null,
  status text not null default 'pending', -- pending | kept | broken | cancelled
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.payment_promises drop constraint if exists payment_promises_status_check;
alter table public.payment_promises
  add constraint payment_promises_status_check check (status in ('pending', 'kept', 'broken', 'cancelled'));

create index if not exists payment_promises_customer_idx on public.payment_promises (customer_id);
create index if not exists payment_promises_open_idx
  on public.payment_promises (promised_date)
  where status = 'pending';

alter table public.payment_promises enable row level security;

drop policy if exists "Staff manage payment promises" on public.payment_promises;
create policy "Staff manage payment promises"
on public.payment_promises
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
