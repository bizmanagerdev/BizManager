-- Collections restructure (Phase D): let communications stand alone.
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Communications are now a GLOBAL module — a call/WhatsApp/meeting may be about
-- an order, a vehicle, or nothing customer-specific at all. Relax the historical
-- NOT NULL on customer_id so a log can attach to a non-customer entity (or none).
-- Existing rows are unaffected; the app still defaults to a customer where one
-- is known.

alter table public.communication_logs alter column customer_id drop not null;
