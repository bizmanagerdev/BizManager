-- ════════════════════════════════════════════════════════════════════════════
-- Let a worker file a shift he forgot to clock in for at all.
--
-- 20260810000000 gave him two moves: open a shift ('open') and submit it
-- ('pending_review'). That covers "I'm starting now" and "I'm done" — but not
-- "I worked 08:00–16:00 yesterday and never touched the app", which is the
-- common case. He had no way to report it and had to phone the office.
--
-- The insert policy pinned status to 'open', so a complete shift (which must
-- land straight in 'pending_review', there being nothing left to close) was
-- rejected by RLS. Widened to the two statuses a worker may CREATE. He still
-- cannot write 'approved' or 'rejected' — reaching payroll remains the boss's
-- act, and the close policy is untouched.
--
-- Idempotent / safe to re-run. Run in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "phone_attendance_worker_insert_own" on public.phone_attendance_reports;
create policy "phone_attendance_worker_insert_own"
on public.phone_attendance_reports
for insert
to authenticated
with check (
  user_id = public.current_app_user_id()
  and status in ('open', 'pending_review')
  and source = 'app'
  -- A row created as pending_review must already be a finished shift; one
  -- created as open must not carry an end time. Without this, "open" could be
  -- written with a clock_out and never appear in either queue.
  and (
    (status = 'open' and clock_out is null)
    or (status = 'pending_review' and clock_out is not null and clock_out > clock_in)
  )
);
