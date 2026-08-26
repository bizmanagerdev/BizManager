-- Board position within a status column, for free drag-reorder (persisted).
-- Mirrors lib/tasks/sortOrder.ts computeDefaultSortOrder: date-aware sorting
-- is a TODO-only thing (a due date this year or earlier sorts chronologically;
-- next year or later is pushed to the very end) — every other column
-- (in_progress/done/blocked), and a todo task with no due date, just gets a
-- plain "order added" baseline (created_at) for this one-time backfill; going
-- forward the app places new same-column tasks above whatever's already there.
alter table public.tasks add column if not exists sort_order double precision;

update public.tasks
set sort_order = case
  when coalesce(status, 'todo') = 'todo' and due_date is not null and extract(year from due_date) > extract(year from now()) then
    10000000000000 + extract(epoch from due_date) * 1000
  when coalesce(status, 'todo') = 'todo' and due_date is not null then
    extract(epoch from due_date) * 1000
  else
    extract(epoch from created_at) * 1000
end
where sort_order is null;

create index if not exists idx_tasks_status_sort_order on public.tasks (status, sort_order);

-- A drag-reorder inside the same column only moves sort_order — not a change
-- worth an audit-log row (every card drag would otherwise flood the task's
-- history with content-free "עודכן" entries, the same noise pattern already
-- fixed elsewhere for heartbeats/reminders). RLS still applies (security
-- invoker, default): a row this caller can't update per the existing tasks
-- UPDATE policy is simply left unaffected, same as a direct PostgREST update.
create or replace function public.set_task_sort_order(p_task_id uuid, p_sort_order double precision)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform set_config('app.skip_audit', 'on', true);
  update public.tasks set sort_order = p_sort_order where id = p_task_id;
end;
$$;

grant execute on function public.set_task_sort_order(uuid, double precision) to authenticated;
