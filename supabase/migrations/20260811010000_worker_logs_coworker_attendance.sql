-- ════════════════════════════════════════════════════════════════════════════
-- "החתמת נוכחות" for a WORKER: let him log a colleague in and out.
--
-- The foreman on site knows who turned up; the office doesn't. Until now only
-- admin/office could file attendance for someone else, so a crew's hours went
-- through a phone call. This gives a worker the same dialog — and nothing more:
-- what he files lands in the SAME pending_review queue, and it is still the boss
-- who classifies the business domain and approves it into payroll.
--
-- The privileges are cut as narrowly as the job allows:
--   • he may READ other workers (name/phone) — you can't pick from a list you
--     can't see — but only workers, never admin/office rows;
--   • he may READ other people's reports ONLY while they are OPEN, which is
--     exactly what "is this person currently clocked in?" and "close their
--     shift" need. Their history stays private to them and the office;
--   • he may CREATE and CLOSE reports for workers, and only into the two
--     statuses a report can start or land in. 'approved' remains unreachable.
--
-- Idempotent / safe to re-run. Run in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- Is this person somebody whose hours we track? (Both worker roles: a
-- worker_no_access has no login but still gets clocked in by someone else.)
create or replace function public.is_payroll_worker(p_user_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = p_user_id
      and u.active = true
      and u.role in ('worker', 'worker_no_access')
  );
$$;

grant execute on function public.is_payroll_worker(uuid) to authenticated;

-- ── See your colleagues (workers only) ───────────────────────────────────────
-- Needed for the worker picker. Deliberately NOT all users: a worker has no
-- business reading the office's or the owner's row.
drop policy if exists "users_worker_view_coworkers" on public.users;
create policy "users_worker_view_coworkers"
on public.users
for select
to authenticated
using (
  public.current_user_role() = 'worker'::user_role_enum
  and active = true
  and role in ('worker', 'worker_no_access')
);

-- ── See a colleague's OPEN shift, and nothing else of theirs ─────────────────
-- Enough to answer "are they clocked in?" and to close it. Their approved and
-- rejected history is not his business. (His own rows stay covered by
-- phone_attendance_worker_select_own from 20260810000000.)
drop policy if exists "phone_attendance_worker_select_open_coworkers" on public.phone_attendance_reports;
create policy "phone_attendance_worker_select_open_coworkers"
on public.phone_attendance_reports
for select
to authenticated
using (
  public.current_user_role() = 'worker'::user_role_enum
  and status = 'open'
  and public.is_payroll_worker(user_id)
);

-- ── File a shift for any worker (including himself) ──────────────────────────
-- Replaces the self-only insert from 20260811000000; the status/clock_out rules
-- it carried are preserved verbatim.
drop policy if exists "phone_attendance_worker_insert_own" on public.phone_attendance_reports;
drop policy if exists "phone_attendance_worker_insert" on public.phone_attendance_reports;
create policy "phone_attendance_worker_insert"
on public.phone_attendance_reports
for insert
to authenticated
with check (
  public.current_user_role() = 'worker'::user_role_enum
  and public.is_payroll_worker(user_id)
  and status in ('open', 'pending_review')
  and source = 'app'
  and (
    (status = 'open' and clock_out is null)
    or (status = 'pending_review' and clock_out is not null and clock_out > clock_in)
  )
);

-- ── Close any worker's open shift, or fix its entry time ────────────────────
-- Replaces the self-only close. The `source = 'app'` condition is dropped on
-- purpose: a colleague who clocked in BY PHONE and then left his phone in the
-- van is precisely the person who needs someone else to clock him out.
--
-- USING pins the pre-image to a still-open shift. WITH CHECK allows the only two
-- shapes the result may take:
--   • still open with no clock-out  → correcting a mistyped entry time;
--   • pending_review with a clock-out after the start → the shift was closed.
-- Either way it can only ever hand work to the boss; 'approved' is unreachable.
drop policy if exists "phone_attendance_worker_close_own" on public.phone_attendance_reports;
drop policy if exists "phone_attendance_worker_close" on public.phone_attendance_reports;
create policy "phone_attendance_worker_close"
on public.phone_attendance_reports
for update
to authenticated
using (
  public.current_user_role() = 'worker'::user_role_enum
  and status = 'open'
  and public.is_payroll_worker(user_id)
)
with check (
  public.current_user_role() = 'worker'::user_role_enum
  and public.is_payroll_worker(user_id)
  and (
    (status = 'open' and clock_out is null)
    or (status = 'pending_review' and clock_out is not null and clock_out > clock_in)
  )
);
