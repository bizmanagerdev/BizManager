-- Generalizes the single `users.deliveries_access` boolean into a
-- `section_access` jsonb map covering every business section a worker's
-- access can be individually granted for: dashboard, deliveries, tasks,
-- calendar, and the new one, vehicles. Account/infra routes (profile, inbox,
-- notifications) stay unconditional — they were never gated by
-- deliveries_access either, and aren't a business section to grant/withhold.
--
-- Backfill preserves current behavior for every existing worker: the four
-- routes that were always on stay on; deliveries carries over its existing
-- per-worker value; vehicles (brand new capability, previously staff-only)
-- defaults OFF — nobody gets it just by deploying this, an admin has to grant
-- it per worker from the Salary Center worker-edit dialog.

alter table public.users
  add column if not exists section_access jsonb;

update public.users
set section_access = jsonb_build_object(
  'dashboard', true,
  'tasks', true,
  'calendar', true,
  'deliveries', deliveries_access,
  'vehicles', false
)
where role = 'worker';

alter table public.users
  drop column if exists deliveries_access;

-- Replaces the p_deliveries_access param added by 20260823072310 with
-- p_section_access, same "null preserves existing value" pattern already
-- used for p_locale/p_deliveries_access (coalesce on update; a full-access
-- default on insert).

drop function if exists public.admin_upsert_user_profile(
  uuid, uuid, text, text, text, text, boolean, boolean, text, text, text, boolean
);

create or replace function public.admin_upsert_user_profile(
  p_user_id uuid default null,
  p_auth_user_id uuid default null,
  p_full_name text default null,
  p_email text default null,
  p_phone text default null,
  p_role text default 'worker',
  p_active boolean default true,
  p_system_access boolean default false,
  p_payroll_worker_type text default null,
  p_pay_tracking_mode text default 'session',
  p_locale text default null,
  p_section_access jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role public.user_role_enum;
  v_payroll_worker_type text;
  v_pay_tracking_mode text;
  v_locale text;
begin
  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'full_name is required';
  end if;

  begin
    v_role := coalesce(nullif(trim(coalesce(p_role, '')), ''), 'worker')::public.user_role_enum;
  exception
    when invalid_text_representation then
      raise exception 'invalid role';
  end;

  v_payroll_worker_type := case
    when coalesce(nullif(trim(coalesce(p_payroll_worker_type, '')), ''), '') = 'monthly_payslip' then 'monthly_payslip'
    when coalesce(nullif(trim(coalesce(p_payroll_worker_type, '')), ''), '') = 'hourly_payslip' then 'hourly_payslip'
    when coalesce(nullif(trim(coalesce(p_payroll_worker_type, '')), ''), '') = 'session_only' then 'session_only'
    when coalesce(nullif(trim(coalesce(p_pay_tracking_mode, '')), ''), 'session') = 'payslip' then 'monthly_payslip'
    else 'session_only'
  end;

  v_pay_tracking_mode := case
    when v_payroll_worker_type = 'session_only' then 'session'
    else 'payslip'
  end;

  -- Only 'he'/'ar' are ever valid; anything else (including null/omitted)
  -- means "leave it as it is" rather than a silent reset.
  v_locale := case when p_locale in ('he', 'ar') then p_locale else null end;

  if p_user_id is not null then
    update public.users
    set auth_user_id = p_auth_user_id,
        full_name = nullif(trim(coalesce(p_full_name, '')), ''),
        email = nullif(trim(coalesce(lower(p_email), '')), ''),
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        role = v_role,
        active = coalesce(p_active, true),
        system_access = coalesce(p_system_access, false),
        payroll_worker_type = v_payroll_worker_type,
        pay_tracking_mode = v_pay_tracking_mode,
        locale = coalesce(v_locale, locale),
        section_access = coalesce(p_section_access, section_access)
    where id = p_user_id
    returning id into v_user_id;
  elsif nullif(trim(coalesce(p_email, '')), '') is not null then
    update public.users
    set auth_user_id = p_auth_user_id,
        full_name = nullif(trim(coalesce(p_full_name, '')), ''),
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        role = v_role,
        active = coalesce(p_active, true),
        system_access = coalesce(p_system_access, false),
        payroll_worker_type = v_payroll_worker_type,
        pay_tracking_mode = v_pay_tracking_mode,
        locale = coalesce(v_locale, locale),
        section_access = coalesce(p_section_access, section_access)
    where email = nullif(trim(coalesce(lower(p_email), '')), '')
    returning id into v_user_id;
  end if;

  if v_user_id is null then
    insert into public.users (
      auth_user_id,
      full_name,
      email,
      phone,
      role,
      active,
      system_access,
      payroll_worker_type,
      pay_tracking_mode,
      locale,
      section_access
    ) values (
      p_auth_user_id,
      nullif(trim(coalesce(p_full_name, '')), ''),
      nullif(trim(coalesce(lower(p_email), '')), ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      v_role,
      coalesce(p_active, true),
      coalesce(p_system_access, false),
      v_payroll_worker_type,
      v_pay_tracking_mode,
      coalesce(v_locale, 'he'),
      coalesce(
        p_section_access,
        '{"dashboard":true,"tasks":true,"calendar":true,"deliveries":true,"vehicles":false}'::jsonb
      )
    )
    returning id into v_user_id;
  end if;

  return v_user_id;
end;
$$;

grant execute on function public.admin_upsert_user_profile(
  uuid, uuid, text, text, text, text, boolean, boolean, text, text, text, jsonb
) to authenticated;

-- RLS — a worker with the "vehicles" section granted gets the exact same
-- write access staff already have (matches "full same access as admin/office"
-- for this section). Creating/editing a vehicle also writes its backing
-- `tags` row, so both policies need the same OR-clause. Reads of
-- vehicles/tags/entity_tags are already open to any authenticated/worker
-- session (untouched) — only these two WRITE policies change.

alter policy "Staff manage vehicles" on public.vehicles
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid())
    and u.active = true and coalesce(u.system_access, false) = true
    and (u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])
         or (u.role = 'worker'::user_role_enum and coalesce((u.section_access->>'vehicles')::boolean, false)))))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid())
    and u.active = true and coalesce(u.system_access, false) = true
    and (u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])
         or (u.role = 'worker'::user_role_enum and coalesce((u.section_access->>'vehicles')::boolean, false)))));

-- `tags` is a cross-cutting backbone, not vehicles-only (kind='vehicle' is
-- just one of its kinds) — so unlike the vehicles table itself, the worker
-- branch here is scoped to kind='vehicle' specifically. A vehicles-access
-- worker should be able to create/rename the tag a vehicle IS, not manage
-- every other kind of tag in the system.
alter policy "Staff manage tags" on public.tags
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid())
    and u.active = true and coalesce(u.system_access, false) = true
    and (u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])
         or (u.role = 'worker'::user_role_enum and kind = 'vehicle' and coalesce((u.section_access->>'vehicles')::boolean, false)))))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid())
    and u.active = true and coalesce(u.system_access, false) = true
    and (u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])
         or (u.role = 'worker'::user_role_enum and kind = 'vehicle' and coalesce((u.section_access->>'vehicles')::boolean, false)))));
