-- Seed users.last_seen_at from history so the "מחוברים כעת" bar shows people who
-- were active BEFORE last-seen tracking existed (otherwise last_seen_at is NULL
-- for everyone until their next heartbeat, and the bar looks empty).
--
-- Best available proxy for "last active" = the most recent audit_logs row they
-- caused. changed_by holds a MIX of users.id (app-side events like login) and
-- users.auth_user_id (DB-trigger rows = auth.uid()), so we match on both.
--
-- Idempotent: only advances last_seen_at, never rewinds it.

with activity as (
  select u.id as user_id, max(a.created_at) as ts
  from public.users u
  join public.audit_logs a
    on a.changed_by = u.id or a.changed_by = u.auth_user_id
  where a.created_at is not null
  group by u.id
)
update public.users u
set last_seen_at = activity.ts
from activity
where activity.user_id = u.id
  and activity.ts is not null
  and (u.last_seen_at is null or activity.ts > u.last_seen_at);
