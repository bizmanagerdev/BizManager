-- A worker granted the "vehicles" section (20260907094527) can reach
-- /vehicles/[id] and see its tasks fine, but the Expenses/Documents cards
-- there came up empty even when expenses/documents genuinely exist and are
-- tagged to the vehicle. Root cause: expenses/documents SELECT has no
-- per-vehicle scoping concept at all —
--   expenses: admin_full_access (is_admin), expenses_office_full (role=office),
--     expenses_worker_select_own (recorded_by = auth.uid()) — ownership only.
--   documents: documents_worker_select_order scopes to document_links for
--     orders only; vehicle docs are linked via entity_tags, not document_links,
--     so a worker had NO select policy covering them at all.
-- entity_tags/tags reads are already open to any authenticated user (see
-- create_tags_and_vehicles.sql), so the id lookup in fetchVehicleActivity()
-- worked — it's the follow-up `.from("expenses"/"documents").select(...).in("id", ...)`
-- that silently returned zero rows under RLS.
--
-- Adds a SELECT-only, additive policy per table (existing policies are
-- untouched — Postgres OR-combines multiple permissive policies on the same
-- command) scoped to: viewer is an active, system-access worker with
-- section_access.vehicles = true, AND the row is tagged (via entity_tags) to
-- a tag of kind='vehicle'. Matches "full same access as admin/office" for
-- vehicles specifically — read-only additions here, since the reported gap
-- was "can't see", not "can't add"; a worker can already insert/update his
-- own expenses via the existing worker_insert/worker_update_own_expenses
-- policies, unaffected by this change.

create policy "expenses_worker_select_vehicle_tagged" on public.expenses
  for select to authenticated
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

create policy "documents_worker_select_vehicle_tagged" on public.documents
  for select to authenticated
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
