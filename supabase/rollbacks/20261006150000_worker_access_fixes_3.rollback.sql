-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for supabase/migrations/20261006150000_worker_access_fixes_3.sql
-- Workers can read coworkers' full rows again (as on 2026-10-06).
-- user_directory() and user_labels() stay: the app reads them, and they show
-- nothing beyond names and colours.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists users_worker_view_coworkers on public.users;
create policy users_worker_view_coworkers on public.users for select to authenticated
  using ((((select current_user_role()) = 'worker'::user_role_enum) and (active = true) and (role = any (array['worker'::user_role_enum, 'worker_no_access'::user_role_enum]))));
