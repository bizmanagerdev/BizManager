-- Fix session_heartbeat identity matching.
--
-- In this schema users.id IS the Supabase auth uid (see AuthGuard, which loads the
-- profile via users.id = auth.uid()). The original session_heartbeat matched only
-- on users.auth_user_id = auth.uid() — a secondary column that isn't populated for
-- every user — so accounts whose auth_user_id ≠ id never recorded a session or
-- updated last_seen, and therefore always looked "offline" (only accounts whose
-- auth_user_id happened to match ever showed active).
--
-- Match on EITHER column so every account heartbeats regardless of which identity
-- convention its row uses.
--
-- Idempotent.

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

  perform set_config('app.skip_audit', 'on', true); -- transaction-local

  insert into public.user_sessions (id, user_id, started_at, last_seen_at, user_agent)
  values (p_session_id, v_user, now(), now(), p_user_agent)
  on conflict (id) do update set last_seen_at = now();

  update public.users set last_seen_at = now() where id = v_user;
end;
$$;

grant execute on function public.session_heartbeat(uuid, text) to authenticated;
