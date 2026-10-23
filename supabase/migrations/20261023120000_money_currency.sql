-- ════════════════════════════════════════════════════════════════════════════
-- Money in US$ and C$, step 2 of 9: a currency on each account and on each
-- money row (owner, 2026-10-22: "dollar to shekel and Canada to shekel — on the
-- spot, for the accounts"; plan approved 2026-10-23).
--
-- THE RULE: every amount column the app already has stays in shekels —
-- payments.amount_total, expenses.amount, loans.amount, loan_repayments.amount.
-- A row in US$ or C$ keeps, beside it, the amount as typed (foreign_amount)
-- and the rate of its own day (fx_rate, shekels per unit); its shekel amount
-- is foreign_amount × fx_rate. So every total, report, view and the phone's
-- copy keep adding shekels and stay right without being rewritten, and a
-- later move of the dollar never changes a row already saved.
--
-- WHAT EACH ROW GETS (payments, expenses, loans, loan_repayments):
--   currency        'ILS' (every row today, and the default), 'USD' or 'CAD'
--   foreign_amount  the amount in that currency — empty for shekels
--   fx_rate         shekels per unit on the row's day — empty for shekels
--   fx_rate_manual  the rate was typed by hand (the owner's choice, 2026-10-23:
--                   filled in from the Bank of Israel, and can be changed)
-- An account gets `currency` too; its opening balance is in that currency.
--
-- THE DATABASE KEEPS THEM IN STEP (trigger fx_fill_amounts), whichever screen,
-- route or phone writes the row:
--   * A foreign row's shekel amount is worked out here: foreign_amount ×
--     fx_rate. With no rate given, the day's Bank of Israel rate is used
--     (fx_rate_on — the last one before it on a weekend or a holiday); a row
--     whose date moves takes the new day's rate, unless its rate was typed.
--   * A screen that doesn't know about currencies yet and changes only the
--     shekel amount of a foreign row (an edit, a split) keeps the row's rate
--     and moves the foreign amount with it.
--   * On an account kept in US$ or C$, every row must be in that currency.
--     A shekel account takes rows in any currency (their shekel amount is
--     what it counts — a customer paying $1,000 into the cash box).
--   * Kinds of rows that have no currency yet — wages, card charges and
--     transfers between accounts — can't go on a US$ or C$ account
--     (transfers get their two currencies in step 5).
--   * An account's currency can't change once it has rows in another one.
--
-- NOTHING CHANGES FOR EXISTING ROWS: they are all shekels, the new columns'
-- defaults; no row is rewritten, so no audit rows and no safety copy. No
-- account changes currency here (Chase becomes US$ in step 8, with its rows).
--
-- Idempotent; safe to re-run.
-- Rollback: supabase/rollbacks/20261023120000_money_currency.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── Accounts ─────────────────────────────────────────────────────────────────
alter table public.accounts add column if not exists currency text not null default 'ILS';
alter table public.accounts drop constraint if exists accounts_currency_check;
alter table public.accounts add constraint accounts_currency_check check (currency in ('ILS', 'USD', 'CAD'));

-- ── The money rows ───────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['payments', 'expenses', 'loans', 'loan_repayments'] loop
    execute format(
      'alter table public.%I
         add column if not exists currency text not null default ''ILS'',
         add column if not exists foreign_amount numeric(14, 2),
         add column if not exists fx_rate numeric(12, 6),
         add column if not exists fx_rate_manual boolean not null default false', t);
    -- Shekels carry no foreign amount or rate; US$ and C$ always carry both.
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_currency_check');
    execute format(
      'alter table public.%I add constraint %I check (
         (currency = ''ILS'' and foreign_amount is null and fx_rate is null)
         or (currency in (''USD'', ''CAD'') and foreign_amount is not null and fx_rate > 0))',
      t, t || '_currency_check');
  end loop;
end $$;

-- ── A row's shekel amount, from its currency (see THE DATABASE KEEPS THEM IN
--    STEP above). SECURITY DEFINER so a row's account is read whatever the
--    writer may see; a trigger function can't be called on its own. ─────────
create or replace function public.fx_fill_amounts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  amount_col text;
  day_col text;
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  cur text := upper(coalesce(new.currency, 'ILS'));
  shekels numeric;
  day_text text;
  old_day_text text;
  day date;
  old_day date;
  reprice boolean := false;
  account_cur text;
  account_name text;
