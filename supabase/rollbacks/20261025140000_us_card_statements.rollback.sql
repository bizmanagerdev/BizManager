-- Rollback for 20261025140000_us_card_statements.sql.
-- Takes the US-card statement columns back out. The expenses, incomes and
-- transfers made from US statements stay (they are ordinary rows on the card,
-- Chase and Capital One accounts); only the statements' own numbers and the
-- lines' kind and transfer link go. A US statement left behind then reads as a
-- shekel one — delete those statements first if any were uploaded.
-- Before running, save what it drops:
--   create table backup.card_statements_us_<yyyymmdd_hhmm> as
--     select * from public.card_statements where card_account_id is not null or currency <> 'ILS';
--   create table backup.card_statement_rows_us_<yyyymmdd_hhmm> as
--     select * from public.card_statement_rows where line_kind <> 'charge' or transfer_id is not null;

drop trigger if exists trg_card_statement_account_guard on public.card_statements;
drop function if exists public.card_statement_account_guard();

drop trigger if exists trg_card_statement_rows_free_transfer on public.account_transfers;
drop function if exists public.card_statement_rows_free_transfer();

drop index if exists public.card_statement_rows_transfer_idx;
alter table public.card_statement_rows drop constraint if exists card_statement_rows_line_kind_check;
alter table public.card_statement_rows
  drop column if exists transfer_id,
  drop column if exists line_kind;

drop index if exists public.card_statements_card_account_idx;
alter table public.card_statements drop constraint if exists card_statements_currency_check;
alter table public.card_statements
  drop column if exists new_balance,
  drop column if exists previous_balance,
  drop column if exists payment_due_date,
  drop column if exists period_end,
  drop column if exists period_start,
  drop column if exists currency,
  drop column if exists card_account_id;
