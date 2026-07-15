-- Native FCM device tokens (Android APK / Capacitor shell).
--
-- The web-push subscriptions in push_subscriptions cannot be used inside the
-- Capacitor WebView: Android System WebView has no Push API. Native builds
-- instead register directly with Firebase Cloud Messaging and get an opaque
-- token, stored here. The server sends to these via firebase-admin (lib/fcm.ts),
-- in addition to web push, so an alert reaches both browser PWAs and the APK.
--
-- Idempotent.

create table if not exists public.fcm_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token        text not null,
  platform     text not null default 'android',
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- A given FCM token is globally unique to one device install. If the same
  -- device re-registers under a different user (shared phone), the token must
  -- move to the new user rather than duplicate — so the constraint is on token
  -- alone, and the register endpoint upserts on it.
  unique (token)
);

create index if not exists fcm_tokens_user_id_idx on public.fcm_tokens (user_id);

alter table public.fcm_tokens enable row level security;

-- Each user can only see/manage their own device tokens. Server-side sends use
-- the service-role client, which bypasses RLS.
drop policy if exists "Users manage own fcm tokens" on public.fcm_tokens;
create policy "Users manage own fcm tokens"
  on public.fcm_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
