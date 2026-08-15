-- ════════════════════════════════════════════════════════════════════════════
-- Let a worker see the NAME of a project he worked on.
--
-- His shift list says "פרויקטים" — the business domain — which is the same word
-- on every project row and tells him nothing about which job it was. The name
-- lives in public.projects, and his only read there is
-- `worker_view_assigned_projects`: projects he has a TASK on. Hours are not
-- tasks, so a project he spent a week driving for stays anonymous to him.
--
-- Adds exactly the missing case: a project he has an attendance session on.
-- Read-only, and scoped to his OWN sessions — this is not a list of the
-- company's projects, it's the names of the ones he was paid for.
--
-- Idempotent / safe to re-run. Run in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "projects_worker_view_own_sessions" on public.projects;
create policy "projects_worker_view_own_sessions"
on public.projects
for select
to authenticated
using (
  public.current_user_role() = 'worker'::user_role_enum
  and exists (
    select 1
    from public.attendance_sessions s
    where s.project_id = projects.id
      and s.user_id = public.current_app_user_id()
  )
);
