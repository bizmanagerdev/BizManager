-- Nightly "shifts still waiting for approval" push.
--
-- Adds one row to the alert registry for alert_type 'pending_attendance'. The
-- cron (app/api/cron/daily-alerts) counts phone_attendance_reports still in
-- 'pending_review' and sends ONLY when there are any — a nightly "0 waiting"
-- push would be noise, and this alert's whole job is "don't forget".
--
-- 21:00 Israel is the default (end of the working day, in time to clear the
-- queue before payroll). The hour, the days, who gets it and whether it runs at
-- all are all editable afterwards in הגדרות ניהול → התראות, like every other row
-- here — this migration only creates it.
--
-- Idempotent: keyed on alert_type, so re-running changes nothing and, crucially,
-- does NOT overwrite an hour the user has since chosen.

do $$
begin
  if not exists (
    select 1 from public.push_alert_config where alert_type = 'pending_attendance'
  ) then
    insert into public.push_alert_config
      (title, body, url, alert_type, send_hour_israel, schedule, enabled)
    values (
      'דיווחי נוכחות לאישור',
      'משמרות שהסתיימו וממתינות לשיוך ואישור',
      '/payroll/attendance',
      'pending_attendance',
      21,
      'daily',
      true
    );
  end if;
end $$;
