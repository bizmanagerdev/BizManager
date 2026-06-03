-- Run this in the Supabase SQL Editor.
-- Persists each credit-card statement import as an editable record: the uploaded file
-- (via documents) plus one row per imported transaction, each linked to the expense it
-- created. Editing happens on the live expense; these rows are the "as imported" snapshot.

create table if not exists public.card_statements (
  id uuid primary key default gen_random_uuid(),
  file_name text not null default '',
  source text not null default 'excel',          -- 'excel' | 'pdf'
  document_id uuid null references public.documents(id) on delete set null,
  storage_key text null,                          -- copy of the file's storage path (signed-url convenience)
  total_rows integer not null default 0,          -- rows reviewed
  created_count integer not null default 0,       -- expenses actually created
  imported_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);


create table if not exists public.card_statement_rows (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.card_statements(id) on delete cascade,
  expense_id uuid null references public.expenses(id) on delete set null,
  expense_date date null,                         -- billing date (mirrors expenses.expense_date at import)
  transaction_date date null,
  amount numeric null,
  description text null,
  category text null,                             -- card label
  business_domain text null,
  project_id uuid null references public.projects(id) on delete set null,
  property_id uuid null references public.properties(id) on delete set null,
  notes text null,
  created_at timestamptz not null default now()
);

create index if not exists card_statement_rows_statement_idx on public.card_statement_rows (statement_id);
create index if not exists card_statement_rows_expense_idx on public.card_statement_rows (expense_id);
create index if not exists card_statements_created_at_idx on public.card_statements (created_at desc);

alter table public.card_statements enable row level security;
alter table public.card_statement_rows enable row level security;

-- Admin/office: full access (same gate as expenses / communication center).
drop policy if exists "Staff manage card statements" on public.card_statements;
create policy "Staff manage card statements"
on public.card_statements
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

drop policy if exists "Staff manage card statement rows" on public.card_statement_rows;
create policy "Staff manage card statement rows"
on public.card_statement_rows
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

grant select, insert, update, delete on public.card_statements to authenticated;
grant select, insert, update, delete on public.card_statement_rows to authenticated;
