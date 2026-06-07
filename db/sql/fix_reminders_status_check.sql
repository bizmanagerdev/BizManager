-- Run this in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Fix: the live `reminders` table carries a status CHECK constraint
-- (`reminders_status_check`) that does NOT permit the value 'done' the app
-- writes when a reminder is marked "בוצע". Result: marking a reminder done
-- failed with:
--   new row for relation "reminders" violates check constraint "reminders_status_check"
--
-- The app's canonical reminder statuses are: pending / done / cancelled
-- (see app/api/reminders/update/route.ts and lib/communications.ts). This brings
-- the constraint back in line with the app.

-- 1) Drop the existing status check (regardless of how it was defined).
alter table public.reminders drop constraint if exists reminders_status_check;

-- 2) Map any out-of-range legacy values onto the canonical set so the new
--    constraint can be added without tripping over existing rows. Done/cancelled
--    meaning is preserved across likely spellings; everything else falls back to
--    pending.
update public.reminders
set status = case
  when status in ('completed', 'complete', 'closed') then 'done'
  when status in ('canceled') then 'cancelled'
  else 'pending'
end
where status is null
   or status not in ('pending', 'done', 'cancelled');

-- 3) Recreate the constraint to match the app.
alter table public.reminders
  add constraint reminders_status_check
  check (status in ('pending', 'done', 'cancelled'));
