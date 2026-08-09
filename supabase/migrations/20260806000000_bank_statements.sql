-- ════════════════════════════════════════════════════════════════════════════
-- דפי עובר ושב (bank statements) — the raw statement as the BANK sees it, kept
-- next to the account it belongs to so the two can be compared line by line.
--
-- WHY A SEPARATE TABLE AND NOT JUST MORE LEDGER ROWS: these rows are not our
-- money records — they are the bank's. They never enter the balance, the P&L or
-- the cash-flow report (lib/financial and lib/accounts both ignore them). They
-- exist only to answer "what does the bank have that we don't, and the other way
-- round", and to be the starting point for creating the missing entries.
--
-- A row's life: imported (unmatched) → matched to one or more ledger entries
-- (automatically or by hand), or turned INTO an entry (expense / income /
-- transfer, which then becomes its match), or marked ignored (bank fee we choose
-- not to record, an internal line, a duplicate).
--
-- Idempotent / safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  file_name text not null default '',
  -- 'excel' | 'pdf' | 'paste' — how the rows got here.
  source text not null default 'excel',
  document_id uuid null references public.documents(id) on delete set null,
  storage_key text null,
  period_start date null,
  period_end date null,
  -- The bank's own closing balance for the period, when the file states it.
  -- This is what the account's computed balance is measured against.
  closing_balance numeric null,
  total_rows integer not null default 0,
  notes text null,
  imported_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_statement_rows (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.bank_statements(id) on delete cascade,
  -- Denormalized so "has this line already been imported?" can be asked across
  -- every statement of an account without joining.
  account_id uuid not null references public.accounts(id) on delete cascade,
  row_index integer not null default 0,
  txn_date date not null,
  value_date date null,
  description text not null default '',
  reference text null,                      -- אסמכתא
  -- Signed: positive = money INTO the account (זכות), negative = OUT (חובה).
  amount numeric not null,
  balance numeric null,                     -- the bank's running balance on this line
  -- 'unmatched' | 'matched' | 'ignored'
  status text not null default 'unmatched',
  -- Composite ledger ids from lib/accounts.ts ("p:<uuid>", "e:<uuid>", "w:<uuid>",
  -- "l:<uuid>", "lr:<uuid>", "t:<uuid>:out"). An array because one bank line can
  -- be several of our entries (a deposit of three checks) — the match holds when
  -- their sum equals the line.
  matched_ledger_ids text[] not null default '{}',
  -- 'auto' when the matcher paired it, 'manual' when a person did, 'created' when
  -- the entry was created from this very row.
  match_source text null,
  -- Dedup fingerprint (date + amount + reference/description), see lib/financial/bankStatement.ts.
  fingerprint text not null default '',
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bank_statements_account_idx on public.bank_statements (account_id, created_at desc);
create index if not exists bank_statement_rows_statement_idx on public.bank_statement_rows (statement_id, row_index);
create index if not exists bank_statement_rows_account_idx on public.bank_statement_rows (account_id, txn_date);
create index if not exists bank_statement_rows_fingerprint_idx on public.bank_statement_rows (account_id, fingerprint);

alter table public.bank_statements enable row level security;
alter table public.bank_statement_rows enable row level security;

-- Same gate as accounts / account_transfers: admin+office with system access.
drop policy if exists "Staff manage bank statements" on public.bank_statements;
create policy "Staff manage bank statements"
on public.bank_statements
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office')
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office')
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
);

drop policy if exists "Staff manage bank statement rows" on public.bank_statement_rows;
create policy "Staff manage bank statement rows"
on public.bank_statement_rows
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office')
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office')
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
);

grant select, insert, update, delete on public.bank_statements to authenticated;
grant select, insert, update, delete on public.bank_statement_rows to authenticated;

-- No audit trigger here on purpose: an import writes hundreds of rows at once and
-- every match flips a status. That is import bookkeeping, not business history —
-- the activity feed stays about the expenses/payments the rows produce, which are
-- audited on their own tables.
