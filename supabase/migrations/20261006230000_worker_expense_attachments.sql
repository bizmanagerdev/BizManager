-- ════════════════════════════════════════════════════════════════════════════
-- Workers can attach a receipt to a vehicle expense.
--
-- BEFORE: a worker's file could only be LINKED to an order or a task. A
-- receipt on an expense (the vehicle page's expense dialog) is linked to the
-- expense — and to its project / property / customer when it has one — so the
-- link was refused and the whole upload failed, every time.
--
-- AFTER: a worker may also link a file to
--   - an expense they can see (their own, or a vehicle's if they have the
--     vehicles section — the expense rules decide), and
--   - that expense's project / property / customer,
-- but only a file THEY uploaded (document_uploaded_by_me) — never someone
-- else's document. Order and task links are unchanged.
--
-- ROLLBACK: supabase/rollbacks/20261006230000_worker_expense_attachments.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- Reads documents with the database's rights: a worker can't SELECT a file
-- they've just uploaded until it has a link, which is the very thing being
-- inserted.
create or replace function public.document_uploaded_by_me(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document_id
      and d.uploaded_by = public.current_app_user_id()
  );
$$;
revoke all on function public.document_uploaded_by_me(uuid) from public, anon;
grant execute on function public.document_uploaded_by_me(uuid) to authenticated, service_role;

alter policy document_links_worker_insert on public.document_links
  with check (
    ((select public.current_user_role()) = 'worker'::user_role_enum)
    and (
      entity_type = 'order'
      or (entity_type = 'task' and public.task_can_access(entity_id))
      or (
        entity_type = 'expense'
        and public.document_uploaded_by_me(document_id)
        and exists (select 1 from public.expenses e where e.id = document_links.entity_id)
      )
      or (
        entity_type in ('project', 'property', 'customer')
        and public.document_uploaded_by_me(document_id)
      )
    )
  );
