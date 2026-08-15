-- ════════════════════════════════════════════════════════════════════════════
-- Editing an APPROVED shift: pull it out of payroll, back into the queue.
--
-- A worker who spots a mistake in an approved shift ("I left at 16:00, not
-- 18:00") has had no way to correct it. He cannot touch attendance_sessions —
-- that's payroll, and by design his RLS grants read only (20260810000000).
--
-- So the edit is not an UPDATE at all: it withdraws the session and files the
-- corrected times as a fresh pending_review report, which the boss classifies
-- and approves like any other. Both halves happen in ONE function so a shift can
-- never be deleted from payroll without its replacement existing, or vice versa.
--
-- SECURITY DEFINER because it deliberately does something the caller's own
-- policies forbid — deleting a payroll row — under conditions this function
-- checks itself:
--   • the session must be YOURS (or you're admin/office);
--   • it must not already be PAID — money that has moved isn't a worker's to
--     rewrite; that's a conversation with the office, not a form;
--   • it must not sit in a CLOSED payroll period, for the same reason the rest
--     of the app refuses to touch those.
--
-- Idempotent / safe to re-run. Run in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- Which session this report was filed to replace. Lets the queue say "this is a
-- correction, not a new shift", and leaves a trail after the original is gone.
alter table public.phone_attendance_reports
  add column if not exists replaces_session_id uuid;

comment on column public.phone_attendance_reports.replaces_session_id is
  'Set when this report is a correction to an already-approved session, which was withdrawn from attendance_sessions when it was filed. Not a foreign key: the row it names is deleted by design.';

create or replace function public.request_attendance_session_edit(
  p_session_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_notes text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_caller uuid;
  v_caller_role user_role_enum;
  v_session record;
  v_report_id uuid;
begin
  v_caller := public.current_app_user_id();
  if v_caller is null then
    raise exception 'not_authenticated' using hint = 'לא ניתן לזהות את המשתמש.';
  end if;
  v_caller_role := public.current_user_role();

  select s.id, s.user_id, s.clock_in, s.clock_out
    into v_session
  from public.attendance_sessions s
  where s.id = p_session_id;

  if not found then
    raise exception 'session_not_found' using hint = 'המשמרת לא נמצאה.';
  end if;

  -- Yours, or you run the place.
  if v_session.user_id <> v_caller and v_caller_role not in ('admin', 'office') then
    raise exception 'forbidden' using hint = 'אפשר לתקן רק משמרת שלך.';
  end if;

  if p_clock_in is null or p_clock_out is null or p_clock_out <= p_clock_in then
    raise exception 'invalid_range' using hint = 'שעת הסיום חייבת להיות אחרי שעת ההתחלה.';
  end if;
  if p_clock_in > now() + interval '5 minutes' or p_clock_out > now() + interval '5 minutes' then
    raise exception 'future_time' using hint = 'לא ניתן לדווח שעות בעתיד.';
  end if;

  -- Already paid → the money has moved; this is the office's to unpick.
  if exists (
    select 1 from public.worker_payment_allocations a
    where a.attendance_session_id = p_session_id
  ) then
    raise exception 'session_paid' using hint = 'המשמרת כבר שולמה — פנה למנהל.';
  end if;

  -- Inside a closed payroll period → locked, same as everywhere else.
  if exists (
    select 1 from public.payroll_periods p
    where p.status = 'closed'
      and (v_session.clock_in at time zone 'utc')::date between p.start_date and p.end_date
  ) then
    raise exception 'period_locked' using hint = 'תקופת השכר של המשמרת נעולה.';
  end if;

  insert into public.phone_attendance_reports (
    user_id, clock_in, clock_out, worked_minutes, status, source,
    reported_by, replaces_session_id, notes
  )
  values (
    v_session.user_id,
    p_clock_in,
    p_clock_out,
    greatest(0, (extract(epoch from (p_clock_out - p_clock_in)) / 60)::integer),
    'pending_review',
    'app',
    v_caller,
    p_session_id,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_report_id;

  -- Only now does it leave payroll. If the insert above had failed, the whole
  -- statement rolls back and the session is still there.
  delete from public.attendance_sessions where id = p_session_id;

  return v_report_id;
end;
$$;

grant execute on function public.request_attendance_session_edit(uuid, timestamptz, timestamptz, text) to authenticated;
