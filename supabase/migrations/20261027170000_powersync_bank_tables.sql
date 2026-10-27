-- ════════════════════════════════════════════════════════════════════════════
-- PowerSync: follow the tables behind the accounts page (/financial/bank) —
-- transfers between accounts, the "נבדק מול הבנק" ticks, the Bank of Israel
-- exchange rates and the quick line's remembered categories — so an admin's
-- device can draw the page itself and open it with no connection (owner,
-- 2026-10-27: "go with accounts to make the list device copy offline"; "yes to
-- all 3"). Read-only access for powersync_role; devices get these only through
-- powersync/sync-config.yaml (v1.14): the ticks to admins only, as their RLS
-- allows; the rest to admins and office, who read them in the app already.
-- accounts, card_statement_rows and card_statement_charges are already
-- followed (more of their columns go to devices in v1.14).
--
-- ROLLBACK: supabase/rollbacks/20261027170000_powersync_bank_tables.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

grant select on table
  public.account_transfers,
  public.account_ledger_checks,
  public.fx_rates,
  public.expense_merchant_mappings
to powersync_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'account_transfers', 'account_ledger_checks', 'fx_rates', 'expense_merchant_mappings'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync add table public.%I', t);
    end if;
  end loop;
end $$;
