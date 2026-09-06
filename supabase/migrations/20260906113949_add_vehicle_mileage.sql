-- Odometer reading (ק"מ) — the one field a vehicle record usually needs that
-- was missing. Nullable integer; future service-interval logic can read it,
-- nothing depends on it yet.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS mileage integer;
