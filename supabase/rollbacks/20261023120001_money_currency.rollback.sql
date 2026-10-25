-- Rollback for 20261023120001_money_currency.sql.
-- Takes the currency off accounts and money rows, with the triggers that keep
-- it in step. While every row is still in shekels (as the migration left them)
-- nothing is lost: the shekel amounts were always the real columns.
--
-- Once rows in US$ or C$ exist, their foreign amount and rate would be lost —
-- save them first:
--   create table backup.money_currency_<yyyymmdd_hhmm> as
--     select 'payments' as source, id, currency, foreign_amount, fx_rate, fx_rate_manual from public.payments where currency <> 'ILS'
--     union all select 'expenses', id, currency, foreign_amount, fx_rate, fx_rate_manual from public.expenses where currency <> 'ILS'
--     union all select 'loans', id, currency, foreign_amount, fx_rate, fx_rate_manual from public.loans where currency <> 'ILS'
--     union all select 'loan_repayments', id, currency, foreign_amount, fx_rate, fx_rate_manual from public.loan_repayments where currency <> 'ILS';
--   create table backup.accounts_currency_<yyyymmdd_hhmm> as
--     select id, name, currency, opening_balance from public.accounts where currency <> 'ILS';
-- (an account in US$ or C$ also has its opening balance in that currency.)

drop trigger if exists trg_fx_account_currency on public.accounts;
drop function if exists public.fx_guard_account_currency();

do $$
declare
  t text;
begin
  foreach t in array array['worker_payments', 'card_statement_charges', 'account_transfers'] loop
    execute format('drop trigger if exists trg_fx_shekel_only on public.%I', t);
  end loop;
  foreach t in array array['payments', 'expenses', 'loans', 'loan_repayments'] loop
    execute format('drop trigger if exists trg_fx_amounts on public.%I', t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_currency_check');
    execute format(
      'alter table public.%I
         drop column if exists currency,
         drop column if exists foreign_amount,
         drop column if exists fx_rate,
         drop column if exists fx_rate_manual', t);
  end loop;
end $$;

drop function if exists public.fx_guard_shekel_only();
drop function if exists public.fx_fill_amounts();

alter table public.accounts drop constraint if exists accounts_currency_check;
alter table public.accounts drop column if exists currency;
