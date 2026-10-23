-- ════════════════════════════════════════════════════════════════════════════
-- Money in US$ and C$, step 5 of 9: a transfer between accounts kept in
-- different currencies — what left one, and what arrived in the other (owner,
-- 2026-10-23). A bank's rate isn't the official one: 25 Plourde's down payment
-- went $250,822 → C$360,137, a rate of 1.436, when the Bank of Israel's cross
-- rate that day was about 1.40 — so both sides are kept as they were.
--
-- A transfer keeps, as before, ONE shekel amount (`amount`), and now beside it:
--   from_amount  what left the "from" account, in ITS currency — empty when
--                that account is in shekels (then `amount` is what left)
--   to_amount    what arrived in the "to" account, in ITS currency — empty
--                when that account is in shekels (then `amount` is what came)
--
--   ₪ → ₪     amount                         (every transfer today)
--   ₪ → $     amount = ₪ that left,   to_amount = $ that arrived
--   $ → ₪     from_amount = $ that left,   amount = ₪ that arrived
--   $ → C$    from_amount, to_amount as they were; amount = what left, in
--             shekels at the Bank of Israel rate of the day (no shekels moved)
--   $ → $     from_amount = to_amount; amount as $ → C$
--
-- A transfer moves no money out of the business, so no profit or loss is
-- booked on the difference between the two sides — it's the bank's rate.
--
-- The database keeps it in step (trigger fx_fill_transfer) whoever writes the
-- row: a side in shekels has no amount of its own; a side in dollars must have
-- one (the same as the other side's when both are in that currency); a
-- transfer between two dollar accounts gets its shekels from the day's rate.
--
-- Transfers to and from a US$ or C$ account are allowed from now on (step 2
-- held them off). An account with transfers can't change its currency at all,
-- since each side is kept in its account's currency.
--
-- NOTHING CHANGES FOR EXISTING ROWS: every transfer today is between shekel
-- accounts, and both new columns start empty. Idempotent; safe to re-run.
-- Rollback: supabase/rollbacks/20261023150000_transfer_currencies.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

alter table public.account_transfers
  add column if not exists from_amount numeric(14, 2),
  add column if not exists to_amount numeric(14, 2);

alter table public.account_transfers drop constraint if exists account_transfers_side_amounts_check;
alter table public.account_transfers add constraint account_transfers_side_amounts_check
  check ((from_amount is null or from_amount > 0) and (to_amount is null or to_amount > 0));

create or replace function public.fx_fill_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  from_cur text;
  to_cur text;
  rate numeric;
  label text;
begin
  -- A "מול מזומן" card line has no "from": its other side is the card, in shekels.
  select coalesce((select a.currency from public.accounts a where a.id = new.from_account_id), 'ILS') into from_cur;
  select coalesce((select a.currency from public.accounts a where a.id = new.to_account_id), 'ILS') into to_cur;

  if from_cur = 'ILS' then
    new.from_amount := null;
  elsif new.from_amount is null then
    label := case from_cur when 'USD' then 'בדולרים' else 'בדולרים קנדיים' end;
    raise exception using errcode = '23514', message = format('חסר הסכום שיצא %s', label);
  end if;

  if to_cur = 'ILS' then
    new.to_amount := null;
  elsif new.to_amount is null then
    if from_cur = to_cur then
      new.to_amount := new.from_amount;
    else
      label := case to_cur when 'USD' then 'בדולרים' else 'בדולרים קנדיים' end;
      raise exception using errcode = '23514', message = format('חסר הסכום שהגיע %s', label);
    end if;
  end if;

  -- Between two dollar accounts no shekels moved: what left, at the day's rate
  -- — worked out when it's made, or when what left, the day or the accounts
  -- change (not on every edit of its note).
  if from_cur <> 'ILS' and to_cur <> 'ILS' and (
       tg_op = 'INSERT'
    or new.from_amount is distinct from old.from_amount
    or new.transfer_date is distinct from old.transfer_date
    or new.from_account_id is distinct from old.from_account_id
    or new.to_account_id is distinct from old.to_account_id
  ) then
    rate := public.fx_rate_on(from_cur, new.transfer_date);
    if rate is null then
      raise exception using errcode = '23514',
        message = format('אין שער יציג ל-%s ליום %s', from_cur, to_char(new.transfer_date, 'DD/MM/YYYY'));
    end if;
    new.amount := round(new.from_amount * rate, 2);
  end if;

  return new;
end;
$$;

-- Transfers now carry their currencies: off the shekels-only guard.
drop trigger if exists trg_fx_shekel_only on public.account_transfers;
drop trigger if exists trg_fx_transfer on public.account_transfers;
create trigger trg_fx_transfer before insert or update on public.account_transfers
  for each row execute function public.fx_fill_transfer();

-- An account's currency stays put once it has rows in another — and, now,
-- once it has any transfer at all (each side is in its account's currency).
create or replace function public.fx_guard_account_currency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.currency := upper(coalesce(new.currency, 'ILS'));
  if tg_op = 'UPDATE' and new.currency is distinct from old.currency and (
       exists (select 1 from public.payments where account_id = new.id and currency <> new.currency)
    or exists (select 1 from public.expenses where account_id = new.id and currency <> new.currency)
    or exists (select 1 from public.loans where account_id = new.id and currency <> new.currency)
    or exists (select 1 from public.loan_repayments where account_id = new.id and currency <> new.currency)
    or exists (select 1 from public.account_transfers where from_account_id = new.id or to_account_id = new.id)
    or (new.currency <> 'ILS' and (
         exists (select 1 from public.worker_payments where account_id = new.id)
      or exists (select 1 from public.card_statement_charges where account_id = new.id)))
  ) then
    raise exception using errcode = '23514',
      message = format('אי אפשר לשנות את המטבע של "%s": יש בו כבר תנועות במטבע אחר', new.name);
  end if;
  return new;
end;
$$;
