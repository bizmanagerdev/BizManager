-- Rollback for 20261018093000_accounts_account_number.sql.
-- Ship the app without account_number in lib/accounts.ts's ACCOUNT_COLUMNS
-- FIRST: loadAccounts treats a failed select as "no accounts", so dropping the
-- column under code that still selects it empties the whole חשבונות page.
-- Before running, save the numbers:
--   create table backup.accounts_account_number_<yyyymmdd_hhmm> as
--     select id, name, account_number from public.accounts;

alter table public.accounts drop column if exists account_number;
