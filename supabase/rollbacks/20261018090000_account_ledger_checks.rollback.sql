-- Rollback for 20261018090000_account_ledger_checks.sql.
-- Removes the "נבדק מול הבנק" ticks. Nothing else depends on them: balances and
-- the register are unchanged without the table (the page shows every line as
-- not checked). Before running, save the ticks:
--   create table backup.account_ledger_checks_<yyyymmdd_hhmm> as
--     select * from public.account_ledger_checks;

drop table if exists public.account_ledger_checks;
