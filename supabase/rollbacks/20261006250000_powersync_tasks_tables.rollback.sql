-- ROLLBACK for supabase/migrations/20261006250000_powersync_tasks_tables.sql

begin;

do $$
declare
  t text;
begin
  foreach t in array array['task_comments', 'document_links'] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync drop table public.%I', t);
    end if;
  end loop;
end $$;

revoke select on table public.task_comments, public.document_links from powersync_role;

-- updated_at back to "any update".
drop trigger if exists task_comments_set_updated_at on public.task_comments;
create trigger task_comments_set_updated_at
  before update on public.task_comments
  for each row execute function public.set_task_comments_updated_at();

drop trigger if exists tasks_privacy_to_comments on public.tasks;
drop function if exists public.tasks_privacy_to_comments();
drop trigger if exists task_comments_copy_task_privacy on public.task_comments;
drop function if exists public.task_comments_copy_task_privacy();

alter table public.task_comments
  drop column if exists task_private_owner_id,
  drop column if exists task_is_private;

commit;
