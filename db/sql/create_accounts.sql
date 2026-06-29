-- ════════════════════════════════════════════════════════════════════════════
-- Accounts layer (חשבונות) — model real money containers with a running balance.
-- Run in the Supabase SQL Editor. Idempotent / safe to re-run.
--
-- Model (per product decision):
--   • An account is a real container money moves THROUGH: a bank account or a
--     cash holding (cards are out of scope for now — the 'card' kind exists so
--     the enum is future-proof, but nothing assigns to it yet).
--   • Each account has an OPENING BALANCE as of an OPENING DATE — the real ₪
--     figure on go-live day. Everything dated before that is assumed already
--     baked into the opening number, so the engine only sums rows on/after it.
--   • Multiple banks + multiple cash holdings → every money row carries an
--     EXPLICIT account_id (nullable: legacy rows backfill lazily, never blocks
--     a write). Deriving from payment_method alone can't tell two banks apart.
--   • This is a READ/AGGREGATION layer. The authoritative running balance is
--     computed in the app's financial engine off the already-staged
--     FinancialEntry list (opening + Σ posted), NOT by a SQL aggregate view —
--     a security_invoker aggregate over RLS tables returns per-role numbers
--     (the product-popularity bug), and the posted/pending/scheduled staging
--     logic already lives in lib/financial. SQL here is table + columns only.
--   • Accounts are ORTHOGONAL to tags/entity_tags: a tag says what money was
--     FOR (which car), an account says which container it moved THROUGH.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,                          -- "פועלים – עו״ש", "מזומן – משרד"
  -- 'bank' / 'cash' now; 'card' reserved for later (no rows assign to it yet)
  kind text not null default 'bank' check (kind in ('bank', 'cash', 'card')),
  opening_balance numeric not null default 0,  -- real ₪ figure on opening_date
  opening_date date not null,                  -- balance is "as of" this date
  is_active boolean not null default true,     -- hide closed accounts
  sort_order integer not null default 0,       -- display order
  notes text null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accounts_active_idx on public.accounts (is_active);
create index if not exists accounts_kind_idx on public.accounts (kind);
create index if not exists accounts_sort_idx on public.accounts (sort_order);

-- Explicit account assignment on every money-moving row. Nullable so nothing
-- breaks and history backfills lazily. on delete set null: removing an account
-- must never delete the underlying payment/expense.
alter table public.payments         add column if not exists account_id uuid null references public.accounts(id) on delete set null;
alter table public.expenses         add column if not exists account_id uuid null references public.accounts(id) on delete set null;
alter table public.worker_payments  add column if not exists account_id uuid null references public.accounts(id) on delete set null;
alter table public.loan_repayments  add column if not exists account_id uuid null references public.accounts(id) on delete set null;
alter table public.loans            add column if not exists account_id uuid null references public.accounts(id) on delete set null;

create index if not exists payments_account_idx        on public.payments (account_id);
create index if not exists expenses_account_idx        on public.expenses (account_id);
create index if not exists worker_payments_account_idx on public.worker_payments (account_id);
create index if not exists loan_repayments_account_idx on public.loan_repayments (account_id);
create index if not exists loans_account_idx           on public.loans (account_id);

alter table public.accounts enable row level security;

-- Admin/office with system access: full access (same gate as loans / expenses).
drop policy if exists "Staff manage accounts" on public.accounts;
create policy "Staff manage accounts"
on public.accounts
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

grant select, insert, update, delete on public.accounts to authenticated;

-- ── Audit ───────────────────────────────────────────────────────────────────
-- Bring accounts into the activity feed (same generic log_changes() trigger as
-- vehicles/tags). Deploy together with adding 'accounts' to TRIGGER_AUDITED_TABLES.
drop trigger if exists trg_audit_accounts on public.accounts;
create trigger trg_audit_accounts
  after insert or update or delete on public.accounts
  for each row execute function public.log_changes();
