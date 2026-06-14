-- Run this script in Supabase SQL Editor.
--
-- Goal:
-- - Persist each user's global text-size multiplier (the "גודל טקסט" chooser in
--   /profile) on their account, so the preference follows them across devices.
-- - The whole UI is rem-based, so this multiplier scales the root font-size and
--   the entire layout zooms proportionally (see app/globals.css --font-scale).
--
-- Nullable on purpose: NULL = "never explicitly chosen", which lets the client
-- keep a device-local (localStorage) preference until the user picks one here.

alter table public.users
  add column if not exists font_scale real;

alter table public.users
  drop constraint if exists users_font_scale_check;

alter table public.users
  add constraint users_font_scale_check
  check (font_scale is null or (font_scale >= 0.5 and font_scale <= 2));

comment on column public.users.font_scale is
  'Per-user UI text-size multiplier (NULL = unset, 1 = default). Applied to the root font-size; the whole rem-based UI scales with it.';

-- Let any signed-in user update ONLY their own font_scale without needing broad
-- UPDATE rights on public.users (those are admin-only). security definer +
-- auth.uid() scoping keeps this safe and self-limited. The value is clamped to
-- the supported range server-side.
create or replace function public.set_my_font_scale(p_scale real)
returns real
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scale real := least(greatest(coalesce(p_scale, 1), 0.5), 2);
begin
  update public.users
  set font_scale = v_scale
  where auth_user_id = auth.uid();
  return v_scale;
end;
$$;

grant execute on function public.set_my_font_scale(real) to authenticated;
