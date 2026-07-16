-- Reminders/Alerts redesign — inbox read state.
--
-- The inbox shows OPEN REMINDERS, which have no per-user read flag (a reminder is
-- pending or resolved; "have I looked at it" is a different question). Rather than
-- add a read column per user per reminder, we store one timestamp per user: the
-- last time they looked at the inbox. Anything that arrived after it is "new".
--
-- That's what powers "4 חדשות · 6 סה״כ" and "סמן הכול כנקרא" — mark-all-read just
-- advances the timestamp. Same shape as users.digest_seen_at (20260702040000).
-- Idempotent; safe to re-run.

alter table public.users
  add column if not exists inbox_seen_at timestamptz;

comment on column public.users.inbox_seen_at is
  'Last time this user opened their inbox. Reminders newer than this count as "new" (חדשות). NULL = everything is new.';

create or replace function public.set_my_inbox_seen_at(p_at timestamptz default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz := coalesce(p_at, now());
begin
  update public.users
  set inbox_seen_at = v_at
  where auth_user_id = auth.uid();

  return v_at;
end;
$$;

grant execute on function public.set_my_inbox_seen_at(timestamptz) to authenticated;
