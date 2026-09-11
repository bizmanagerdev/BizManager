-- worker_update_own_tasks compares assigned_user_id (an app-PK public.users.id)
-- directly against auth.uid() (the Supabase AUTH uid) — two different UUID
-- spaces. The sibling policy on this exact same table, tasks_privacy_restrict,
-- already does this correctly via task_current_user_id() (auth_user_id ->
-- users.id lookup); this one was just never brought in line.
--
-- For a worker created the normal way — via admin_upsert_user_profile in the
-- Salary Center, where users.id is a FRESHLY GENERATED uuid distinct from
-- auth_user_id — assigned_user_id = auth.uid() can never be true. The update
-- silently matches 0 rows under RLS (Supabase returns {data: null, error:
-- null}, not an error), so a worker dragging/completing his OWN assigned task
-- on the board does nothing and looks like a UI bug. Confirmed live: of the
-- app's 3 real active `role = 'worker'` users, 2 have id <> auth_user_id and
-- hit this every time.
--
-- Idempotent (drop-if-exists first).

drop policy if exists "worker_update_own_tasks" on public.tasks;

create policy "worker_update_own_tasks" on public.tasks
  for update
  using (assigned_user_id = (select public.task_current_user_id()));
