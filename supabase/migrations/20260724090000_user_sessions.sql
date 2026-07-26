-- Heavy usage tracking: real per-session activity, so we can show reliably WHO is
-- active now and WHEN each user was active — independent of ephemeral Realtime
-- presence (which was silently failing to mark the viewer online).
--
-- Each browser tab owns a client-generated session id and heartbeats every ~60s.
-- A session is "active now" when its last_seen_at is within ~2 min. started_at →
-- last_seen_at is the real active window (accurate session length, unlike
-- last_seen − last_login which just measured cookie lifetime).
--
-- Idempotent.

create table if not exists public.user_sessions (
  id           uuid primary key,                 -- client-generated per tab (crypto.randomUUID)
  user_id      uuid not null references public.users(id) on delete cascade,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent   text
);

create index if not exists idx_user_sessions_user_last_seen
  on public.user_sessions using btree (user_id, last_seen_at desc);
create index if not exists idx_user_sessions_last_seen
  on public.user_sessions using btree (last_seen_at desc);

alter table public.user_sessions enable row level security;

-- Read-only to admins/office (the /activity bar is admin-only; the roster is also
-- fetched with the service-role client which bypasses RLS). No direct writes —
-- all writes go through session_heartbeat (SECURITY DEFINER).
drop policy if exists "user_sessions_staff_read" on public.user_sessions;
create policy "user_sessions_staff_read" on public.user_sessions
  for select to authenticated
  using (public.is_admin() or public.current_user_role() = 'office');

-- Heartbeat: upsert the caller's session and bump users.last_seen_at. Uses the
-- app.skip_audit opt-out (migration 20260724060000) so this churn is never audited.
create or replace function public.session_heartbeat(p_session_id uuid, p_user_agent text default null)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_user uuid;
begin
  select id into v_user from public.users where auth_user_id = auth.uid();
  if v_user is null then return; end if;

  perform set_config('app.skip_audit', 'on', true); -- transaction-local

  insert into public.user_sessions (id, user_id, started_at, last_seen_at, user_agent)
  values (p_session_id, v_user, now(), now(), p_user_agent)
  on conflict (id) do update set last_seen_at = now();

  update public.users set last_seen_at = now() where id = v_user;
end;
$$;

grant execute on function public.session_heartbeat(uuid, text) to authenticated;
