-- Push notification subscriptions
-- Run this in the Supabase SQL editor

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

-- Each user can only see/manage their own subscriptions
alter table public.push_subscriptions enable row level security;

create policy "Users manage own subscriptions"
  on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Service-role bypass (used by server-side send functions)
-- No extra policy needed — service_role bypasses RLS by default.