begin
  case tg_table_name
    when 'payments' then amount_col := 'amount_total'; day_col := 'payment_date';
    when 'expenses' then amount_col := 'amount'; day_col := 'expense_date';
    when 'loans' then amount_col := 'amount'; day_col := 'loan_date';
    when 'loan_repayments' then amount_col := 'amount'; day_col := 'repayment_date';
    else raise exception 'fx_fill_amounts() has no columns for %', tg_table_name;
  end case;

  new.currency := cur;

  if cur = 'ILS' then
    new.foreign_amount := null;
    new.fx_rate := null;
    new.fx_rate_manual := false;
  else
    shekels := (n ->> amount_col)::numeric;
    -- The row's day, by Israel's calendar (payment_date and expense_date are
    -- timestamps; the loans' are plain dates).
    day_text := n ->> day_col;
    day := case
      when day_text is null then (now() at time zone 'Asia/Jerusalem')::date
      when length(day_text) > 10 then (day_text::timestamptz at time zone 'Asia/Jerusalem')::date
      else day_text::date
    end;
    old_day_text := o ->> day_col;
    old_day := case
      when old_day_text is null then null
      when length(old_day_text) > 10 then (old_day_text::timestamptz at time zone 'Asia/Jerusalem')::date
      else old_day_text::date
    end;

    if tg_op = 'UPDATE'
       and cur = old.currency
       and new.foreign_amount is not distinct from old.foreign_amount
       and new.fx_rate is not distinct from old.fx_rate then
      -- The currency fields weren't touched: a screen or route that knows
      -- only shekels.
      if shekels is distinct from (o ->> amount_col)::numeric then
        -- It changed the shekel amount (a split, an edit): the row keeps its
        -- rate, and the foreign amount follows.
        new.foreign_amount := round(shekels / new.fx_rate, 2);
        reprice := false;
      else
        -- It moved the row to another day: that day's rate, unless the
        -- rate was typed by hand.
        reprice := day is distinct from old_day and not coalesce(new.fx_rate_manual, false);
        if reprice then
          new.fx_rate := null;
        end if;
      end if;
    else
      -- A new row, or one whose currency, foreign amount or rate was set.
      if new.foreign_amount is null then
        raise exception using errcode = '23514',
          message = format('חסר הסכום ב%s', case cur when 'USD' then 'דולרים' else 'דולרים קנדיים' end);
      end if;
      -- Moved to another day, or another currency, with its rate left as it
      -- was: that day's rate — unless the rate was typed by hand.
      if tg_op = 'UPDATE'
         and not coalesce(new.fx_rate_manual, false)
         and new.fx_rate is not distinct from old.fx_rate
         and (cur is distinct from old.currency or day is distinct from old_day) then
        new.fx_rate := null;
      end if;
      reprice := true;
    end if;

    if reprice then
      if new.fx_rate is null then
        new.fx_rate := public.fx_rate_on(cur, day);
        new.fx_rate_manual := false;
        if new.fx_rate is null then
          raise exception using errcode = '23514',
            message = format('אין שער יציג ל-%s ליום %s — יש להקליד את השער', cur, to_char(day, 'DD/MM/YYYY'));
        end if;
      end if;
      new := jsonb_populate_record(new, jsonb_build_object(amount_col, round(new.foreign_amount * new.fx_rate, 2)));
    end if;
  end if;

  -- A US$ or C$ account holds only its own currency.
  if new.account_id is not null
     and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id or cur is distinct from old.currency) then
    select a.currency, a.name into account_cur, account_name from public.accounts a where a.id = new.account_id;
    if account_cur is not null and account_cur <> 'ILS' and account_cur <> cur then
      raise exception using errcode = '23514',
        message = format('החשבון "%s" מתנהל ב%s — גם הסכום צריך להיות ב%s',
          account_name,
          case account_cur when 'USD' then 'דולרים' else 'דולרים קנדיים' end,
          case account_cur when 'USD' then 'דולרים' else 'דולרים קנדיים' end);
    end if;
  end if;

  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['payments', 'expenses', 'loans', 'loan_repayments'] loop
    execute format('drop trigger if exists trg_fx_amounts on public.%I', t);
    execute format(
      'create trigger trg_fx_amounts before insert or update on public.%I
         for each row execute function public.fx_fill_amounts()', t);
  end loop;
end $$;

-- ── Rows with no currency yet stay off US$ and C$ accounts ───────────────────
create or replace function public.fx_guard_shekel_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  col text;
  account_cur text;
  account_name text;
begin
  foreach col in array array['account_id', 'from_account_id', 'to_account_id'] loop
    continue when not (n ? col) or n ->> col is null;
    continue when tg_op = 'UPDATE' and (n ->> col) is not distinct from (o ->> col);
    select a.currency, a.name into account_cur, account_name from public.accounts a where a.id = (n ->> col)::uuid;
    if account_cur is not null and account_cur <> 'ILS' then
      raise exception using errcode = '23514',
        message = format('החשבון "%s" מתנהל ב%s — אי אפשר עדיין לרשום אליו את זה',
          account_name, case account_cur when 'USD' then 'דולרים' else 'דולרים קנדיים' end);
    end if;
  end loop;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['worker_payments', 'card_statement_charges', 'account_transfers'] loop
    execute format('drop trigger if exists trg_fx_shekel_only on public.%I', t);
    execute format(
      'create trigger trg_fx_shekel_only before insert or update on public.%I
         for each row execute function public.fx_guard_shekel_only()', t);
  end loop;
end $$;

-- ── An account's currency stays put once it has rows in another ──────────────
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
    or (new.currency <> 'ILS' and (
         exists (select 1 from public.worker_payments where account_id = new.id)
      or exists (select 1 from public.card_statement_charges where account_id = new.id)
      or exists (select 1 from public.account_transfers where from_account_id = new.id or to_account_id = new.id)))
  ) then
    raise exception using errcode = '23514',
      message = format('אי אפשר לשנות את המטבע של "%s": יש בו כבר תנועות במטבע אחר', new.name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fx_account_currency on public.accounts;
create trigger trg_fx_account_currency before insert or update of currency on public.accounts
  for each row execute function public.fx_guard_account_currency();
