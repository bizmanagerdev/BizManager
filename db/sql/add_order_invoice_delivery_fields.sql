-- ════════════════════════════════════════════════════════════════════════════
-- ORDERS — invoice tracking + delivery-confirmation date
-- Run in the Supabase SQL Editor.
--
-- Adds a manual invoicing workflow + a delivery date to sales orders:
--   • needs_invoice         — does this order need an invoice? chosen per order
--                             (null = undecided, for legacy rows).
--   • invoice_sent_at       — when the invoice was sent (null = not sent yet).
--                             Auto-set when a Morning invoice issues; also toggleable.
--   • delivery_confirmed_at — the delivery date entered when confirming אספקה.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.orders
  add column if not exists needs_invoice         boolean,
  add column if not exists invoice_sent_at       timestamptz,
  add column if not exists delivery_confirmed_at timestamptz;

-- Speeds up the "needs an invoice but not sent yet" list filter.
create index if not exists orders_needs_invoice_unsent_idx
  on public.orders (needs_invoice)
  where invoice_sent_at is null;
