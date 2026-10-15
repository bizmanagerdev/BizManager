-- ROLLBACK for supabase/migrations/20261015120000_task_overview_view_due_time.sql
-- A column can't be dropped with CREATE OR REPLACE, so the view is recreated
-- as it was before (definition and grants saved 2026-10-15: all privileges to
-- anon, authenticated and service_role — Supabase's defaults; security_invoker
-- keeps the tables' own row rules in charge).

drop view if exists public.task_overview_view;

create view public.task_overview_view
with (security_invoker = true)
as
select
  t.id as task_id,
  t.subject,
  t.status,
  t.priority,
  t.due_date,
  t.project_id,
  p.name as project_name,
  t.assigned_user_id,
  u.full_name as assigned_user_name,
  t.created_at,
  t.updated_at,
  t.due_date < now() and t.status <> 'done'::task_status_enum as is_overdue
from tasks t
  left join users u on u.id = t.assigned_user_id
  left join projects p on p.id = t.project_id;

grant all on public.task_overview_view to anon, authenticated, service_role;
