-- What kind of property this is (building/apartment/house), and — only for a
-- building — how many apartments it has. Allowed values enforced in the UI,
-- not a DB check constraint (same pattern as lease_agreements.deposit_type).

alter table public.properties
  add column if not exists property_type text,
  add column if not exists apartments_count integer;
