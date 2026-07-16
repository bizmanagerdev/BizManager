-- Let a user edit their OWN name + phone from /profile.
--
-- Same shape as the other self-serve setters (set_my_font_scale,
-- set_my_avatar_color, set_my_notification_prefs): SECURITY DEFINER + scoped to
-- `where auth_user_id = auth.uid()`, so a user can only ever write their own row
-- and never needs an UPDATE policy on public.users (which would be far broader).
--
-- Deliberately NOT editable here:
--   * email — it's the auth identity; changing it belongs to auth, not a profile form
--   * role / active / system_access / payroll_worker_type — admin-managed
-- Idempotent; safe to re-run.

create or replace function public.set_my_profile_details(p_full_name text, p_phone text)
returns table (full_name text, phone text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  -- A blank display name would make the user vanish from every list/avatar.
  if v_name is null then
    raise exception 'full_name is required';
  end if;

  update public.users u
  set full_name = v_name,
      phone = v_phone
  where u.auth_user_id = auth.uid();

  return query
  select v_name, v_phone;
end;
$$;

grant execute on function public.set_my_profile_details(text, text) to authenticated;
