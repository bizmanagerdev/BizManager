-- Adds an optional p_notes_he param to request_attendance_session_edit
-- (20260814000000) so a locale=ar worker's correction note gets its Hebrew
-- translation carried into the fresh phone_attendance_reports row exactly like
-- p_notes is. Same function body otherwise — see that migration for the full
-- rationale (withdraw-and-refile pattern for correcting an approved shift).

-- Postgres treats a changed parameter list as a new overload, not a replacement
-- — without this, the old 4-arg signature would stick around alongside the new
-- 5-arg one and named-argument calls (what supabase.rpc() sends) would become
-- ambiguous between them. Drop it first so there's exactly one signature.
drop function if exists public.request_attendance_session_edit(uuid, timestamptz, timestamptz, text);

create or replace function public.request_attendance_session_edit(
  p_session_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_notes text default null,
  p_notes_he text default null
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
    reported_by, replaces_session_id, notes, notes_he
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
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_notes_he, '')), '')
  )
  returning id into v_report_id;

  -- Only now does it leave payroll. If the insert above had failed, the whole
  -- statement rolls back and the session is still there.
  delete from public.attendance_sessions where id = p_session_id;

  return v_report_id;
end;
$$;

grant execute on function public.request_attendance_session_edit(uuid, timestamptz, timestamptz, text, text) to authenticated;
