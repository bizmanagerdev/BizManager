-- Rollback for 20261013120000_card_statement_rows_bill_to_customer.sql.
-- Drops the draft "לחיוב לקוח" choice from statement lines. Lines already turned
-- into expenses keep their billing on project_expenses.billed_to_customer.
-- The app reads the column apart and hides the tick when it is missing.

alter table public.card_statement_rows
  drop column if exists bill_to_customer;
