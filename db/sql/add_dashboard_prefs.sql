-- Run this script in Supabase SQL Editor.
--
-- Goal:
-- - Persist each user's dashboard layout choice (which widgets they show and in
--   what order — the "התאמת לוח" customizer) on their account, so it follows
--   them across devices.
-- - Shape: { "order": ["myTasks", "reminders", ...], "hidden": ["inventory"] }.
--   Both arrays hold widget ids; the client/server always re-filters by ROLE, so
--   a stored id can never surface a widget the user's role isn't allowed to see.
--
-- Nullable on purpose: NULL = "never customized", which makes every account fall
-- back to its role's default dashboard until the user explicitly customizes.

alter table public.users
  add column if not exists dashboard_prefs jsonb;

comment on column public.users.dashboard_prefs is
  'Per-user dashboard layout (NULL = role defaults). { order: widget-id[], hidden: widget-id[] }. Always re-filtered by role server-side.';

-- Let any signed-in user update ONLY their own dashboard_prefs without needing
-- broad UPDATE rights on public.users (those are admin-only). security definer +
-- auth.uid() scoping keeps this safe and self-limited. Mirrors set_my_font_scale.
create or replace function public.set_my_dashboard_prefs(p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefs jsonb := p_prefs;
begin
  -- Defensive: only accept a json object (or null to reset). Anything else → reset.
  if v_prefs is not null and jsonb_typeof(v_prefs) <> 'object' then
    v_prefs := null;
  end if;

  update public.users
  set dashboard_prefs = v_prefs
  where auth_user_id = auth.uid();

  return v_prefs;
end;
$$;

grant execute on function public.set_my_dashboard_prefs(jsonb) to authenticated;
