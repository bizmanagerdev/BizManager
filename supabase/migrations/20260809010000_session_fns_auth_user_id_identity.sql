-- ════════════════════════════════════════════════════════════════════════════
-- Session functions: match the caller by auth_user_id ONLY.
--
-- WHY
-- 20260629000000_fix_legacy_auth_uid_identity.sql settled the identity question:
-- when users were decoupled from auth, public.users.id became an independent app
-- PK and the auth link moved to public.users.auth_user_id. Every gate was
-- normalised to `auth_user_id = auth.uid()`, which is also how the app reads the
-- profile (lib/auth/requireProfile.ts, lib/auth/requireRouteAccess.ts).
--
-- Two later migrations reintroduced the legacy pattern, as one arm of an OR that
-- also tested auth_user_id, selected with a bare `limit 1`:
--   20260724100000_session_heartbeat_identity_fix.sql  (session_heartbeat)
--   20260726110000_session_end.sql                     (session_heartbeat, end_my_sessions)
--
-- That is not merely redundant, it is unsafe: `limit 1` with no ORDER BY over a
-- two-armed OR is non-deterministic. If one row matches on the PK arm while the
-- caller's own row matches on auth_user_id, Postgres may return EITHER — so a
-- heartbeat or a sign-out can be attributed to a different account, writing that
-- account's user_sessions row and users.last_seen_at (visible as the wrong person
-- in the activity feed / who's-online list).
--
-- Dropping the `id = auth.uid()` arm costs nothing: a caller who cannot be found
-- by auth_user_id cannot have loaded a profile in the first place (requireProfile
-- looks up ONLY auth_user_id), so they never reach these functions.
--
-- This is also what __tests__/security/rls-policies.test.ts guards against, and
-- why it currently fails on those two files.
--
-- Idempotent (create or replace). db/sql is frozen — new schema goes here.
-- ════════════════════════════════════════════════════════════════════════════

-- Heartbeat: records/refreshes the caller's session and stamps last_seen_at.
-- Byte-for-byte the 20260726110000 definition with ONLY the identity WHERE fixed.
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
  where auth_user_id = auth.uid();
  if v_user is null then return; end if;

  perform set_config('app.skip_audit', 'on', true); -- transaction-local

  insert into public.user_sessions (id, user_id, started_at, last_seen_at, user_agent, ended_at)
  values (p_session_id, v_user, now(), now(), p_user_agent, null)
  on conflict (id) do update set last_seen_at = now(), ended_at = null;

  update public.users set last_seen_at = now() where id = v_user;
end;
$$;

grant execute on function public.session_heartbeat(uuid, text) to authenticated;

-- Sign-out: ends the caller's open sessions so they drop offline at once.
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
  where auth_user_id = auth.uid();
  if v_user is null then return; end if;

  perform set_config('app.skip_audit', 'on', true);
  update public.user_sessions set ended_at = now()
  where user_id = v_user and ended_at is null;
end;
$$;

grant execute on function public.end_my_sessions() to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- Before running, confirm no active login depends on the arm being removed.
-- This must return 0 rows; each row would be an account that can sign in but
-- has no auth link, and it needs its auth_user_id backfilled instead.
--
--   select u.id, u.email, u.auth_user_id
--   from public.users u
--   join auth.users a on a.id = u.id
--   where u.auth_user_id is null;
-- ────────────────────────────────────────────────────────────────────────────
