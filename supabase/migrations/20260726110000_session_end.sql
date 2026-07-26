-- "Online" is driven by the DB heartbeat (Realtime presence doesn't reliably
-- connect in prod). To avoid a stale "still online" tail after sign-out, give
-- sessions an ended_at and end them on logout.
--
-- online (server) = a session with ended_at IS NULL and last_seen_at within 2 min.
-- A live heartbeat re-clears ended_at (upsert), so a reconnect un-ends instantly;
-- an explicit logout ends all the user's sessions so they drop immediately.
--
-- Idempotent.

alter table public.user_sessions
  add column if not exists ended_at timestamptz;

-- Heartbeat now also clears ended_at, so re-connecting revives the session.
create or replace function public.session_heartbeat(p_session_id uuid, p_user_agent text default null)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_user uuid;
begin
  select id into v_user
  from public.users
  where id = auth.uid() or auth_user_id = auth.uid()
  limit 1;
  if v_user is null then return; end if;

  perform set_config('app.skip_audit', 'on', true);

  insert into public.user_sessions (id, user_id, started_at, last_seen_at, user_agent, ended_at)
  values (p_session_id, v_user, now(), now(), p_user_agent, null)
  on conflict (id) do update set last_seen_at = now(), ended_at = null;

  update public.users set last_seen_at = now() where id = v_user;
end;
$$;

grant execute on function public.session_heartbeat(uuid, text) to authenticated;

-- End the caller's open sessions (called on sign-out) so they go offline at once.
create or replace function public.end_my_sessions()
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_user uuid;
begin
  select id into v_user
  from public.users
  where id = auth.uid() or auth_user_id = auth.uid()
  limit 1;
  if v_user is null then return; end if;

  perform set_config('app.skip_audit', 'on', true);
  update public.user_sessions set ended_at = now()
  where user_id = v_user and ended_at is null;
end;
$$;

grant execute on function public.end_my_sessions() to authenticated;
