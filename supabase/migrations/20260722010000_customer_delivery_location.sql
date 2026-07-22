-- "How do I actually get to the door?" — the part a street address doesn't say.
--
-- Deliveries render the CUSTOMER's address, so until now there was nowhere to
-- record "drive to the address, then around the corner, blue gate". A driver who
-- worked it out once had no way to leave that knowledge behind: notes typed while
-- confirming a delivery are saved on that ORDER, so the next delivery starts from
-- scratch. These columns live on the customer precisely so the answer survives.
--
--   delivery_instructions — free text, shown on every future delivery to them
--   delivery_lat/lng      — the exact spot, captured on-site by GPS or parsed
--                           out of a pasted Waze / Google Maps link. Navigation
--                           uses this in preference to the address string, which
--                           is what fixes "Waze drops me on the wrong side".
--
-- numeric (not float): coordinates are compared and displayed, never used for
-- floating-point maths, and numeric avoids drift when they round-trip.
--
-- Idempotent; safe to re-run.

alter table public.customers
  add column if not exists delivery_instructions text,
  add column if not exists delivery_lat numeric,
  add column if not exists delivery_lng numeric;

comment on column public.customers.delivery_instructions is
  'Free-text arrival directions shown to the driver on every delivery to this customer.';
comment on column public.customers.delivery_lat is
  'Latitude of the saved drop-off pin (GPS on-site, or parsed from a map link).';
comment on column public.customers.delivery_lng is
  'Longitude of the saved drop-off pin.';
