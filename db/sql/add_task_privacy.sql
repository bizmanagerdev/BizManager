-- Run this in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Private tasks: a task can be marked private to a single owner. When is_private
-- is true ONLY private_owner_id can see/manage it — not other workers, and not
-- even office/admin. Enforced at the DB with a RESTRICTIVE RLS policy (which is
-- AND-combined with the existing permissive task policies, so it can only
-- subtract private rows, never widen access) plus the shared task_* helpers.

alter table public.tasks
  add column if not exists is_private boolean not null default false,
  add column if not exists private_owner_id uuid references public.users(id) on delete set null;

create index if not exists idx_tasks_private_owner
  on public.tasks (private_owner_id) where is_private;

-- ─── RESTRICTIVE privacy policy on tasks ─────────────────────────────────────────
alter table public.tasks enable row level security;

drop policy if exists tasks_privacy_restrict on public.tasks;
create policy tasks_privacy_restrict on public.tasks
  as restrictive for all to authenticated
  using (coalesce(is_private, false) = false or private_owner_id = public.task_current_user_id())
  with check (coalesce(is_private, false) = false or private_owner_id = public.task_current_user_id());

-- ─── Keep the shared helpers consistent so a private task's members / comments /
--     reminders are hidden from non-owners too (these helpers back those RLS
--     policies; task_can_access is SECURITY DEFINER and reads tasks directly). ──────
create or replace function public.task_can_access(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and case
        when coalesce(t.is_private, false)
          then t.private_owner_id = public.task_current_user_id()
        else
          public.task_is_office_admin()
          or t.assigned_user_id = public.task_current_user_id()
          or exists (
            select 1 from public.task_members m
            where m.task_id = t.id and m.user_id = public.task_current_user_id()
          )
      end
  );
$$;

create or replace function public.task_can_manage(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and case
        when coalesce(t.is_private, false)
          then t.private_owner_id = public.task_current_user_id()
        else
          public.task_is_office_admin()
          or t.assigned_user_id = public.task_current_user_id()
      end
  );
$$;
