-- ════════════════════════════════════════════════════════════════════════════
-- WHEN did it finish? — real completion timestamps on tasks, projects, orders
-- and payments.
--
-- Until now none of these four tables recorded the MOMENT a thing finished.
-- `tasks.status = 'done'` says it is done; nothing said when it became done.
-- Same for a completed project, a closed order, and a cleared (deposited)
-- check. Any "how many closed last week" question had to be answered from
-- `audit_logs`, which does carry the time (`audit_logs.created_at` on the row
-- that flipped the status) — that part works, and it is where this migration
-- gets its history from.
--
-- What it does NOT want to do is depend on that log forever:
--   • `business_settings.audit_logging_enabled` disables every log_changes
--     trigger at the schema level, and then the answer silently disappears.
--   • The log is unbounded append-only history; pruning or archiving it would
--     take the business answer with it.
--   • Answering from it means a jsonb scan over every change ever made,
--     instead of an index range-scan on a date.
--
-- So: read the transition out of the log ONCE, store it on the row, and keep it
-- current with a trigger from here on. The log goes back to being an audit
-- trail rather than a load-bearing source of business figures.
--
-- Idempotent; safe to re-run (the backfill only fills rows still NULL).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.tasks     add column if not exists completed_at timestamptz;
alter table public.projects  add column if not exists completed_at timestamptz;
alter table public.orders    add column if not exists closed_at    timestamptz;
-- Named for what it tracks — payment_status reaching 'cleared' — not for
-- "deposited": a check being deposited is the case that prompted it, but the
-- column is true for any payment that clears.
alter table public.payments  add column if not exists cleared_at   timestamptz;

comment on column public.tasks.completed_at is
  'When status last became ''done''. Cleared when the task leaves ''done''. Maintained by trg_set_task_completed_at.';
comment on column public.projects.completed_at is
  'When status last became ''completed''. Cleared when the project leaves it. Maintained by trg_set_project_completed_at.';
comment on column public.orders.closed_at is
  'When the order last reached a closed status (delivered/completed/closed) — NOT cancelled. Maintained by trg_set_order_closed_at.';
comment on column public.payments.cleared_at is
  'When payment_status last became ''cleared'' — for a check, when it was deposited. Maintained by trg_set_payment_cleared_at.';

-- Partial indexes: every query against these columns is "finished between X and
-- Y", so the rows that never finished are dead weight in the index.
create index if not exists tasks_completed_at_idx    on public.tasks (completed_at)    where completed_at is not null;
create index if not exists projects_completed_at_idx on public.projects (completed_at) where completed_at is not null;
create index if not exists orders_closed_at_idx      on public.orders (closed_at)      where closed_at is not null;
create index if not exists payments_cleared_at_idx   on public.payments (cleared_at)   where cleared_at is not null;

-- ── "Closed" for an order ───────────────────────────────────────────────────
-- The mirror of the existing order_status_is_open(), MINUS 'cancelled': an
-- order that was cancelled did not close, and must never be counted as one.
-- Both the Hebrew and the English status spellings are live in this table.
create or replace function public.order_status_is_closed(p_status text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_status, '') in (
    'delivered', 'completed', 'closed',
    'סופקה', 'הושלמה', 'סגורה'
  );
$$;

-- ── Triggers ────────────────────────────────────────────────────────────────
-- All four share one shape:
--   INSERT — born finished? stamp it.
--   UPDATE — only when the status ACTUALLY changed: entering the finished state
--            stamps now(), leaving it clears the stamp.
-- An update that leaves the status alone never touches the column, which is
-- what lets the backfill below write straight through these triggers.
--
-- now() is the statement timestamp, so it matches the audit_logs row written by
-- log_changes in the same transaction.

create or replace function public.set_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'done' then new.completed_at := now(); end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'done' then now() else null end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_task_completed_at on public.tasks;
create trigger trg_set_task_completed_at
  before insert or update on public.tasks
  for each row execute function public.set_task_completed_at();

create or replace function public.set_project_completed_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed' then new.completed_at := now(); end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'completed' then now() else null end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_project_completed_at on public.projects;
create trigger trg_set_project_completed_at
  before insert or update on public.projects
  for each row execute function public.set_project_completed_at();

