-- ════════════════════════════════════════════════════════════════════════════
-- A property's links as fields, not lines of its description (owner,
-- 2026-10-23: "I'm trying to make this normal, these also need fields" — the
-- Montréal tax account, JLR and the Registre foncier under 6366 Rue Pierre).
--
--   properties.tax_account_url    its tax account online — the "חשבון מס"
--                                 number in its first card opens it.
--   properties.land_registry_url  the land register (Registre foncier, טאבו)
--   properties.land_title_url     another title service (JLR) — both by the
--                                 lot number in "רכישת הנכס".
--
-- Nothing already saved changes. Rollback: supabase/rollbacks/.
-- ════════════════════════════════════════════════════════════════════════════

set lock_timeout = '5s';

alter table public.properties
  add column if not exists tax_account_url text,
  add column if not exists land_registry_url text,
  add column if not exists land_title_url text;
