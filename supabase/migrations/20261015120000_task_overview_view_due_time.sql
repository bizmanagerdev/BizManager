-- task_overview_view carries the task's due hour (tasks.due_time), so the
-- project page's tasks and the global search show it like every other task
-- list (owner, 2026-10-15: "every place is a date I want also the hour").
--
-- The column is appended LAST: CREATE OR REPLACE VIEW may only add columns at
-- the end. Everything else is the view exactly as it was.

create or replace view public.task_overview_view
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
  t.due_date < now() and t.status <> 'done'::task_status_enum as is_overdue,
  t.due_time
from tasks t
  left join users u on u.id = t.assigned_user_id
  left join projects p on p.id = t.project_id;
