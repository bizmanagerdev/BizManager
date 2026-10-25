-- Rollback for 20261025100000_worker_payment_currency.sql.
--
-- A worker payment in US$ / C$ keeps its shekels (`amount`, which is what it
-- took off the worker's debt) but loses its dollars — save them first:
--   create table backup.worker_payments_currency_<yyyymmdd_hhmm> as
--     select id, user_id, payment_date, amount, currency, foreign_amount, fx_rate, fx_rate_manual, account_id
--     from public.worker_payments where currency <> 'ILS';
-- A payment out of an account kept in dollars is refused again once the
-- shekel-only guard is back: move such payments (or the account) first.

-- 4. the search, back to shekels only for worker payments.
do $mig$
declare
  v_def text := replace(pg_get_functiondef('public.global_search(jsonb,text,text[],integer)'::regprocedure), E'\r\n', E'\n');
  v_new_info text := $t$jsonb_build_object('amount', wp.amount, 'currency', wp.currency, 'foreign_amount', wp.foreign_amount, 'method', wp.payment_method, 'date', wp.payment_date, 'user_id', wp.user_id),$t$;
  v_old_info text := $t$jsonb_build_object('amount', wp.amount, 'method', wp.payment_method, 'date', wp.payment_date, 'user_id', wp.user_id),$t$;
  v_new_cols text := $t$    null, null, null, '{}', '{}',
    case when wp.currency = 'USD' and wp.foreign_amount is not null then array['סכום'] else '{}'::text[] end,
    case when wp.currency = 'USD' and wp.foreign_amount is not null then array[wp.foreign_amount] else '{}'::numeric[] end,
    case when wp.currency = 'CAD' and wp.foreign_amount is not null then array['סכום'] else '{}'::text[] end,
    case when wp.currency = 'CAD' and wp.foreign_amount is not null then array[wp.foreign_amount] else '{}'::numeric[] end
  from worker_payments wp left join users u on u.id = wp.user_id$t$;
  v_old_cols text := $t$    null, null, null, '{}', '{}',
    '{}', '{}', '{}', '{}'
  from worker_payments wp left join users u on u.id = wp.user_id$t$;
begin
  execute replace(replace(v_def, v_new_info, v_old_info), v_new_cols, v_old_cols);
end
$mig$;

-- 3. the account guard as it was (20261023150000_transfer_currencies.sql).
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

-- 2. the shekel-only guard back on worker_payments; fx_fill_amounts without it.
drop trigger if exists trg_fx_amounts on public.worker_payments;
drop trigger if exists trg_fx_shekel_only on public.worker_payments;
create trigger trg_fx_shekel_only before insert or update on public.worker_payments
  for each row execute function public.fx_guard_shekel_only();

do $mig$
declare
  v_def text := replace(pg_get_functiondef('public.fx_fill_amounts()'::regprocedure), E'\r\n', E'\n');
begin
  execute replace(v_def, $t$    when 'worker_payments' then amount_col := 'amount'; day_col := 'payment_date';
$t$, '');
end
$mig$;

-- 1. the columns.
comment on column public.worker_payments.amount is null;
alter table public.worker_payments drop constraint if exists worker_payments_currency_check;
alter table public.worker_payments
  drop column if exists fx_rate_manual,
  drop column if exists fx_rate,
  drop column if exists foreign_amount,
  drop column if exists currency;
