-- Run this script in Supabase SQL Editor.
--
-- Goal:
-- - Let each user pick their own avatar color (the colored initials circle shown
--   on task cards, member chips, comments, etc.) from a fixed palette, persisted
--   on their account so it stays the same everywhere and across devices.
--
-- Nullable on purpose: NULL = "never chosen", which lets the UI fall back to an
-- auto-assigned distinct color until the user picks one here.

alter table public.users
  add column if not exists avatar_color text;

-- Only a 6-digit hex (e.g. #2563EB) is allowed. The app offers a small curated
-- palette; this constraint just guards the format so junk can't be stored.
alter table public.users
  drop constraint if exists users_avatar_color_check;

alter table public.users
  add constraint users_avatar_color_check
  check (avatar_color is null or avatar_color ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.users.avatar_color is
  'Per-user avatar color (hex, NULL = unset → auto-assigned). Used for the initials circle across the app.';

-- Let any signed-in user set ONLY their own avatar_color without needing broad
-- UPDATE rights on public.users (those are admin-only). security definer +
-- auth.uid() scoping keeps it safe and self-limited. NULL clears the choice
-- (back to the auto color). The value is format-validated server-side.
create or replace function public.set_my_avatar_color(p_color text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_color text := nullif(btrim(coalesce(p_color, '')), '');
begin
  if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid avatar_color: %', p_color;
  end if;
  update public.users
  set avatar_color = v_color
  where auth_user_id = auth.uid();
  return v_color;
end;
$$;

grant execute on function public.set_my_avatar_color(text) to authenticated;
