-- ════════════════════════════════════════════════════════════════════════════
-- US credit cards, each its own account (owner, 2026-10-25: "Yes — each US
-- card its own account, payments to it as transfers"). Chase Sapphire 9066 and
-- Capital One Venture X 9738 are "card" accounts in US$; their statements are
-- uploaded like the Israeli ones, but:
--
--   * a purchase, fee or interest line becomes an expense ON the card's account
--     (in dollars), so the card's page is its statement and its balance is
--     what we owe it;
--   * a payment line ("Payment Thank You", "CAPITAL ONE MOBILE PYMT") is the
--     transfer from Chase or Capital One into the card — linked, never an
--     expense, never income;
--   * a cash advance is a transfer from the card into the cash box;
--   * there is no lump "חיוב כרטיס" on a bank (card_statement_charges stays
--     for the Israeli cards only, in shekels).
--
-- WHAT IT ADDS
--   card_statements
--     card_account_id   the card account the statement belongs to — empty for
--                       every Israeli statement (they stay exactly as they are)
--     currency          the statement's own currency: 'ILS' for every statement
--                       today, 'USD' for a US card's. Its lines' amounts are in it.
--     period_start/_end, payment_due_date, previous_balance, new_balance
--                       the statement's own numbers, as printed — so the page
--                       can check that its lines add up, and that the card's
--                       balance on the closing day is the statement's.
--   card_statement_rows
--     line_kind         'charge' (a purchase, fee or interest — or, negative, a
--                       refund: every line today), 'payment' (paying the card)
--                       or 'cash_advance' (cash taken on the card)
--     transfer_id       the transfer a payment / cash line is (one line per
--                       transfer). Deleting the transfer frees the line; deleting
--                       the statement never deletes a transfer — the Chase side
--                       of a payment is the bank's own record.
--                       Deliberately NOT a foreign key: account_transfers
--                       already points at card_statement_rows ("מול מזומן",
--                       card_statement_row_id), and a second link between the
--                       two tables would make the app's existing
--                       `account_transfers(...)` / `card_statement_rows(...)`
--                       look-ups ambiguous — the statement pages and the
--                       accounts page's transfers would stop loading. A trigger
--                       frees the line when its transfer is deleted instead.
--
-- NOTHING CHANGES FOR EXISTING ROWS: the new columns' defaults are what every
-- statement and line is today (ILS, 'charge', no card account, no transfer). No
-- row is rewritten, so no audit rows and no safety copy. Idempotent.
-- Rollback: supabase/rollbacks/20261025140000_us_card_statements.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

alter table public.card_statements
  add column if not exists card_account_id uuid null
    references public.accounts(id) on delete set null,
  add column if not exists currency text not null default 'ILS',
  add column if not exists period_start date null,
  add column if not exists period_end date null,
  add column if not exists payment_due_date date null,
  add column if not exists previous_balance numeric(14, 2) null,
  add column if not exists new_balance numeric(14, 2) null;

alter table public.card_statements drop constraint if exists card_statements_currency_check;
alter table public.card_statements add constraint card_statements_currency_check
  check (currency in ('ILS', 'USD', 'CAD'));

create index if not exists card_statements_card_account_idx
  on public.card_statements (card_account_id)
  where card_account_id is not null;

alter table public.card_statement_rows
  add column if not exists line_kind text not null default 'charge',
  add column if not exists transfer_id uuid null;

alter table public.card_statement_rows drop constraint if exists card_statement_rows_line_kind_check;
alter table public.card_statement_rows add constraint card_statement_rows_line_kind_check
  check (line_kind in ('charge', 'payment', 'cash_advance'));

create unique index if not exists card_statement_rows_transfer_idx
  on public.card_statement_rows (transfer_id)
  where transfer_id is not null;

-- A transfer deleted (on the accounts page, or by undoing it on the statement)
-- frees the line it was — the job a foreign key's "on delete set null" would do.
create or replace function public.card_statement_rows_free_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.card_statement_rows set transfer_id = null where transfer_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_card_statement_rows_free_transfer on public.account_transfers;
create trigger trg_card_statement_rows_free_transfer
  after delete on public.account_transfers
  for each row execute function public.card_statement_rows_free_transfer();

-- A statement kept on a card account is in that account's currency, and the
-- account is a card. Checked here so no screen or route can save it otherwise.
create or replace function public.card_statement_account_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acc_kind text;
  acc_cur text;
  acc_name text;
begin
  new.currency := upper(coalesce(new.currency, 'ILS'));
  if new.card_account_id is null then
    return new;
  end if;
  select a.kind, a.currency, a.name into acc_kind, acc_cur, acc_name
    from public.accounts a where a.id = new.card_account_id;
  if acc_kind is distinct from 'card' then
    raise exception using errcode = '23514',
      message = format('"%s" אינו חשבון כרטיס אשראי', coalesce(acc_name, '?'));
  end if;
  if acc_cur is distinct from new.currency then
    raise exception using errcode = '23514',
      message = format('החשבון "%s" מתנהל ב-%s — גם הפירוט צריך להיות בו', acc_name, acc_cur);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_card_statement_account_guard on public.card_statements;
create trigger trg_card_statement_account_guard
  before insert or update of card_account_id, currency on public.card_statements
  for each row execute function public.card_statement_account_guard();
