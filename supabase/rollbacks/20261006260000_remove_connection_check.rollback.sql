-- ROLLBACK for supabase/migrations/20261006260000_remove_connection_check.sql
-- Recreates the two tables as their migrations made them (empty — the removed
-- rows don't come back): 20261005200000_connection_checks.sql and the
-- powersync_probe part of 20261005210000_powersync_probe.sql.

begin;

create table if not exists public.connection_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.current_app_user_id() references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  opened_in text,
  user_agent text,
  all_passed boolean not null default false,
  results jsonb not null default '{}'::jsonb,
  report text
);
create index if not exists connection_checks_created_at_idx on public.connection_checks (created_at desc);
alter table public.connection_checks enable row level security;
drop policy if exists connection_checks_insert_own on public.connection_checks;
create policy connection_checks_insert_own on public.connection_checks
  for insert to authenticated
  with check (user_id = (select public.current_app_user_id()) and (select public.is_admin()));
drop policy if exists connection_checks_admin_read on public.connection_checks;
create policy connection_checks_admin_read on public.connection_checks
  for select to authenticated
  using ((select public.is_admin()));
-- Explicit grants: new tables no longer get them by default (supabase/migrations/README.md).
grant select, insert on public.connection_checks to authenticated;

create table if not exists public.powersync_probe (
  id uuid primary key default gen_random_uuid(),
  note text,
  created_at timestamptz not null default now()
);
alter table public.powersync_probe enable row level security;
drop policy if exists powersync_probe_admins on public.powersync_probe;
create policy powersync_probe_admins on public.powersync_probe for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.powersync_probe to authenticated;
grant select on public.powersync_probe to powersync_role;
alter publication powersync add table public.powersync_probe;

commit;
