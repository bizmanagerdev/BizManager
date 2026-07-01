-- Track device metadata on push subscriptions so admins can see which phones /
-- browsers are actually connected (Settings → התראות → מכשירים מחוברים).
-- Idempotent.

alter table public.push_subscriptions
  add column if not exists user_agent  text,
  add column if not exists last_seen_at timestamptz;

-- Existing rows connected before this column existed: treat their creation time
-- as the last-seen time so they don't render as "never".
update public.push_subscriptions
  set last_seen_at = created_at
  where last_seen_at is null;
