-- Add paid_amount and payment_method columns to expenses table.
-- paid_amount: tracks how much was actually paid (relevant for partial payments)
-- payment_method: bank_transfer / cash / check / credit_card / other

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS paid_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS payment_method text;
