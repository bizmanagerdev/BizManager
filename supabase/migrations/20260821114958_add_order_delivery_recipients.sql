-- Lets the person scheduling a delivery (the calendar's "משלוח" quick-create)
-- point it at specific people, so it shows on THEIR "mine" calendar too — not
-- just the order's creator and office/admin (who already see everything).
--
-- RLS mirrors reminders' exact pattern (db/sql/create_communication_center.sql):
-- office/admin manage every row, and the assigned person can read their own.
--
-- Idempotent: safe to run more than once.

begin;

create table if not exists public.order_delivery_recipients (
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (order_id, user_id)
);

alter table public.order_delivery_recipients enable row level security;

drop policy if exists "Office manages order_delivery_recipients" on public.order_delivery_recipients;
create policy "Office manages order_delivery_recipients"
on public.order_delivery_recipients
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

-- A recipient (e.g. a driver who isn't office/admin) needs to read their OWN
-- assignment row under their own session — the calendar query runs as the
-- viewer, not an admin client.
drop policy if exists "Recipient reads own delivery assignment" on public.order_delivery_recipients;
create policy "Recipient reads own delivery assignment"
on public.order_delivery_recipients
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.id = public.order_delivery_recipients.user_id
      and u.active = true
  )
);

commit;
