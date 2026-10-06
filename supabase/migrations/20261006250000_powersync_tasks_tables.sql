-- ════════════════════════════════════════════════════════════════════════════
-- PowerSync: also follow task_comments and document_links, for the tasks
-- board (each card's comment count and paperclip). Read-only access for
-- powersync_role; devices get them only through powersync/sync-config.yaml,
-- admins and office only.
--
-- A comment may be read exactly when its task may be (task_can_access): for
-- admins and office, a task that isn't private, or their own private task. A
-- sync stream can't look the task up for each comment, so each comment keeps
-- a copy of its task's privacy:
--   task_is_private        — the task's is_private
--   task_private_owner_id  — the task's private_owner_id, when private
-- filled in when the comment is written, and refreshed when a task's privacy
-- changes. That refresh is bookkeeping, not an edit: it doesn't touch the
-- comment's updated_at and isn't written to the audit log.
--
-- ROLLBACK: supabase/rollbacks/20261006250000_powersync_tasks_tables.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.task_comments
  add column if not exists task_is_private boolean not null default false,
  add column if not exists task_private_owner_id uuid;

-- A new comment (or one moved to another task) takes its task's privacy.
create or replace function public.task_comments_copy_task_privacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select coalesce(t.is_private, false), case when coalesce(t.is_private, false) then t.private_owner_id end
    into new.task_is_private, new.task_private_owner_id
  from public.tasks t
  where t.id = new.task_id;
  new.task_is_private := coalesce(new.task_is_private, false);
  return new;
end;
$$;

drop trigger if exists task_comments_copy_task_privacy on public.task_comments;
create trigger task_comments_copy_task_privacy
  before insert or update of task_id on public.task_comments
  for each row execute function public.task_comments_copy_task_privacy();

-- A task made private / public / given to another owner: its comments follow.
create or replace function public.tasks_privacy_to_comments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_private boolean := coalesce(new.is_private, false);
  v_owner uuid := case when coalesce(new.is_private, false) then new.private_owner_id end;
  v_skip_audit text := current_setting('app.skip_audit', true);
begin
  perform set_config('app.skip_audit', 'on', true);
  update public.task_comments c
     set task_is_private = v_private,
         task_private_owner_id = v_owner
   where c.task_id = new.id
     and (c.task_is_private is distinct from v_private or c.task_private_owner_id is distinct from v_owner);
  perform set_config('app.skip_audit', coalesce(v_skip_audit, ''), true);
  return null;
end;
$$;

drop trigger if exists tasks_privacy_to_comments on public.tasks;
create trigger tasks_privacy_to_comments
  after update of is_private, private_owner_id on public.tasks
  for each row
  when (old.is_private is distinct from new.is_private or old.private_owner_id is distinct from new.private_owner_id)
  execute function public.tasks_privacy_to_comments();

-- updated_at means "the comment was edited" — not "its task's privacy was copied".
drop trigger if exists task_comments_set_updated_at on public.task_comments;
create trigger task_comments_set_updated_at
  before update on public.task_comments
  for each row
  when (old.task_is_private is not distinct from new.task_is_private
        and old.task_private_owner_id is not distinct from new.task_private_owner_id)
  execute function public.set_task_comments_updated_at();

-- The comments already there — only those whose copy differs (comments on
-- private tasks): an update that leaves the copy as it was would count as an
-- edit and move updated_at. (Run 2026-10-06 without that condition, it moved
-- all 33 comments' updated_at; they were put back to created_at — no comment
-- had ever been edited, the app has no way to.)
select set_config('app.skip_audit', 'on', true);
update public.task_comments c
   set task_is_private = coalesce(t.is_private, false),
       task_private_owner_id = case when coalesce(t.is_private, false) then t.private_owner_id end
  from public.tasks t
 where t.id = c.task_id
   and (c.task_is_private is distinct from coalesce(t.is_private, false)
        or c.task_private_owner_id is distinct from case when coalesce(t.is_private, false) then t.private_owner_id end);
select set_config('app.skip_audit', '', true);

grant select on table public.task_comments, public.document_links to powersync_role;

do $$
declare
  t text;
begin
  foreach t in array array['task_comments', 'document_links'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync add table public.%I', t);
    end if;
  end loop;
end $$;

commit;
