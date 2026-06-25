-- ════════════════════════════════════════════════════════════════════════════
-- Documents: store an OPTIONAL business-domain override (תחום) on the document.
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Semantics:
--   • business_domain IS NULL  → "auto": the app infers the domain from the
--     document's linked entity (project → פרויקטים, order → מכירות, property →
--     ניהול נכסים, …), falling back to שוטף when there is no link.
--   • business_domain IS NOT NULL → an explicit override chosen on upload (for a
--     standalone file with no entity) or via the "שינוי תחום" button in the UI.
--     The stored value wins over inference.
--
-- This keeps linked files showing their real domain (no noisy default "שוטף")
-- while still letting any file be re-tagged to any domain. Domains match
-- lib/expenses.ts EXPENSE_BUSINESS_DOMAINS.
-- ════════════════════════════════════════════════════════════════════════════

-- Nullable, no default. (If an earlier run created it NOT NULL DEFAULT
-- 'general_business', the statements below relax it.)
alter table public.documents
  add column if not exists business_domain text;

alter table public.documents alter column business_domain drop default;
alter table public.documents alter column business_domain drop not null;

-- ONE-TIME cleanup of the seeded 'general_business' defaults from the earlier
-- NOT NULL version. Already applied — keep COMMENTED so re-running this file can
-- never wipe a domain you set manually via the "שינוי תחום" button.
-- update public.documents set business_domain = null where business_domain = 'general_business';

create index if not exists documents_business_domain_idx
  on public.documents (business_domain);
