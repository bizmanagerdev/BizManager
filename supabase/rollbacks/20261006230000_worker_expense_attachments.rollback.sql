-- ROLLBACK for supabase/migrations/20261006230000_worker_expense_attachments.sql
-- Back to the 2026-10-06 part-1 rule: orders and accessible tasks only.

alter policy document_links_worker_insert on public.document_links
  with check (((select public.current_user_role()) = 'worker'::user_role_enum)
              and (entity_type = 'order'
                   or (entity_type = 'task' and public.task_can_access(entity_id))));

drop function if exists public.document_uploaded_by_me(uuid);
