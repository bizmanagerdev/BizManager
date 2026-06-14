-- Run this script in Supabase SQL Editor.
--
-- Goal:
-- - Make offline / poor-connection writes safe to replay. When the app loses
--   connectivity mid-save it queues the request and resends it later. A request
--   can also reach the server while the *response* is lost on a flaky network —
--   the client then resends the same request. Without dedup that creates a
--   duplicate record (the bug the user hit: "saves it later" twice).
-- - Each at-risk write carries a client-generated Idempotency-Key header. The
--   first time the server sees a key it runs the work and stores the response;
--   any later request with the same key returns the stored response WITHOUT
--   re-running the work. See lib/idempotency.ts (withIdempotency).

create table if not exists public.idempotency_keys (
  key text primary key,
  user_id uuid not null,
  endpoint text,
  status text not null default 'processing',  -- 'processing' | 'done'
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idempotency_keys_created_at_idx
  on public.idempotency_keys (created_at);

-- Each user only ever touches their own keys. RLS keeps the table self-scoped so
-- the normal (RLS-bound) route client can claim/read/update its own keys without
-- needing the service role.
alter table public.idempotency_keys enable row level security;

drop policy if exists idempotency_keys_select_own on public.idempotency_keys;
create policy idempotency_keys_select_own on public.idempotency_keys
  for select using (auth.uid() = user_id);

drop policy if exists idempotency_keys_insert_own on public.idempotency_keys;
create policy idempotency_keys_insert_own on public.idempotency_keys
  for insert with check (auth.uid() = user_id);

drop policy if exists idempotency_keys_update_own on public.idempotency_keys;
create policy idempotency_keys_update_own on public.idempotency_keys
  for update using (auth.uid() = user_id);

drop policy if exists idempotency_keys_delete_own on public.idempotency_keys;
create policy idempotency_keys_delete_own on public.idempotency_keys
  for delete using (auth.uid() = user_id);

comment on table public.idempotency_keys is
  'Dedup store for replayable offline writes. One row per Idempotency-Key; caches the original response so a replay is a no-op. Safe to prune rows older than a few days.';

-- Optional housekeeping: drop keys older than 7 days. Schedule via pg_cron if
-- available, or run occasionally. Old keys are only needed while a queued action
-- might still be replayed, which in practice is hours, not days.
-- delete from public.idempotency_keys where created_at < now() - interval '7 days';
