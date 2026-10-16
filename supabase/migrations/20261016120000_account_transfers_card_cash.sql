-- ════════════════════════════════════════════════════════════════════════════
-- "מול מזומן" — a credit-card line swiped for someone who paid us cash.
--
-- The bank takes the line inside the card's one-line charge, so the money did
-- leave the bank; the cash the person handed over went into the cash box. That
-- is a move between our own accounts (owner, 2026-10-15: "the same as a regular
-- transfer between accounts that we have today"), recorded in account_transfers
-- like any other transfer — never an expense or an income, never in the P&L.
--
-- One difference from a typed transfer: its OUT side is already on the books,
-- inside the card's bank charge (card_statement_charges). A second OUT leg on the
-- bank would take the same shekels off twice. So a transfer made from a statement
-- line has no from_account_id — lib/accounts.ts then writes only its IN leg — and
-- card_statement_row_id says which line it came from (one transfer per line).
-- A typed transfer still needs both accounts: a transfer with no "from" must come
-- from a statement line.
--
-- Deleting the line (or its whole statement) deletes its cash entry with it.
-- Existing transfers are untouched. Idempotent.
-- Rollback: supabase/rollbacks/20261016120000_account_transfers_card_cash.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

alter table public.account_transfers
  alter column from_account_id drop not null;

alter table public.account_transfers
  add column if not exists card_statement_row_id uuid null
    references public.card_statement_rows(id) on delete cascade;

create unique index if not exists account_transfers_card_statement_row_idx
  on public.account_transfers (card_statement_row_id)
  where card_statement_row_id is not null;

alter table public.account_transfers
  drop constraint if exists account_transfers_from_or_card_line;
alter table public.account_transfers
  add constraint account_transfers_from_or_card_line
    check (from_account_id is not null or card_statement_row_id is not null);
