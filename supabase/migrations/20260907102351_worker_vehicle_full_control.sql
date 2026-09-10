-- A worker granted the "vehicles" section (20260907094527) gets the SELECT
-- side of expenses/documents tagged to a vehicle (20260907100558), but not the
-- write side: he can add his own expense/document (the existing worker_insert
-- policies aren't tag-scoped, so those already worked), but editing/deleting
-- one recorded by someone else — or deleting anything at all, since there is
-- no worker delete policy on expenses/documents/tasks anywhere in this schema
-- today — silently affects 0 rows under RLS. "Full same access as
-- admin/office" for vehicles (the standing rule from 20260907094527) was only
-- carried to the vehicles/tags tables themselves; expenses, documents and
-- tasks tagged to a car were missed.
--
-- Adds UPDATE/DELETE, additive and scoped exactly like the SELECT policies:
-- viewer is an active, system-access worker with section_access.vehicles =
-- true, AND the row is tagged (via entity_tags) to a tag of kind='vehicle'.
-- Does NOT touch expense/document/task rows unrelated to a vehicle, and does
-- NOT grant a plain worker (without vehicles access) anything new.

-- Drop-first guards (added 2026-09-10 during the migration-baseline backfill
-- — see foundation-hardening memory): CREATE POLICY has no IF NOT EXISTS/OR
-- REPLACE, and baseline.sql already captures all 5 of these policies as this
-- migration's own (verified live) end state, so a from-scratch replay hit
-- "already exists" without these.
drop policy if exists "expenses_worker_update_vehicle_tagged" on public.expenses;
drop policy if exists "expenses_worker_delete_vehicle_tagged" on public.expenses;
drop policy if exists "documents_worker_delete_vehicle_tagged" on public.documents;
drop policy if exists "tasks_worker_update_vehicle_tagged" on public.tasks;
drop policy if exists "tasks_worker_delete_vehicle_tagged" on public.tasks;

create policy "expenses_worker_update_vehicle_tagged" on public.expenses
  for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.role = 'worker'::user_role_enum
        and u.active = true
        and coalesce(u.system_access, false) = true
        and coalesce((u.section_access->>'vehicles')::boolean, false)
    )
    and exists (
      select 1 from public.entity_tags et
      join public.tags t on t.id = et.tag_id
      where et.entity_type = 'expense'
        and et.entity_id = expenses.id
        and t.kind = 'vehicle'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.role = 'worker'::user_role_enum
        and u.active = true
        and coalesce(u.system_access, false) = true
        and coalesce((u.section_access->>'vehicles')::boolean, false)
    )
    and exists (
      select 1 from public.entity_tags et
      join public.tags t on t.id = et.tag_id
      where et.entity_type = 'expense'
        and et.entity_id = expenses.id
        and t.kind = 'vehicle'
    )
  );

create policy "expenses_worker_delete_vehicle_tagged" on public.expenses
  for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.role = 'worker'::user_role_enum
        and u.active = true
        and coalesce(u.system_access, false) = true
        and coalesce((u.section_access->>'vehicles')::boolean, false)
    )
    and exists (
      select 1 from public.entity_tags et
      join public.tags t on t.id = et.tag_id
      where et.entity_type = 'expense'
        and et.entity_id = expenses.id
        and t.kind = 'vehicle'
    )
  );

create policy "documents_worker_delete_vehicle_tagged" on public.documents
  for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.role = 'worker'::user_role_enum
        and u.active = true
        and coalesce(u.system_access, false) = true
        and coalesce((u.section_access->>'vehicles')::boolean, false)
    )
    and exists (
      select 1 from public.entity_tags et
      join public.tags t on t.id = et.tag_id
      where et.entity_type = 'document'
        and et.entity_id = documents.id
        and t.kind = 'vehicle'
    )
  );

-- tasks: worker_update_own_tasks (assigned_user_id = self) already covers a
-- vehicle task assigned to the worker himself; this adds the "not mine but
-- tagged to a car I manage" case (assigned to someone else, or unassigned),
-- plus delete, which had no worker policy at all.
create policy "tasks_worker_update_vehicle_tagged" on public.tasks
  for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.role = 'worker'::user_role_enum
        and u.active = true
        and coalesce(u.system_access, false) = true
        and coalesce((u.section_access->>'vehicles')::boolean, false)
    )
    and exists (
      select 1 from public.entity_tags et
      join public.tags t on t.id = et.tag_id
      where et.entity_type = 'task'
        and et.entity_id = tasks.id
        and t.kind = 'vehicle'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.role = 'worker'::user_role_enum
        and u.active = true
        and coalesce(u.system_access, false) = true
        and coalesce((u.section_access->>'vehicles')::boolean, false)
    )
    and exists (
      select 1 from public.entity_tags et
      join public.tags t on t.id = et.tag_id
      where et.entity_type = 'task'
        and et.entity_id = tasks.id
        and t.kind = 'vehicle'
    )
  );

create policy "tasks_worker_delete_vehicle_tagged" on public.tasks
  for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.role = 'worker'::user_role_enum
        and u.active = true
        and coalesce(u.system_access, false) = true
        and coalesce((u.section_access->>'vehicles')::boolean, false)
    )
    and exists (
      select 1 from public.entity_tags et
      join public.tags t on t.id = et.tag_id
      where et.entity_type = 'task'
        and et.entity_id = tasks.id
        and t.kind = 'vehicle'
    )
  );
