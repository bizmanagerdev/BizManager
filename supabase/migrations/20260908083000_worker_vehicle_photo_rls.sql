-- A worker granted the "vehicles" section (20260907094527) sees a car's details,
-- expenses, tasks and documents (20260907100558 / 20260907102351) — but never
-- its PHOTO. The avatar falls back to the placeholder icon on both /vehicles
-- and /vehicles/[id], for a car that visibly has a picture when an admin looks.
--
-- Root cause: a cover photo is a `documents` row (document_type='vehicle_photo')
-- referenced straight from `vehicles.photo_document_id` — see
-- app/api/vehicles/[id]/photo/route.ts — and deliberately NOT tagged through
-- entity_tags, because it's a single FK slot, not one more file in the car's
-- מסמכים list. Every worker document policy in this schema is scoped through
-- entity_tags (documents_worker_select_vehicle_tagged) or document_links
-- (documents_worker_select_order), so the photo row matched none of them:
-- resolveVehiclePhotoUrls()'s `.from("documents").select("id,storage_key")`
-- returned zero rows under RLS, photoUrl stayed null, and nothing rendered.
--
-- Adds the missing SELECT (the reported gap), plus DELETE so replacing or
-- removing a photo actually cleans the old row up instead of silently
-- affecting 0 rows and orphaning it. Additive and scoped exactly like the
-- sibling vehicle policies: an active, system-access worker with
-- section_access.vehicles = true. Staff are unaffected — their existing
-- full-access policies already cover these rows — and a worker WITHOUT the
-- vehicles section gains nothing.

-- The column only ever existed in the frozen db/sql/create_vehicle_photo.sql,
-- never in a migration; the policies below reference it, and migrations are the
-- source of truth. No-op wherever it's already live (i.e. prod).
alter table public.vehicles
  add column if not exists photo_document_id uuid null references public.documents(id) on delete set null;

create index if not exists vehicles_photo_document_idx on public.vehicles (photo_document_id);

-- Scoped by document_type rather than by "some vehicle points at this row",
-- because the FK is not a reliable predicate at the moments that matter: the
-- upload route inserts the document BEFORE setting vehicles.photo_document_id,
-- and both the replace and the remove path null/repoint the FK BEFORE deleting
-- the old row — an FK-based policy would fail on exactly those statements.
-- 'vehicle_photo' is written by that one route and nothing else.

drop policy if exists "documents_worker_select_vehicle_photo" on public.documents;
create policy "documents_worker_select_vehicle_photo" on public.documents
  for select to authenticated
  using (
    documents.document_type = 'vehicle_photo'
    and exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.role = 'worker'::user_role_enum
        and u.active = true
        and coalesce(u.system_access, false) = true
        and coalesce((u.section_access->>'vehicles')::boolean, false)
    )
  );

drop policy if exists "documents_worker_delete_vehicle_photo" on public.documents;
create policy "documents_worker_delete_vehicle_photo" on public.documents
  for delete to authenticated
  using (
    documents.document_type = 'vehicle_photo'
    and exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.role = 'worker'::user_role_enum
        and u.active = true
        and coalesce(u.system_access, false) = true
        and coalesce((u.section_access->>'vehicles')::boolean, false)
    )
  );
