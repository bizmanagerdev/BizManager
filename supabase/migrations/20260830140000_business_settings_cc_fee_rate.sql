-- ════════════════════════════════════════════════════════════════════════════
-- Credit-card processor (e.g. Grow) fee rate — an editable business setting,
-- same singleton pattern as business_settings.vat_rate. The account ledger
-- (lib/accounts.ts) nets this rate out of a Grow-settled payment batch so
-- the amount posted matches what actually lands in the bank, not the gross
-- amount the customer paid.
--
-- Idempotent / safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.business_settings
  add column if not exists cc_fee_rate numeric not null default 0.14;
