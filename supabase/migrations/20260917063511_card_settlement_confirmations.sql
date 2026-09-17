-- ════════════════════════════════════════════════════════════════════════════
-- Confirming that a credit-card clearing deposit (Grow) actually landed.
--
-- Until now a batch counted as arrived purely by date: on its settlement day
-- (the 10th) it appeared in the account whether or not the money was really
-- there. The user wants to confirm it, on צפי תזרים.
--
-- Why a separate table and not the payments' own status: a card payment is
-- stored as `cleared` on purpose, because the CUSTOMER has paid the moment
-- their card is charged — the order must show as paid. Whether the clearing
-- company has deposited the month's total is a different event, about our
-- bank account rather than the customer. Reusing payment_status for it would
-- make every card-paid order look unpaid until the deposit.
--
-- One row per deposit, keyed exactly the way the app groups a batch: the
-- account it lands in + its settlement date.
--
-- BACKFILL: every batch whose settlement date has already passed is inserted
-- as confirmed, so history stays arrived — including card payments that never
-- had a due date, which are now grouped into their month's deposit too. Only
-- deposits from today onwards wait for a confirmation.
--
-- Idempotent; safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.card_settlement_confirmations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  settlement_date date not null,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid references public.users(id) on delete set null,
  constraint card_settlement_confirmations_batch_unique unique (account_id, settlement_date)
);

alter table public.card_settlement_confirmations enable row level security;

drop policy if exists "System users can read card settlement confirmations" on public.card_settlement_confirmations;
create policy "System users can read card settlement confirmations"
on public.card_settlement_confirmations
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
);

drop policy if exists "Admins and office can manage card settlement confirmations" on public.card_settlement_confirmations;
create policy "Admins and office can manage card settlement confirmations"
on public.card_settlement_confirmations
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
);

-- Past deposits count as arrived; keep it that way.
-- Same definition of a batch the app uses (cardSettlementDate in
-- lib/card-settlements.ts): every incoming credit_card payment, not bounced,
-- attached to an account, lands on the 10th of the month after it was paid —
-- or on its own due_date when that is later still.
insert into public.card_settlement_confirmations (account_id, settlement_date, confirmed_at)
select distinct b.account_id, b.settlement_date, now()
from (
  select
    p.account_id,
    greatest(
      (date_trunc('month', p.payment_date::date) + interval '1 month' + interval '9 days')::date,
      p.due_date::date
    ) as settlement_date
  from public.payments p
  where p.payment_method = 'credit_card'
    and p.account_id is not null
    and p.payment_date is not null
    and coalesce(p.amount_total, 0) > 0
    and coalesce(lower(p.payment_status::text), '') <> 'rejected'
) b
where b.settlement_date < current_date
on conflict (account_id, settlement_date) do nothing;
