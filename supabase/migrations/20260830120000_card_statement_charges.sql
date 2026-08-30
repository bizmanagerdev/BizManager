-- ════════════════════════════════════════════════════════════════════════════
-- Credit-card statement → ONE lump charge on the bank account.
--
-- The statement's individual line items already become itemized `expenses`
-- rows (via /financial/statements "צור הוצאות") for domain/category reporting —
-- that is unchanged and still feeds P&L exactly as before. Those rows are
-- deliberately never assigned an account_id, so lib/accounts.ts's per-table
-- scans (which all `.not("account_id", "is", null)`) never pick them up.
--
-- What was missing: the REAL bank hit is one lump sum on the statement's
-- charge day, not N itemized lines. `card_statement_charges` is a ledger-only
-- record (read ONLY by lib/accounts.ts, mirroring account_transfers — never by
-- lib/financial) that adds exactly one outflow to the chosen account for a
-- statement's card. Idempotent / safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- Remembers which bank account a given card charges to, so the picker
-- pre-fills itself on the next month's statement. Keyed by normalized card
-- label (same normalize() the merchant-memory table already uses).
create table if not exists public.card_account_mappings (
  id uuid primary key default gen_random_uuid(),
  card_key text not null unique,        -- normalized card label (lib/financial/cardImport norm())
  card_label text not null,             -- last label seen, for display only
  account_id uuid not null references public.accounts(id) on delete cascade,
  updated_by uuid null references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- One row = one card's statement total charged to one account. A statement
-- with multiple cards gets one row per card (unique per statement+card).
create table if not exists public.card_statement_charges (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.card_statements(id) on delete cascade,
  card_label text not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  amount numeric not null check (amount > 0),
  charge_date date not null,
  notes text null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_statement_charges_unique_card unique (statement_id, card_label)
);

create index if not exists card_statement_charges_statement_idx on public.card_statement_charges (statement_id);
create index if not exists card_statement_charges_account_idx   on public.card_statement_charges (account_id);
create index if not exists card_statement_charges_date_idx      on public.card_statement_charges (charge_date);

alter table public.card_account_mappings enable row level security;
alter table public.card_statement_charges enable row level security;

-- Same gate as accounts / card_statements: admin/office with system access.
drop policy if exists "Staff manage card account mappings" on public.card_account_mappings;
create policy "Staff manage card account mappings"
on public.card_account_mappings
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

drop policy if exists "Staff manage card statement charges" on public.card_statement_charges;
create policy "Staff manage card statement charges"
on public.card_statement_charges
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

grant select, insert, update, delete on public.card_account_mappings to authenticated;
grant select, insert, update, delete on public.card_statement_charges to authenticated;

-- ── Audit ───────────────────────────────────────────────────────────────────
-- Both tables added to TRIGGER_AUDITED_TABLES in lib/audit.ts so the API
-- routes' logAuditEvent calls don't double-log.
drop trigger if exists trg_audit_card_account_mappings on public.card_account_mappings;
create trigger trg_audit_card_account_mappings
  after insert or update or delete on public.card_account_mappings
  for each row execute function public.log_changes();

drop trigger if exists trg_audit_card_statement_charges on public.card_statement_charges;
create trigger trg_audit_card_statement_charges
  after insert or update or delete on public.card_statement_charges
  for each row execute function public.log_changes();
