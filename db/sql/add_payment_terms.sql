-- Run in Supabase SQL Editor. Idempotent.
--
-- Per-order / per-project payment terms (צורת תשלום) + due date, powering the
-- automatic due-date calculation used by the orders list and גבייה (collections).
--
-- payment_terms: 'immediate' | 'eom' | 'eom_30' | 'eom_40' | 'eom_60' | 'eom_90'.
--   NULL = 'immediate' (due on the order/project date) so existing rows keep
--   current behavior until a term is chosen.
-- due_date: the effective due date. Auto-filled from payment_terms + the
--   order_date (orders) / start_date (projects), but can be overridden manually.

alter table public.orders add column if not exists payment_terms text;
alter table public.orders add column if not exists due_date date;

alter table public.projects add column if not exists payment_terms text;
alter table public.projects add column if not exists due_date date;
