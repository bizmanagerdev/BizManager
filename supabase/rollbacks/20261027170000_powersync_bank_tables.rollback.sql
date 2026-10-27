-- ROLLBACK for supabase/migrations/20261027170000_powersync_bank_tables.sql
-- Deploy sync rules without account_transfers / account_ledger_checks /
-- fx_rates / expense_merchant_mappings (v1.13) first.

do $$
declare
  t text;
begin
  foreach t in array array['account_transfers', 'account_ledger_checks', 'fx_rates', 'expense_merchant_mappings'] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync drop table public.%I', t);
    end if;
  end loop;
end $$;

revoke select on table
  public.account_transfers,
  public.account_ledger_checks,
  public.fx_rates,
  public.expense_merchant_mappings
from powersync_role;
