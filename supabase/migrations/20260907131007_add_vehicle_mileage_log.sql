-- Mileage isn't a field, it's a reading with a date attached — a bare number
-- (20260906113949_add_vehicle_mileage.sql) can't say whether it's from
-- yesterday or last March, can't be corrected without losing history, and
-- can't catch someone fat-fingering the odometer backwards. Readings become a
-- log; `vehicles.mileage` stays as a cheap denormalized "latest reading"
-- cache (for the fleet list's sortable column) kept in sync by a trigger
-- rather than written directly — the general vehicle edit form no longer
-- exposes a bare mileage input (see VehicleFormFields.tsx / VehicleInput).
--
-- `source` and `recorded_by` are forward-looking: this migration only wires
-- up the manual "one-tap update from the record" capture point, but garage
-- expenses / test-task completion are meant to feed the same log later
-- without another migration.

alter table public.vehicles
  add column if not exists mileage_updated_at date;

create table if not exists public.vehicle_mileage_readings (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.tags(id) on delete cascade,
  reading integer not null check (reading >= 0),
  recorded_at date not null default current_date,
  source text not null default 'manual' check (source in ('manual', 'expense', 'task')),
  recorded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists vehicle_mileage_readings_tag_idx
  on public.vehicle_mileage_readings (tag_id, recorded_at desc, created_at desc);

alter table public.vehicle_mileage_readings enable row level security;

-- Reads open to any authenticated user — same precedent as tags/entity_tags
-- (see create_tags_and_vehicles.sql): the page guard is the real boundary,
-- not row-level read scoping, for this cross-cutting backbone.
create policy "vehicle_mileage_readings_select" on public.vehicle_mileage_readings
  for select to authenticated
  using (true);

-- Same "full same access as admin/office" shape as "Staff manage vehicles"
-- (20260907094527_add_worker_section_access.sql): admin/office always, a
-- worker only with section_access.vehicles = true.
create policy "vehicle_mileage_readings_insert" on public.vehicle_mileage_readings
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.active = true
        and coalesce(u.system_access, false) = true
        and (
          u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])
          or (u.role = 'worker'::user_role_enum and coalesce((u.section_access->>'vehicles')::boolean, false))
        )
    )
  );

-- Delete exists only so the undo-toast (scheduleDeferredEdit's revert path,
-- same pattern as every other add-flow in this app) can retract a reading
-- added seconds ago — not a general history-editing surface.
create policy "vehicle_mileage_readings_delete" on public.vehicle_mileage_readings
  for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.active = true
        and coalesce(u.system_access, false) = true
        and (
          u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])
          or (u.role = 'worker'::user_role_enum and coalesce((u.section_access->>'vehicles')::boolean, false))
        )
    )
  );

grant select, insert, delete on public.vehicle_mileage_readings to authenticated;

-- Keeps vehicles.mileage/mileage_updated_at equal to the newest reading in
-- the log, on every insert or delete — including the empty-log case after a
-- delete, which resets the cache back to null instead of leaving it stale.
create or replace function public.sync_vehicle_mileage_cache()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag_id uuid := coalesce(new.tag_id, old.tag_id);
  v_reading integer;
  v_date date;
begin
  select reading, recorded_at into v_reading, v_date
  from public.vehicle_mileage_readings
  where tag_id = v_tag_id
  order by recorded_at desc, created_at desc
  limit 1;

  update public.vehicles
  set mileage = v_reading, mileage_updated_at = v_date
  where tag_id = v_tag_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists vehicle_mileage_readings_sync on public.vehicle_mileage_readings;
create trigger vehicle_mileage_readings_sync
  after insert or delete on public.vehicle_mileage_readings
  for each row execute function public.sync_vehicle_mileage_cache();