create or replace function public.set_order_closed_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if public.order_status_is_closed(new.status) then new.closed_at := now(); end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    new.closed_at := case when public.order_status_is_closed(new.status) then now() else null end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_order_closed_at on public.orders;
create trigger trg_set_order_closed_at
  before insert or update on public.orders
  for each row execute function public.set_order_closed_at();

create or replace function public.set_payment_cleared_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.payment_status = 'cleared' then new.cleared_at := now(); end if;
    return new;
  end if;
  if new.payment_status is distinct from old.payment_status then
    new.cleared_at := case when new.payment_status = 'cleared' then now() else null end;
  end if;
  return new;
end;
$$;

-- Sorts after trg_protect_payments, so that trigger's "workers cannot modify
-- payments" check still runs first (Postgres fires BEFORE triggers in name
-- order). Nothing depends on it, but the cheap guard belongs first.
drop trigger if exists trg_set_payment_cleared_at on public.payments;
create trigger trg_set_payment_cleared_at
  before insert or update on public.payments
  for each row execute function public.set_payment_cleared_at();

-- ── Backfill from the audit log ─────────────────────────────────────────────
-- The history is already there with its timestamps; this is the one read of it.
--
-- For each row, the MOST RECENT entry INTO the finished state — "most recent"
-- because a project closed, reopened and closed again finished on the second
-- date, not the first. Rows not currently in that state are skipped entirely:
-- their stamp belongs to a state they have since left.
--
-- Only fills NULLs, so a re-run cannot overwrite a live value, and the status
-- is deliberately left untouched so the BEFORE triggers above stay inert.
do $$
begin
  -- These writes are a data migration, not someone changing a task. Without
  -- this, the backfill would push one audit row per affected record into
  -- audit_logs and bury the real history under itself. log_changes honours the
  -- flag (see its first statement); `set local` scopes it to this transaction.
  set local app.skip_audit = 'on';

  with entries as (
    select al.record_id, al.created_at,
           row_number() over (partition by al.record_id order by al.created_at desc) as rn
    from public.audit_logs al
    where al.table_name = 'tasks'
      and al.new_data->>'status' = 'done'
      and (al.old_data is null or al.old_data->>'status' is distinct from 'done')
  )
  update public.tasks t
     set completed_at = e.created_at
    from entries e
   where e.rn = 1 and t.id = e.record_id
     and t.status = 'done' and t.completed_at is null;

  with entries as (
    select al.record_id, al.created_at,
           row_number() over (partition by al.record_id order by al.created_at desc) as rn
    from public.audit_logs al
    where al.table_name = 'projects'
      and al.new_data->>'status' = 'completed'
      and (al.old_data is null or al.old_data->>'status' is distinct from 'completed')
  )
  update public.projects p
     set completed_at = e.created_at
    from entries e
   where e.rn = 1 and p.id = e.record_id
     and p.status = 'completed' and p.completed_at is null;

  with entries as (
    select al.record_id, al.created_at,
           row_number() over (partition by al.record_id order by al.created_at desc) as rn
    from public.audit_logs al
    where al.table_name = 'orders'
      and public.order_status_is_closed(al.new_data->>'status')
      and (al.old_data is null or not public.order_status_is_closed(al.old_data->>'status'))
  )
  update public.orders o
     set closed_at = e.created_at
    from entries e
   where e.rn = 1 and o.id = e.record_id
     and public.order_status_is_closed(o.status) and o.closed_at is null;

  with entries as (
    select al.record_id, al.created_at,
           row_number() over (partition by al.record_id order by al.created_at desc) as rn
    from public.audit_logs al
    where al.table_name = 'payments'
      and al.new_data->>'payment_status' = 'cleared'
      and (al.old_data is null or al.old_data->>'payment_status' is distinct from 'cleared')
  )
  update public.payments pm
     set cleared_at = e.created_at
    from entries e
   where e.rn = 1 and pm.id = e.record_id
     and pm.payment_status = 'cleared' and pm.cleared_at is null;
end $$;

-- A row that reached its finished state before audit logging covered the table
-- keeps a NULL stamp — there is genuinely no record of when it happened, and
-- inventing one from updated_at (which any later edit moves) would be worse
-- than admitting it. Those rows simply do not appear in any "finished between
-- X and Y" window; every transition from here on is stamped by the triggers.
