-- ════════════════════════════════════════════════════════════════════════════
-- A worker payment in US$ or C$ (owner, 2026-10-25: "let's say one month he
-- makes a worker payment in dollars? it needs to reduce that amount of shekel
-- from the worker's owed amount"):
--
-- 1. worker_payments gets the four currency columns the other money rows have
--    (20261023120001_money_currency.sql): currency, foreign_amount, fx_rate,
--    fx_rate_manual. Every payment stays ₪ — constant defaults are only
--    written to the catalog, no row is rewritten.
-- 2. Its `amount` stays the shekels — what its allocations take off what the
--    worker is owed (worker_debt_items_view is unchanged). For a payment in
--    US$ / C$ the pricing trigger (fx_fill_amounts) works them out:
--    foreign_amount × the Bank of Israel rate of payment_date, or the rate
--    typed. It replaces the shekel-only guard on the table, so a payment can
--    come out of an account kept in dollars — in that account's currency.
-- 3. An account keeps its currency once it holds worker payments in another
--    (fx_guard_account_currency), as with the other money rows.
-- 4. The search finds a payment by its dollars, and shows them
--    (global_search, patched in place).
--
-- ROLLBACK: supabase/rollbacks/20261025100000_worker_payment_currency.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. the columns ──────────────────────────────────────────────────────────
alter table public.worker_payments
  add column if not exists currency text not null default 'ILS',
  add column if not exists foreign_amount numeric(14, 2),
  add column if not exists fx_rate numeric(12, 6),
  add column if not exists fx_rate_manual boolean not null default false;

-- Shekels carry no foreign amount or rate; US$ and C$ always carry both.
alter table public.worker_payments drop constraint if exists worker_payments_currency_check;
alter table public.worker_payments add constraint worker_payments_currency_check check (
  (currency = 'ILS' and foreign_amount is null and fx_rate is null)
  or (currency in ('USD', 'CAD') and foreign_amount is not null and fx_rate > 0));

comment on column public.worker_payments.amount is
  'The payment in shekels — for one in US$ / C$, foreign_amount × fx_rate. What its allocations take off what the worker is owed.';
comment on column public.worker_payments.currency is
  'ILS | USD | CAD — the currency it was paid in.';

-- ── 2. priced like the other money rows ─────────────────────────────────────
-- In place: one more table in fx_fill_amounts' list; nothing else moves.
do $mig$
declare
  v_def text := replace(pg_get_functiondef('public.fx_fill_amounts()'::regprocedure), E'\r\n', E'\n');
  v_old text := $t$    when 'loan_repayments' then amount_col := 'amount'; day_col := 'repayment_date';
$t$;
  v_new text := $t$    when 'loan_repayments' then amount_col := 'amount'; day_col := 'repayment_date';
    when 'worker_payments' then amount_col := 'amount'; day_col := 'payment_date';
$t$;
begin
  if position($t$when 'worker_payments'$t$ in v_def) > 0 then
    return; -- already there
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'fx_fill_amounts: the loan_repayments line is not there once';
  end if;
  execute replace(v_def, v_old, v_new);
end
$mig$;

drop trigger if exists trg_fx_shekel_only on public.worker_payments;
drop trigger if exists trg_fx_amounts on public.worker_payments;
create trigger trg_fx_amounts before insert or update on public.worker_payments
  for each row execute function public.fx_fill_amounts();

-- ── 3. an account's currency stays put once it has rows in another ──────────
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
    or exists (select 1 from public.worker_payments where account_id = new.id and currency <> new.currency)
    or exists (select 1 from public.account_transfers where from_account_id = new.id or to_account_id = new.id)
    or (new.currency <> 'ILS' and
         exists (select 1 from public.card_statement_charges where account_id = new.id))
  ) then
    raise exception using errcode = '23514',
      message = format('אי אפשר לשנות את המטבע של "%s": יש בו כבר תנועות במטבע אחר', new.name);
  end if;
  return new;
end;
$$;

-- ── 4. the search: a payment's dollars ──────────────────────────────────────
-- In place: the worker payments' part of global_search carries its currency
-- and foreign amount (shown on the result), and its dollar / C$ amount in the
-- columns a typed "$1,000" / "1000 קנדי" matches — as the payments' part does.
do $mig$
declare
  v_def text := replace(pg_get_functiondef('public.global_search(jsonb,text,text[],integer)'::regprocedure), E'\r\n', E'\n');
  v_old_info text := $t$jsonb_build_object('amount', wp.amount, 'method', wp.payment_method, 'date', wp.payment_date, 'user_id', wp.user_id),$t$;
  v_new_info text := $t$jsonb_build_object('amount', wp.amount, 'currency', wp.currency, 'foreign_amount', wp.foreign_amount, 'method', wp.payment_method, 'date', wp.payment_date, 'user_id', wp.user_id),$t$;
  v_old_cols text := $t$    null, null, null, '{}', '{}',
    '{}', '{}', '{}', '{}'
  from worker_payments wp left join users u on u.id = wp.user_id$t$;
  v_new_cols text := $t$    null, null, null, '{}', '{}',
    case when wp.currency = 'USD' and wp.foreign_amount is not null then array['סכום'] else '{}'::text[] end,
    case when wp.currency = 'USD' and wp.foreign_amount is not null then array[wp.foreign_amount] else '{}'::numeric[] end,
    case when wp.currency = 'CAD' and wp.foreign_amount is not null then array['סכום'] else '{}'::text[] end,
    case when wp.currency = 'CAD' and wp.foreign_amount is not null then array[wp.foreign_amount] else '{}'::numeric[] end
  from worker_payments wp left join users u on u.id = wp.user_id$t$;
begin
  if (length(v_def) - length(replace(v_def, v_old_info, ''))) / length(v_old_info) <> 1 then
    raise exception 'global_search: the worker payments'' details are not there once';
  end if;
  if (length(v_def) - length(replace(v_def, v_old_cols, ''))) / length(v_old_cols) <> 1 then
    raise exception 'global_search: the worker payments'' currency columns are not there once';
  end if;
  execute replace(replace(v_def, v_old_info, v_new_info), v_old_cols, v_new_cols);
end
$mig$;
