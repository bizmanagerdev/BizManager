-- Run this in the Supabase SQL Editor.
-- Allow "general" sales that aren't tied to a specific order. A check constraint forced every
-- business_domain='sales' expense to carry an order_id (expenses_sales_requires_order_chk),
-- which blocked recording a general sales expense — e.g. assigning a credit-card statement row
-- to מכירות without a specific order failed with:
--   new row for relation "expenses" violates check constraint "expenses_sales_requires_order_chk"
-- Dropping it lets sales expenses (and payments) exist without an order.

alter table public.expenses
  drop constraint if exists expenses_sales_requires_order_chk;

-- Mirror for payments in case the same rule exists there (no-op if absent / named differently).
alter table public.payments
  drop constraint if exists payments_sales_requires_order_chk;
