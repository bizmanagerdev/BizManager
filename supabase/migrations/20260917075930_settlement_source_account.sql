-- ════════════════════════════════════════════════════════════════════════════
-- The Grow row in קבועות gets an account, like the expense rows.
--
-- The credit-card clearing deposits always land in the same account. That
-- choice is stored the same way the outgoing rows store theirs — one
-- outflow_source_settings row, here (source_kind 'settlement', source_key
-- 'grow') — and every card deposit is then counted in that account, whatever
-- account the individual card payments were recorded to.
--
-- The table's CHECK only knew the three outgoing kinds; this adds 'settlement'.
-- Nothing else changes until an account is chosen on the row.
--
-- Idempotent; safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.outflow_source_settings
  drop constraint if exists outflow_source_settings_source_kind_check;

alter table public.outflow_source_settings
  add constraint outflow_source_settings_source_kind_check
  check (source_kind in ('salary', 'loan', 'card', 'settlement'));
