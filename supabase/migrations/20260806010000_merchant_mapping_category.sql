-- ════════════════════════════════════════════════════════════════════════════
-- Merchant memory learns the CATEGORY too.
--
-- expense_merchant_mappings already remembers which תחום / project a merchant
-- was filed under during a credit-card import. The bank-statement screen needs
-- one more field: an expense can't be created without a קטגוריה, so without it
-- every remembered line still asks the same question again.
--
-- Nullable on purpose — the card importer never sets it (there the category is
-- the card label), and old rows stay valid.
--
-- Idempotent / safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.expense_merchant_mappings
  add column if not exists category text null;
