-- Run this in the Supabase SQL Editor.
-- Remembers the business domain / project / property the user chose for each merchant
-- during credit-card statement imports, so repeat statements pre-fill themselves.

create table if not exists public.expense_merchant_mappings (
  id uuid primary key default gen_random_uuid(),
  merchant_key text not null unique,            -- normalized merchant name (lib/financial/cardImport norm())
  business_domain text not null,
  project_id uuid null references public.projects(id) on delete set null,
  property_id uuid null references public.properties(id) on delete set null,
  use_count integer not null default 1,
  last_used_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.expense_merchant_mappings enable row level security;

-- Admin/office: full access (same gate as expenses / communication center).
drop policy if exists "Staff manage merchant mappings" on public.expense_merchant_mappings;
create policy "Staff manage merchant mappings"
on public.expense_merchant_mappings
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

grant select, insert, update, delete on public.expense_merchant_mappings to authenticated;
