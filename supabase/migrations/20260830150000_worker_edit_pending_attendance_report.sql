-- ════════════════════════════════════════════════════════════════════════════
-- Let a worker edit his OWN report while it's still sitting in the queue.
--
-- Nothing has reached payroll yet for a pending_review report — the boss hasn't
-- looked at it — so fixing "I actually left at 18:00, not 20:00" here is a plain
-- UPDATE, unlike request_attendance_session_edit (20260814000000), which exists
-- specifically because an APPROVED session is payroll and can't be touched
-- directly. USING pins the pre-image to status = 'pending_review' so this policy
-- stops matching the moment an admin approves (or rejects) the row; WITH CHECK
-- pins the post-image the same way so the edit can't smuggle a status change
-- through. Ownership on both sides keeps it to the caller's own report.
--
-- Idempotent / safe to re-run. Run in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "phone_attendance_worker_edit_pending_own" on public.phone_attendance_reports;
create policy "phone_attendance_worker_edit_pending_own"
on public.phone_attendance_reports
for update
to authenticated
using (
  user_id = public.current_app_user_id()
  and status = 'pending_review'
)
with check (
  user_id = public.current_app_user_id()
  and status = 'pending_review'
);
