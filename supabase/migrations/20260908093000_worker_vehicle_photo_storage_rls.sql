-- Second half of the "a vehicles-access worker can't see the car's photo" fix.
-- 20260908083000 opened the `documents` ROW to him; this opens the FILE.
--
-- storage.objects has exactly three policies today: admin_storage_full (ALL),
-- office_storage_full (ALL) and worker_upload_documents (INSERT). A worker has
-- no SELECT on any object in the bucket at all — so
-- resolveVehiclePhotoUrls()'s createSignedUrls() came back empty even once the
-- documents row was readable, and VehiclePhotoAvatar rendered its placeholder.
--
-- Deliberately scoped to the `vehicles/` prefix, NOT the bucket: everything
-- else in business-documents is payroll, bank statements, invoices and check
-- photos, and a blanket "authenticated can read" here would hand all of it to
-- every worker. Cover photos are written to `vehicles/<tag_id>/<document_id>.<ext>`
-- by app/api/vehicles/[id]/photo/route.ts and nothing else writes there.
--
-- DELETE is included for the same reason it was on the documents row: the photo
-- route removes the old object when a photo is replaced or cleared, and without
-- it a vehicles-access worker's replace would silently orphan the old file.
--
-- NOTE: storage.objects is owned by supabase_storage_admin. If this migration
-- fails with "must be owner of table objects", create the same two policies
-- from the dashboard (Storage → Policies → business-documents) instead.

-- Guarded (2026-09-10, added while getting `supabase start` to actually pass
-- in CI): supabase/config.toml has [storage] enabled = false ("Trimmed for
-- E2E stability" - fewer containers, avoids the Docker crashes that motivated
-- disabling it), so storage.objects doesn't exist on a from-scratch local/CI
-- stack at all - a bare CREATE POLICY on it fails with "relation does not
-- exist" there. Dynamic SQL + an existence check makes this a no-op in that
-- environment while behaving exactly as before anywhere storage IS enabled
-- (production, or a local stack with storage re-enabled per config.toml's own
-- "re-enable if a test needs file upload/download" note).
do $storage_guard$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  execute 'drop policy if exists "worker_read_vehicle_photos" on storage.objects';
  execute $ddl$
    create policy "worker_read_vehicle_photos" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'business-documents'
        and name like 'vehicles/%'
        and exists (
          select 1 from public.users u
          where u.auth_user_id = (select auth.uid())
            and u.role = 'worker'::user_role_enum
            and u.active = true
            and coalesce(u.system_access, false) = true
            and coalesce((u.section_access->>'vehicles')::boolean, false)
        )
      )
  $ddl$;

  execute 'drop policy if exists "worker_delete_vehicle_photos" on storage.objects';
  execute $ddl$
    create policy "worker_delete_vehicle_photos" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'business-documents'
        and name like 'vehicles/%'
        and exists (
          select 1 from public.users u
          where u.auth_user_id = (select auth.uid())
            and u.role = 'worker'::user_role_enum
            and u.active = true
            and coalesce(u.system_access, false) = true
            and coalesce((u.section_access->>'vehicles')::boolean, false)
        )
      )
  $ddl$;
end
$storage_guard$;
