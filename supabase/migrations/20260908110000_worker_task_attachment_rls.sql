-- Attachments on a task are invisible to every worker — including on the car's
-- own page, since TaskUpsertDialog (the same dialog /tasks uses) is what opens
-- a vehicle task.
--
-- /api/tasks/attachments/list reads document_links → documents → a signed URL,
-- all under the caller's session. A worker fails at the FIRST step: the only
-- worker policy on document_links is document_links_worker_select_order, which
-- is `entity_type = 'order'`. Task links match nothing, the route returns
-- `attachments: []`, and the dialog shows an empty attachments section for a
-- task that visibly has files when staff open it. The two downstream gates
-- (documents_worker_select_order is orders-only; storage.objects gives workers
-- SELECT only under `vehicles/%`) would each have blocked it too.
--
-- Scoping comes from `tasks` itself: a policy expression is evaluated as the
-- querying user, so the `exists (… from public.tasks …)` below is filtered by
-- that worker's own task policies. He sees attachments on exactly the tasks he
-- can already see — his own, and the ones tagged to a car he manages — and
-- nothing on a task RLS hides from him. That's the same layering the existing
-- documents_worker_select_order ↔ document_links_worker_select_order pair
-- relies on.

drop policy if exists "document_links_worker_select_task" on public.document_links;
create policy "document_links_worker_select_task" on public.document_links
  for select to authenticated
  using (
    entity_type = 'task'
    and (select public.current_user_role()) = 'worker'::user_role_enum
    and exists (
      select 1 from public.tasks t
      where t.id = document_links.entity_id
    )
  );

drop policy if exists "documents_worker_select_task_linked" on public.documents;
create policy "documents_worker_select_task_linked" on public.documents
  for select to authenticated
  using (
    (select public.current_user_role()) = 'worker'::user_role_enum
    and exists (
      select 1 from public.document_links dl
      where dl.document_id = documents.id
        and dl.entity_type = 'task'
    )
  );

-- The file itself. Unlike worker_read_vehicle_photos (20260908093000), which is
-- a bare path prefix, this one ALSO requires a readable `documents` row for the
-- object: task attachments include files from tasks a worker must not see
-- (private tasks, other people's), so `name like 'tasks/%'` alone would let him
-- sign any of them. documents.storage_key is UNIQUE, so the lookup is an index
-- hit. No DELETE — removing an attachment is not a worker affordance.
-- Guarded (2026-09-10 - see the matching note in
-- 20260908093000_worker_vehicle_photo_storage_rls.sql): storage.objects
-- doesn't exist when supabase/config.toml has [storage] enabled = false, so
-- this is a no-op there and unchanged everywhere storage is enabled.
do $storage_guard$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  execute 'drop policy if exists "worker_read_task_attachments" on storage.objects';
  execute $ddl$
    create policy "worker_read_task_attachments" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'business-documents'
        and name like 'tasks/%'
        and (select public.current_user_role()) = 'worker'::user_role_enum
        and exists (
          select 1 from public.documents d
          where d.storage_key = storage.objects.name
        )
      )
  $ddl$;
end
$storage_guard$;
