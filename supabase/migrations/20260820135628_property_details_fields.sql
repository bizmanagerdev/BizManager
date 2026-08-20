-- Richer property details: name + physical facts + amenities. All nullable/
-- defaulted so existing properties keep displaying exactly as before.
alter table public.properties
  add column if not exists name text,
  add column if not exists rooms numeric,
  add column if not exists square_meters numeric,
  add column if not exists floor integer,
  add column if not exists bathrooms integer,
  add column if not exists has_private_entrance boolean not null default false,
  add column if not exists has_storage_room boolean not null default false,
  add column if not exists has_parking boolean not null default false,
  add column if not exists has_elevator boolean not null default false;
