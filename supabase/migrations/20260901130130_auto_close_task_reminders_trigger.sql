-- ════════════════════════════════════════════════════════════════════════════
-- Port "closing a task closes its pending reminders" from app code into a DB
-- trigger, so the rule holds no matter how tasks.status gets written — not just
-- through /api/tasks/update-status.
--
-- WHY NOW
-- This was the last blocker noted against moving the Trello board's status
-- drag to a direct-to-Supabase write (see [[hybrid-direct-supabase-routes]]):
-- today only app code (app/api/tasks/update-status/route.ts) closes a task's
-- PENDING reminders when it lands on 'done'/'cancelled'. A direct client write
-- to tasks.status would skip that step entirely without this trigger.
--
-- SECURITY INVOKER (default, stated explicitly) is deliberate: the existing app
-- code runs this close on the SAME RLS-bound client as the status update
-- itself, so it only ever closes the reminders the calling user's own RLS
-- policies on `reminders` already let them touch (a reminder someone else set
-- for themselves about this task is theirs to clear, not auto-closed by
-- whoever finished the task — see the route's own comment, preserved here).
-- A SECURITY DEFINER trigger would bypass that and is NOT what we want.
--
-- Fires only on a genuine transition INTO a closed status (OLD.status IS
-- DISTINCT FROM NEW.status) — a slight improvement over the app code, which
-- re-attempted the (harmless, zero-row) close on every subsequent edit of an
-- already-closed task.
--
-- Idempotent (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.close_task_reminders_on_status_close()
returns trigger
language plpgsql
security invoker
as $function$
begin
  if new.status in ('done', 'cancelled') and old.status is distinct from new.status then
    update public.reminders
    set status = 'done',
        updated_by = (select id from public.users where auth_user_id = auth.uid())
    where task_id = new.id
      and status = 'pending';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_close_task_reminders_on_status_close on public.tasks;
create trigger trg_close_task_reminders_on_status_close
  after update on public.tasks
  for each row
  execute function public.close_task_reminders_on_status_close();
