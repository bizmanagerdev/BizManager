alter table public.properties
  add column if not exists mezuzah_count integer,
  add column if not exists light_bulb_count integer;
