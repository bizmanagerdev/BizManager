-- Reminders/Alerts unification — Phase 1: data model.
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent). NON-BREAKING:
-- every change is additive or a widened constraint, so all existing reminder
-- code keeps working unchanged while the new engine is built on top.
--
-- Design (see memory: reminders-alerts-architecture):
--   The `reminders` table becomes the single "instance / worklist" layer for
--   BOTH user-set reminders (source='manual') and system-generated issue alerts
--   (source='system', e.g. "invoice overdue"). System rows carry a dedupe_key so
--   a sync job can upsert-or-auto-close them as conditions appear/resolve.
--   Behavior controls loudness: silent (list only) / ping_once / ping_repeat.

-- ---------------------------------------------------------------------------
-- 1) New columns (all additive, with safe defaults)
-- ---------------------------------------------------------------------------

-- Where the reminder came from: a human, or a system rule.
alter table public.reminders add column if not exists source text not null default 'manual';

-- Stable identity for a system reminder so the sync job can find the existing
-- open row for a given problem instead of creating duplicates.
-- Example: 'invoice_overdue:<invoice_id>', 'check_deposit_due:<payment_id>'.
alter table public.reminders add column if not exists dedupe_key text;

-- Short heading (system alerts have titles; manual reminders may only have content).
alter table public.reminders add column if not exists title text;

-- Deep-link target for the worklist row (e.g. '/financial/checks', '/tasks/<id>').
alter table public.reminders add column if not exists url text;

-- Loudness / colour. Drives the worklist tint and how insistently we ping.
alter table public.reminders add column if not exists severity text not null default 'info';

-- silent  = shows in the worklist only, never pushes
-- ping_once = pushes once at next_ping_at
-- ping_repeat = keeps pushing on repeat_rule until done/resolved (bounded by max_pings)
alter table public.reminders add column if not exists behavior text not null default 'ping_once';

-- Targeting. NULL => targeted at the assigned_to user. Otherwise a role bucket
-- ('admin' | 'office' | 'all') for system reminders that belong to whoever holds
-- that role rather than a single owner.
alter table public.reminders add column if not exists audience_role text;

-- Snooze: while snoozed_until is in the future the row is hidden from the "now"
-- worklist. For a system reminder, "dismiss for today" = set snoozed_until to
-- tomorrow morning; the sync job re-opens it tomorrow if the condition still holds.
alter table public.reminders add column if not exists snoozed_until timestamp with time zone;
alter table public.reminders add column if not exists snoozed_by uuid;

-- Delivery scheduling for the generalized ping cron.
alter table public.reminders add column if not exists next_ping_at timestamp with time zone;
alter table public.reminders add column if not exists ping_count int not null default 0;
alter table public.reminders add column if not exists max_pings int;         -- NULL = unbounded
alter table public.reminders add column if not exists repeat_rule text;      -- NULL|'daily'|'weekdays'|'weekly'|'monthly'

-- When the reminder was closed (done by a human or auto_resolved by the sync job).
alter table public.reminders add column if not exists resolved_at timestamp with time zone;

-- Additional entity links so reminders can attach to the coverage areas that
-- currently have neither an alert nor a reminder.
alter table public.reminders add column if not exists invoice_id uuid;
alter table public.reminders add column if not exists vehicle_id uuid;
alter table public.reminders add column if not exists expense_id uuid;

-- System reminders often have no explicit human "action_type"; relax the NOT NULL
-- so the sync job can insert without inventing one (existing app code still sets it).
alter table public.reminders alter column action_type drop not null;

-- ---------------------------------------------------------------------------
-- 2) Widen / add CHECK constraints (drop-then-add so re-runs are clean)
-- ---------------------------------------------------------------------------

-- status: keep the canonical pending/done/cancelled, add dismissed + auto_resolved.
alter table public.reminders drop constraint if exists reminders_status_check;
update public.reminders
set status = case
  when status in ('completed', 'complete', 'closed') then 'done'
  when status in ('canceled') then 'cancelled'
  when status is null then 'pending'
  when status not in ('pending','done','cancelled','dismissed','auto_resolved') then 'pending'
  else status
end
where status is null
   or status not in ('pending','done','cancelled','dismissed','auto_resolved');
alter table public.reminders
  add constraint reminders_status_check
  check (status in ('pending','done','cancelled','dismissed','auto_resolved'));

alter table public.reminders drop constraint if exists reminders_source_check;
alter table public.reminders
  add constraint reminders_source_check check (source in ('manual','system'));

alter table public.reminders drop constraint if exists reminders_severity_check;
alter table public.reminders
  add constraint reminders_severity_check check (severity in ('info','warning','danger'));

alter table public.reminders drop constraint if exists reminders_behavior_check;
alter table public.reminders
  add constraint reminders_behavior_check check (behavior in ('silent','ping_once','ping_repeat'));

-- ---------------------------------------------------------------------------
-- 3) Backfill existing rows for continuity
-- ---------------------------------------------------------------------------

-- Existing reminders are all manual, one-shot pings. Seed next_ping_at from the
-- legacy remind_at for those that haven't fired yet, so the new deliver cron
-- picks up exactly the reminders the old cron would have (no double-send: rows
-- already stamped notified_at are left with next_ping_at = NULL).
update public.reminders
set next_ping_at = remind_at
where next_ping_at is null
  and notified_at is null
  and status = 'pending';

-- ---------------------------------------------------------------------------
-- 4) Indexes
-- ---------------------------------------------------------------------------

-- One open system reminder per problem: enables ON CONFLICT upsert in the sync job.
create unique index if not exists reminders_dedupe_open_uniq
  on public.reminders (dedupe_key)
  where source = 'system' and status = 'pending' and dedupe_key is not null;

-- Worklist: "my open items" and role-bucket items.
create index if not exists reminders_worklist_idx
  on public.reminders (assigned_to, status);
create index if not exists reminders_audience_idx
  on public.reminders (audience_role, status)
  where audience_role is not null;

-- Deliver cron scan.
create index if not exists reminders_next_ping_idx
  on public.reminders (next_ping_at)
  where status = 'pending' and next_ping_at is not null;
