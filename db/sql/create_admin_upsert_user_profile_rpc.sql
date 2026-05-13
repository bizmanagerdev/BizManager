-- Run this script in Supabase SQL Editor.
-- Privileged RPC used by POST /api/users/create to create/update rows in public.users.

drop function if exists public.admin_upsert_user_profile(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  text
);

drop function if exists public.admin_upsert_user_profile(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  text,
  text
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
  p_pay_tracking_mode text default 'session'
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
        pay_tracking_mode = v_pay_tracking_mode
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
        pay_tracking_mode = v_pay_tracking_mode
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
      pay_tracking_mode
    ) values (
      p_auth_user_id,
      nullif(trim(coalesce(p_full_name, '')), ''),
      nullif(trim(coalesce(lower(p_email), '')), ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      v_role,
      coalesce(p_active, true),
      coalesce(p_system_access, false),
      v_payroll_worker_type,
      v_pay_tracking_mode
    )
    returning id into v_user_id;
  end if;

  return v_user_id;
end;
$$;

grant execute on function public.admin_upsert_user_profile(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  text,
  text
) to authenticated;
