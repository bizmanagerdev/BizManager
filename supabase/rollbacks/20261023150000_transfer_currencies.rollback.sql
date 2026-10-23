-- Rollback for 20261023150000_transfer_currencies.sql.
-- Takes the two sides' amounts off transfers and puts back step 2's rules:
-- no transfer to or from a US$ or C$ account, and the account-currency guard
-- as it was. While every transfer is between shekel accounts nothing is lost.
--
-- Once a transfer touches a dollar account, its dollars would be lost — save
-- them first, and move or delete such transfers before restoring the guard
-- (it refuses them):
--   create table backup.account_transfers_sides_<yyyymmdd_hhmm> as
--     select id, from_account_id, to_account_id, amount, from_amount, to_amount, transfer_date
--     from public.account_transfers where from_amount is not null or to_amount is not null;

drop trigger if exists trg_fx_transfer on public.account_transfers;
drop function if exists public.fx_fill_transfer();

drop trigger if exists trg_fx_shekel_only on public.account_transfers;
create trigger trg_fx_shekel_only before insert or update on public.account_transfers
  for each row execute function public.fx_guard_shekel_only();

alter table public.account_transfers drop constraint if exists account_transfers_side_amounts_check;
alter table public.account_transfers
  drop column if exists from_amount,
  drop column if exists to_amount;

-- The account-currency guard as step 2 had it.
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
