-- Phone-based attendance (kosher-phone clock in/out via a phone call).
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Workers with "kosher" phones (no app, no SMS) call a number and press 1 (כניסה) / 2 (יציאה)
-- / 3 (last shift). The telephony provider posts the caller + digit to /api/attendance/call,
-- which records the shift HERE — deliberately NOT in attendance_sessions. A phone report is a
-- *raw* clock in/out that an admin must APPROVE and classify to a business_domain before it
-- becomes a real attendance_sessions row (nothing here touches payroll or financials until then).
--
-- Lifecycle: open --(clock out)--> pending_review --(admin approve)--> approved (+ session created)
--                                              \--(admin reject)----> rejected

create table if not exists public.phone_attendance_reports (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  clock_in timestamp with time zone not null,
  clock_out timestamp with time zone,
  worked_minutes integer,
  status text not null default 'open', -- open | pending_review | approved | rejected
  source text not null default 'phone',
  -- Provider's unique call id, when supplied — lets us ignore duplicate webhook retries.
  provider_call_id text,
  -- Set once an admin approves and a real session is created from this report.
  attendance_session_id uuid,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.phone_attendance_reports drop constraint if exists phone_attendance_reports_status_check;
alter table public.phone_attendance_reports
  add constraint phone_attendance_reports_status_check
  check (status in ('open', 'pending_review', 'approved', 'rejected'));

-- At most one OPEN shift per worker — the clock-out has a single unambiguous shift to close.
create unique index if not exists phone_attendance_reports_one_open_per_user
  on public.phone_attendance_reports (user_id)
  where status = 'open';

-- The admin approval queue reads pending_review, oldest first.
create index if not exists phone_attendance_reports_pending_idx
  on public.phone_attendance_reports (created_at)
  where status = 'pending_review';

create index if not exists phone_attendance_reports_user_idx
  on public.phone_attendance_reports (user_id, clock_in desc);

-- Ignore duplicate provider retries carrying the same call id.
create unique index if not exists phone_attendance_reports_provider_call_idx
  on public.phone_attendance_reports (provider_call_id)
  where provider_call_id is not null;

alter table public.phone_attendance_reports enable row level security;

-- Staff (admin/office) manage the queue from the app. The webhook itself uses the service-role
-- key, which bypasses RLS, so it needs no policy here.
drop policy if exists "Staff manage phone attendance reports" on public.phone_attendance_reports;
create policy "Staff manage phone attendance reports"
on public.phone_attendance_reports
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office')
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office')
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
);
