-- ════════════════════════════════════════════════════════════════════════════
-- PowerSync: also follow the money tables the dashboard's money cards read —
-- loans and their repayments, card statement charges and the card statement
-- lines tied to an expense, card settlement confirmations and the payment
-- sources' settings — so the payments card, the collections card and the
-- income/expenses chart are worked out on the device like the rest of the
-- board. Read-only access for powersync_role; devices get them only through
-- powersync/sync-config.yaml (v1.8): admins and office only (the same people
-- these tables' RLS lets read them), workers never. Of the card statement
-- lines only the four columns that tie a line to an expense.
--
-- ROLLBACK: supabase/rollbacks/20261007210000_powersync_money_cards_tables.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

grant select on table
  public.loans,
  public.loan_repayments,
  public.card_statement_charges,
  public.card_statement_rows,
  public.card_settlement_confirmations,
  public.outflow_source_settings
to powersync_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'loans', 'loan_repayments', 'card_statement_charges', 'card_statement_rows',
    'card_settlement_confirmations', 'outflow_source_settings'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync add table public.%I', t);
    end if;
  end loop;
end $$;
