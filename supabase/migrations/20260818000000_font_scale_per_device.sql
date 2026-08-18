-- Per-device text size: one multiplier for the PHONE, one for the desktop.
--
-- `users.font_scale` (added by db/sql/add_user_font_scale.sql) stays exactly as
-- it is and keeps meaning "desktop". This adds its phone counterpart, because a
-- size that reads well on a 27" screen is not the size you want on a 360px one —
-- and until now the single value had to be a compromise between the two.
--
-- Nullable on purpose, and the app falls back to `font_scale` when it's NULL, so
-- everyone who already chose a size keeps exactly what they have on both.
--
-- Idempotent: safe to re-run.

alter table public.users
  add column if not exists font_scale_mobile real;

alter table public.users
  drop constraint if exists users_font_scale_mobile_check;

alter table public.users
  add constraint users_font_scale_mobile_check
  check (font_scale_mobile is null or (font_scale_mobile >= 0.5 and font_scale_mobile <= 2));

comment on column public.users.font_scale_mobile is
  'Per-user UI text-size multiplier on PHONES (NULL = follow font_scale). Applied to the root font-size below 768px; the whole rem-based UI scales with it.';

-- Same shape and the same safety as set_my_font_scale: security definer + an
-- auth.uid() scope, so a signed-in user can set their OWN value without any
-- broad UPDATE right on public.users (those stay admin-only), and the value is
-- clamped server-side whatever the client sends.
create or replace function public.set_my_font_scale_mobile(p_scale real)
returns real
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scale real := least(greatest(coalesce(p_scale, 1), 0.5), 2);
begin
  update public.users
  set font_scale_mobile = v_scale
  where auth_user_id = auth.uid();

  return v_scale;
end;
$$;

revoke all on function public.set_my_font_scale_mobile(real) from public;
grant execute on function public.set_my_font_scale_mobile(real) to authenticated;
