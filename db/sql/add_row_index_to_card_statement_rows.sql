-- Run in Supabase SQL Editor.
-- Adds a stable row_index so statement rows always render in original file order,
-- regardless of when expenses are created or domains are updated.

alter table public.card_statement_rows
  add column if not exists row_index integer null;

create index if not exists card_statement_rows_order_idx
  on public.card_statement_rows (statement_id, row_index nulls last, created_at);
