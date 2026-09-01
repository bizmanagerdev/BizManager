-- ════════════════════════════════════════════════════════════════════════════
-- Tighten tags/entity_tags RLS ahead of moving their read paths from an app
-- API route to a direct client → Supabase call.
--
-- WHY THIS IS NEEDED NOW, NOT BEFORE
-- Until now, `GET /api/tags/list` and `GET /api/entity-tags/list` sat in front
-- of these tables, gated by `requireRouteAccess({ allowedRoles: ["admin",
-- "office","worker"] })` — which also requires the caller's `users` row to be
-- `active` and have `system_access`. The underlying RLS policies (from
-- db/sql/create_tags_and_vehicles.sql) only ever said `using (true)` for
-- reads — broader than the app check, but harmless AS LONG AS every read
-- went through the route first. Once the client reads these tables directly,
-- RLS becomes the ONLY gate, so it needs to actually match what the app was
-- enforcing, not just "any authenticated session."
--
-- This is a TIGHTENING, not a widening: nothing that could read tags/
-- entity_tags today loses access (every current caller already satisfies the
-- role/active/system_access check, since it had to pass requireRouteAccess
-- first) — the only behavior change is that a Supabase session belonging to
-- a deactivated account, a `system_access=false` account, or `worker_no_access`
-- can no longer read these tables directly, which matches, rather than
-- weakens, today's real access.
--
-- Idempotent (drop-if-exists + create). db/sql is frozen; new schema goes here.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "Read tags" on public.tags;
create policy "Read tags" on public.tags
  for select to authenticated
  using (exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office', 'worker')
      and u.active = true
      and coalesce(u.system_access, false) = true
  ));

-- entity_tags kept as ONE "for all" policy (matching its original shape) —
-- only the condition is tightened, so every existing write path (create/
-- attach/detach, still going through their own app routes) keeps working
-- exactly as before; only bare-session access without a real staff row stops
-- being possible.
drop policy if exists "Authenticated use entity_tags" on public.entity_tags;
create policy "Authenticated use entity_tags" on public.entity_tags
  for all to authenticated
  using (exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office', 'worker')
      and u.active = true
      and coalesce(u.system_access, false) = true
  ))
  with check (exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office', 'worker')
      and u.active = true
      and coalesce(u.system_access, false) = true
  ));
