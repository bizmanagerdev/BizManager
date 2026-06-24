-- ════════════════════════════════════════════════════════════════════════════
-- Loans & repayments (הלוואות והחזרות). Run in the Supabase SQL Editor. Safe to re-run.
--
-- Model (per product decision):
--   • Both directions: 'taken' = the business BORROWED (cash in now, we owe);
--                      'given' = the business LENT (cash out now, owed to us).
--   • Full repayment log: each repayment is its own row in loan_repayments.
--   • Cash & debt, NOT profit: principal moves cash + changes the outstanding
--     debt/asset, but is NOT income/expense. Only the interest portion of a
--     repayment hits P&L. (Enforced in the app's financial engine, not here.)
--   • Documents (מסמכים) attach via the existing documents + document_links
--     system with entity_type='loan' — no column needed here.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  -- 'taken' = we borrowed (cash in, we owe) | 'given' = we lent (cash out, owed to us)
  direction text not null default 'taken' check (direction in ('taken', 'given')),
  lender text null,                 -- מלווה
  borrower text null,               -- לווה
  loan_date date not null,          -- תאריך הלוואה
  loan_method text null,            -- אופן ההלוואה (cash / bank_transfer / check / bit / ...)
  repayment_method text null,       -- אופן ההחזרה (planned)
  documentation text null,          -- תיעוד ההלוואה (free text: contract / verbal / promissory note...)
  amount numeric not null default 0 check (amount >= 0),  -- סכום ההלוואה (principal)
  due_date date null,               -- תאריך פרעון (expected full repayment)
  interest_amount numeric not null default 0,             -- ריבית: total expected interest (record-only)
  business_domain text not null default 'general_business',
  counterparty_customer_id uuid null references public.customers(id) on delete set null,
  -- 'active' | 'partially_repaid' | 'repaid' are derived from repayments by the app;
  -- 'written_off' is a manual terminal state (debt forgiven / uncollectible).
  status text not null default 'active'
    check (status in ('active', 'partially_repaid', 'repaid', 'written_off')),
  notes text null,                  -- הערות
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  repayment_date date not null,
  amount numeric not null default 0 check (amount >= 0),   -- total cash moved (principal + interest)
  interest_amount numeric not null default 0,              -- interest portion (P&L); principal = amount - interest
  method text null,                                        -- אופן ההחזרה (actual)
  notes text null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists loans_loan_date_idx on public.loans (loan_date desc);
create index if not exists loans_direction_idx on public.loans (direction);
create index if not exists loans_status_idx on public.loans (status);
create index if not exists loans_counterparty_idx on public.loans (counterparty_customer_id);
create index if not exists loan_repayments_loan_idx on public.loan_repayments (loan_id);
create index if not exists loan_repayments_date_idx on public.loan_repayments (repayment_date desc);

alter table public.loans enable row level security;
alter table public.loan_repayments enable row level security;

-- Admin/office: full access (same gate as expenses / card statements).
drop policy if exists "Staff manage loans" on public.loans;
create policy "Staff manage loans"
on public.loans
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

drop policy if exists "Staff manage loan repayments" on public.loan_repayments;
create policy "Staff manage loan repayments"
on public.loan_repayments
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

grant select, insert, update, delete on public.loans to authenticated;
grant select, insert, update, delete on public.loan_repayments to authenticated;
