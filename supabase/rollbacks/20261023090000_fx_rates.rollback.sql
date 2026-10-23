-- Rollback for 20261023090000_fx_rates.sql.
-- Removes the exchange rates and their lookup. Safe only while no money row
-- has a currency yet (the next step's migration uses fx_rate_on). The rates
-- themselves can always be loaded again from the Bank of Israel — the daily
-- job reloads the whole history into an empty table.

drop function if exists public.fx_rate_on(text, date);
drop table if exists public.fx_rates;
