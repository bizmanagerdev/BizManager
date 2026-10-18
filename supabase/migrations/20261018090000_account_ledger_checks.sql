-- ════════════════════════════════════════════════════════════════════════════
-- "נבדק מול הבנק" — a tick on each line of an account's register once it has
-- been compared against the bank statement (owner, 2026-10-18: "I want each row
-- to have a checkbox to mark if we compared it against the bank yet ... then I
-- always know what's not worked on yet").
--
-- One row per ticked register line, per account. A register line is not one
-- table: it is a payment, an expense, a wage, a loan or repayment, one leg of a
-- transfer, a card charge, or a Grow deposit (many card payments). So a line is
-- identified by the key the register already gives it (lib/accounts.ts —
-- "p:<payment id>", "e:<expense id>", "t:<transfer id>:out", "ccb:<account>:<date>"
-- …), together with its account (a transfer's two legs are ticked separately).
--
-- The amount and date at the moment of the tick are kept: if the line is edited
-- afterwards, the tick no longer counts (owner: "yes" — a changed line has to be
-- checked again). Balances are not touched.
--
-- Admin-only, like the חשבונות page itself. Idempotent; safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.account_ledger_checks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  entry_key text not null,
  -- Signed: money in is positive, money out negative.
  amount_at_check numeric(14, 2) not null,
  date_at_check date not null,
  checked_at timestamptz not null default now(),
  checked_by uuid references public.users(id) on delete set null,
  constraint account_ledger_checks_entry_unique unique (account_id, entry_key)
);

alter table public.account_ledger_checks enable row level security;

drop policy if exists "Admins can manage account ledger checks" on public.account_ledger_checks;
create policy "Admins can manage account ledger checks"
on public.account_ledger_checks
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role = 'admin'
  )
);
