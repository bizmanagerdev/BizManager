-- Per-user notification preferences: mute categories + pause phone push.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- Shape: { "muted": ["payroll","digests"], "push_paused": false }.
--   muted        → no push AND no in-app notification for those buckets.
--   push_paused  → no phone push, but still recorded in-app (bell/history).
-- NULL = default (everything on). See lib/notifications/categories.ts for buckets.

alter table public.users
  add column if not exists notification_prefs jsonb;

comment on column public.users.notification_prefs is
  'Per-user notification prefs. { muted: bucket[], push_paused: bool }. NULL = all on.';

create or replace function public.set_my_notification_prefs(p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefs jsonb := p_prefs;
begin
  if v_prefs is not null and jsonb_typeof(v_prefs) <> 'object' then
    v_prefs := null;
  end if;

  update public.users
  set notification_prefs = v_prefs
  where auth_user_id = auth.uid();

  return v_prefs;
end;
$$;

grant execute on function public.set_my_notification_prefs(jsonb) to authenticated;
