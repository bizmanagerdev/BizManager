-- ════════════════════════════════════════════════════════════════════════════
-- TEMPORARY. A table for the results of the connection check (/connection-check,
-- 2026-10-05): what each phone's network and content filter (NetFree, Hadran…)
-- let the app do — live connections, new web addresses, storage on the device —
-- before choosing how the app's data syncs onto devices.
--
-- WHO CAN DO WHAT (the check is for admins only)
-- - An admin records their OWN result (user_id is filled in from who is signed
--   in, and the policy refuses any other id or any non-admin).
-- - Only admins read results (the admin results page). Nobody updates or
--   deletes rows through the API.
-- Nothing else in the database changes.
--
-- Drop the table (see the rollback) once the check comes out of the app.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.connection_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.current_app_user_id() references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Android app / installed web app / browser
  opened_in text,
  user_agent text,
  all_passed boolean not null default false,
  -- { checkId: { status, detail } } exactly as the page showed them
  results jsonb not null default '{}'::jsonb,
  -- the same results as the text the page offers to copy
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
