-- Per-user UI language. Only the worker role is ever offered a toggle for this
-- (office/admin stay Hebrew), but the column lives on every user for simplicity.
-- Not nullable: unlike font_scale there's no "unset -> fall back to device-local
-- value" story here, so it always has a concrete value ('he' by default).

alter table public.users
  add column if not exists locale text not null default 'he';

alter table public.users
  drop constraint if exists users_locale_check;

alter table public.users
  add constraint users_locale_check
  check (locale in ('he', 'ar'));

comment on column public.users.locale is
  'Per-user UI language (he | ar). Drives worker-facing pages; office/admin stay he.';

-- Let any signed-in user update ONLY their own locale, mirroring set_my_font_scale.
create or replace function public.set_my_locale(p_locale text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locale text := case when p_locale in ('he', 'ar') then p_locale else 'he' end;
begin
  update public.users
  set locale = v_locale
  where auth_user_id = auth.uid();
  return v_locale;
end;
$$;

grant execute on function public.set_my_locale(text) to authenticated;
