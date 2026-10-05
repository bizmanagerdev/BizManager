-- ════════════════════════════════════════════════════════════════════════════
-- TEMPORARY. Lets a PowerSync instance (the dev one, 2026-10-05) be tested for
-- real by the connection check (/connection-check): the check adds a row here
-- and times how fast it comes back down PowerSync's sync connection on the
-- phone. Applied by hand in the SQL editor on 2026-10-05.
--
-- WHAT POWERSYNC CAN SEE
-- Only this table. powersync_role may log in and follow the change feed
-- (REPLICATION — how PowerSync replicates; BYPASSRLS — it reads as a service,
-- not as a user), but it holds SELECT on powersync_probe alone, and the
-- `powersync` publication carries only this table. Nothing else in the
-- database is visible to it.
--
-- The role's password is set by hand and never written in this file:
--   alter role powersync_role with password '<random>';
--
-- Undo with the rollback once the test is over.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.powersync_probe (
  id uuid primary key default gen_random_uuid(),
  note text,
  created_at timestamptz not null default now()
);
alter table public.powersync_probe enable row level security;

drop policy if exists powersync_probe_admins on public.powersync_probe;
create policy powersync_probe_admins on public.powersync_probe for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'powersync_role') then
    create role powersync_role with replication bypassrls login;
  end if;
end $$;
grant usage on schema public to powersync_role;
grant select on public.powersync_probe to powersync_role;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'powersync') then
    create publication powersync for table public.powersync_probe;
  end if;
end $$;
