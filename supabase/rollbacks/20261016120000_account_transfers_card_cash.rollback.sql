-- Rollback for 20261016120000_account_transfers_card_cash.sql.
-- Takes "מול מזומן" back out: the cash entries made from statement lines are
-- deleted (they have no "from" account, which the NOT NULL below would refuse),
-- and their lines go back to waiting for שיוך. Typed transfers are untouched.
-- Before running, save what it deletes:
--   create table backup.account_transfers_card_cash_<yyyymmdd_hhmm> as
--     select * from public.account_transfers where card_statement_row_id is not null;

update public.card_statement_rows r
   set include = true
  from public.account_transfers t
 where t.card_statement_row_id = r.id
   and r.expense_id is null;

delete from public.account_transfers where card_statement_row_id is not null;

alter table public.account_transfers
  drop constraint if exists account_transfers_from_or_card_line;

drop index if exists public.account_transfers_card_statement_row_idx;

alter table public.account_transfers
  drop column if exists card_statement_row_id;

alter table public.account_transfers
  alter column from_account_id set not null;
