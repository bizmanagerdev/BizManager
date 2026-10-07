-- ROLLBACK for supabase/migrations/20261007210000_powersync_money_cards_tables.sql

do $$
declare
  t text;
begin
  foreach t in array array[
    'loans', 'loan_repayments', 'card_statement_charges', 'card_statement_rows',
    'card_settlement_confirmations', 'outflow_source_settings'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync drop table public.%I', t);
    end if;
  end loop;
end $$;

revoke select on table
  public.loans,
  public.loan_repayments,
  public.card_statement_charges,
  public.card_statement_rows,
  public.card_settlement_confirmations,
  public.outflow_source_settings
from powersync_role;
