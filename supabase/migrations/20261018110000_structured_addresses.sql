-- ════════════════════════════════════════════════════════════════════════════
-- One address shape for every place BizH keeps an address (owner, 2026-10-16:
-- "all the addresses need to always be saved in the same format"; 2026-10-17:
-- "yes" to adding the empty fields). Picked from Google's list by the address
-- picker (components/ui/address-picker.tsx, lib/address/structured.ts).
--
-- Every address gets the same eight fields:
--   *_city, *_street, *_house_number   "בית שמש", "יחזקאל הנביא", "27"
--   *_unit                             typed by hand: "דירה 5, כניסה א"
--   *_lat, *_lng                       Google's point for the address
--   *_place_id                         Google's id for the place
--   *_formatted                        Google's line, "יחזקאל הנביא 27, בית שמש"
-- on customers, customer_branches, tasks and properties as addr_*, and on
-- projects as origin_* and destination_* (a move's from and to; its floor and
-- lift columns stay as they are).
--
-- Only ADDS empty, nullable columns: no row is changed, and the old address
-- columns (customers.address / city, customer_branches.address, tasks.address
-- / city, properties.address, projects.origin_address / destination_address)
-- stay and keep being written, so everything that reads them is unaffected.
-- The customer's own drop-off point (customers.delivery_lat / delivery_lng)
-- stays too and still wins over the address.
--
-- The phone copy: the powersync publication has no column lists and the sync
-- rules select these tables with *, so the new columns reach devices without
-- a rules deploy; lib/powersync/schema.ts lists them when the app reads them.
--
-- ROLLBACK: supabase/rollbacks/20261018110000_structured_addresses.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- Adding a nullable column with no default only touches the catalog, but it
-- still takes a brief lock: give up rather than queue behind a long query.
set lock_timeout = '5s';

alter table public.customers
  add column if not exists addr_city text,
  add column if not exists addr_street text,
  add column if not exists addr_house_number text,
  add column if not exists addr_unit text,
  add column if not exists addr_lat double precision,
  add column if not exists addr_lng double precision,
  add column if not exists addr_place_id text,
  add column if not exists addr_formatted text;

alter table public.customer_branches
  add column if not exists addr_city text,
  add column if not exists addr_street text,
  add column if not exists addr_house_number text,
  add column if not exists addr_unit text,
  add column if not exists addr_lat double precision,
  add column if not exists addr_lng double precision,
  add column if not exists addr_place_id text,
  add column if not exists addr_formatted text;

alter table public.tasks
  add column if not exists addr_city text,
  add column if not exists addr_street text,
  add column if not exists addr_house_number text,
  add column if not exists addr_unit text,
  add column if not exists addr_lat double precision,
  add column if not exists addr_lng double precision,
  add column if not exists addr_place_id text,
  add column if not exists addr_formatted text;

alter table public.properties
  add column if not exists addr_city text,
  add column if not exists addr_street text,
  add column if not exists addr_house_number text,
  add column if not exists addr_unit text,
  add column if not exists addr_lat double precision,
  add column if not exists addr_lng double precision,
  add column if not exists addr_place_id text,
  add column if not exists addr_formatted text;

alter table public.projects
  add column if not exists origin_city text,
  add column if not exists origin_street text,
  add column if not exists origin_house_number text,
  add column if not exists origin_unit text,
  add column if not exists origin_lat double precision,
  add column if not exists origin_lng double precision,
  add column if not exists origin_place_id text,
  add column if not exists origin_formatted text,
  add column if not exists destination_city text,
  add column if not exists destination_street text,
  add column if not exists destination_house_number text,
  add column if not exists destination_unit text,
  add column if not exists destination_lat double precision,
  add column if not exists destination_lng double precision,
  add column if not exists destination_place_id text,
  add column if not exists destination_formatted text;

comment on column public.customers.addr_city is 'Structured address (lib/address/structured.ts), picked from Google. The old customers.address line is still written beside it.';
comment on column public.customer_branches.addr_city is 'Structured address (lib/address/structured.ts), picked from Google. The old address line is still written beside it.';
comment on column public.tasks.addr_city is 'Structured address (lib/address/structured.ts), picked from Google. The old city/address are still written beside it.';
comment on column public.properties.addr_city is 'Structured address (lib/address/structured.ts), picked from Google. The old address line is still written beside it.';
comment on column public.projects.origin_city is 'A move''s from-address, structured (lib/address/structured.ts). origin_address is still written beside it.';
comment on column public.projects.destination_city is 'A move''s to-address, structured (lib/address/structured.ts). destination_address is still written beside it.';
