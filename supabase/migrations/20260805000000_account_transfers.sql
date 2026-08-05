-- ════════════════════════════════════════════════════════════════════════════
-- העברה בין חשבונות — moving money between two of OUR OWN accounts.
--
-- Covers both real-life cases the business has:
--   • משיכת מזומן — pulling cash out of the business bank account into the
--     cash box (bank → cash).
--   • bank → bank — shifting money to whichever account needs to cover a
--     payment.
--
-- WHY ITS OWN TABLE (and not an expense + an income pair): a transfer moves
-- NOTHING in or out of the business. Booking it as an expense on one side and
-- an income on the other would inflate both the P&L and the cash-flow report
-- with money that never entered or left. Here it only ever touches the accounts
-- ledger: one OUT row on the source account, one IN row on the destination —
-- equal and opposite, so total liquidity is unchanged by construction.
--
-- The financial engine (lib/financial) deliberately never reads this table.
-- Only lib/accounts.ts does.
--
-- Idempotent / safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.account_transfers (
  id uuid primary key default gen_random_uuid(),
  from_account_id uuid not null references public.accounts(id) on delete cascade,
  to_account_id uuid not null references public.accounts(id) on delete cascade,
  amount numeric not null check (amount > 0),
  transfer_date date not null,
  notes text null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Money can't move from an account to itself.
  constraint account_transfers_distinct_accounts check (from_account_id <> to_account_id)
);

-- The balance scan reads by account and by date window (rows on/after each
-- account's opening_date).
create index if not exists account_transfers_from_idx on public.account_transfers (from_account_id);
create index if not exists account_transfers_to_idx   on public.account_transfers (to_account_id);
create index if not exists account_transfers_date_idx on public.account_transfers (transfer_date);

alter table public.account_transfers enable row level security;

-- Same gate as the accounts table itself: admin/office with system access.
drop policy if exists "Staff manage account transfers" on public.account_transfers;
create policy "Staff manage account transfers"
on public.account_transfers
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

grant select, insert, update, delete on public.account_transfers to authenticated;

-- ── Audit ───────────────────────────────────────────────────────────────────
-- Same generic trigger every business table carries (see
-- 20260724050000_audit_all_business_tables.sql). 'account_transfers' is added to
-- TRIGGER_AUDITED_TABLES in lib/audit.ts so the API route doesn't double-log.
drop trigger if exists trg_audit_account_transfers on public.account_transfers;
create trigger trg_audit_account_transfers
  after insert or update or delete on public.account_transfers
  for each row execute function public.log_changes();
