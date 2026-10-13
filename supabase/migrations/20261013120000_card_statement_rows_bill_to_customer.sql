-- ════════════════════════════════════════════════════════════════════════════
-- "לחיוב לקוח" on a credit-card statement line.
--
-- A card purchase made for a project can be billed to that project's customer —
-- the same rule the expense form already has: project_expenses.billed_to_customer
-- adds the expense to what the customer owes (project_financials_view →
-- billed_expense_amounts → customer_total_price).
--
-- A statement line only becomes an expense when "צור הוצאות" runs, so the choice
-- made before that has to wait somewhere: on the line. create-expenses copies it
-- into project_expenses.billed_to_customer; for a line that already has its
-- expense, the update route writes project_expenses directly and mirrors it here.
-- Only meaningful on a line with a project (owner, 2026-10-13: "billing the
-- customer is only for projects").
--
-- Default false: every existing line keeps meaning what it meant. Idempotent.
-- Rollback: supabase/rollbacks/20261013120000_card_statement_rows_bill_to_customer.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

alter table public.card_statement_rows
  add column if not exists bill_to_customer boolean not null default false;
