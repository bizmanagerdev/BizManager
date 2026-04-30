alter table public.worker_payments enable row level security;
alter table public.worker_payment_allocations enable row level security;

drop policy if exists "Admins can manage worker payments" on public.worker_payments;
create policy "Admins can manage worker payments"
on public.worker_payments
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.role = 'admin'
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.role = 'admin'
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
);

drop policy if exists "Admins can manage worker payment allocations" on public.worker_payment_allocations;
create policy "Admins can manage worker payment allocations"
on public.worker_payment_allocations
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.role = 'admin'
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.role = 'admin'
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
);
