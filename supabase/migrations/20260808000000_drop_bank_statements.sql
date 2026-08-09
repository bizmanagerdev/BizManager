-- ════════════════════════════════════════════════════════════════════════════
-- Drop the bank-statement import tables.
--
-- The statement-comparison screen was removed (it was more machinery than the
-- job needed — the register is read next to the bank's own site instead), and
-- these two tables only ever held the IMPORTED COPY of a bank page plus which
-- line was matched to what.
--
-- NOTHING OF VALUE IS LOST: the expenses, incomes and transfers that were
-- created from those lines are ordinary rows in `expenses` / `payments` /
-- `account_transfers`. They never referenced these tables — the link was a text
-- array here pointing OUT at them, never a foreign key pointing in — so they
-- keep their amounts, dates, accounts, domains and audit history exactly as they
-- are.
--
-- The uploaded files themselves are deliberately NOT touched: they still exist
-- as `documents` rows (document_type = 'bank_statement') and as objects in
-- storage, so they can be reviewed and deleted from the מסמכים screen, which
-- removes the stored file too. Deleting the rows here would strand the files.
--
-- Idempotent / safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

drop table if exists public.bank_statement_rows;
drop table if exists public.bank_statements;
