-- ════════════════════════════════════════════════════════════════════════════
-- The bank's own number for an account ("594-249395"), shown on its card on the
-- חשבונות page and set in ניהול חשבונות (owner, 2026-10-18: "to the summary
-- card I also want to add the account number"). Free text: banks write it
-- differently (branch-account, with or without the bank code) and a cash box
-- has none. Display only — nothing matches or computes on it.
--
-- account_picker_options() is not changed: the pickers don't show it.
-- Idempotent; safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.accounts add column if not exists account_number text;
