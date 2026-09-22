-- Finding shifts that were saved on the WRONG CLOCK, and putting them right.
-- Run in the Supabase SQL Editor. Sections 1-4 are read-only; section 5 is the
-- only thing here that writes, and it is commented out on purpose.
--
-- Background: until this was fixed, a time typed into the app was converted
-- using the DEVICE's timezone. A worker abroad who reported 08:30 had 08:30 on
-- HIS phone stored — which in Israel is a different hour (+7 from New York, +6
-- from the US west coast in summer, -6 from Tokyo). The shift is a real shift;
-- only its hours are displaced, always by the SAME whole number of hours for
-- every shift he filed from that country.
--
-- Everything below prints times in Asia/Jerusalem, which is what the payroll
-- screens show.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Who has shifts that start at an implausible hour, and when?
--    A displaced shift usually lands outside the working day. This is the
--    fastest way to spot WHICH worker and WHICH weeks are affected.
-- ─────────────────────────────────────────────────────────────────────────────
select
  u.full_name,
  date_trunc('week', s.clock_in at time zone 'Asia/Jerusalem')::date as week,
  count(*)                                                            as shifts,
  count(*) filter (
    where extract(hour from s.clock_in at time zone 'Asia/Jerusalem') not between 4 and 21
  )                                                                   as odd_start_hour,
  min(s.clock_in at time zone 'Asia/Jerusalem')                       as first_shift,
  max(s.clock_in at time zone 'Asia/Jerusalem')                       as last_shift
from public.attendance_sessions s
join public.users u on u.id = s.user_id
where s.clock_in >= now() - interval '6 months'
group by 1, 2
having count(*) filter (
  where extract(hour from s.clock_in at time zone 'Asia/Jerusalem') not between 4 and 21
) > 0
order by week desc, odd_start_hour desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) The same question for reports still in the approval queue
--    (phone_attendance_reports — what the worker files before the boss approves).
-- ─────────────────────────────────────────────────────────────────────────────
select
  u.full_name,
  r.id,
  r.status,
  r.source,
  r.clock_in  at time zone 'Asia/Jerusalem' as clock_in_israel,
  r.clock_out at time zone 'Asia/Jerusalem' as clock_out_israel,
  r.worked_minutes,
  r.notes
from public.phone_attendance_reports r
join public.users u on u.id = r.user_id
where r.clock_in >= now() - interval '6 months'
  and extract(hour from r.clock_in at time zone 'Asia/Jerusalem') not between 4 and 21
order by r.clock_in desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) One worker, one window — the list to eyeball before changing anything.
--    Fill in the name and the dates he was out of the country.
-- ─────────────────────────────────────────────────────────────────────────────
with target as (
  select id from public.users where full_name = '<<שם העובד>>'
)
select
  s.id,
  s.clock_in  at time zone 'Asia/Jerusalem' as clock_in_israel,
  s.clock_out at time zone 'Asia/Jerusalem' as clock_out_israel,
  round(extract(epoch from (s.clock_out - s.clock_in)) / 3600.0, 2) as hours,
  s.business_domain,
  s.notes
from public.attendance_sessions s
where s.user_id in (select id from target)
  and s.clock_in >= '<<YYYY-MM-DD>>'   -- first day abroad
  and s.clock_in <  '<<YYYY-MM-DD>>'   -- day after the last one
order by s.clock_in;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) What the SAME rows would read after shifting them back.
--    Set the interval to the gap between where he was and Israel, as a
--    correction: from New York in summer the stored hour is 7 HOURS LATE, so the
--    fix is '-7 hours'. Run this and read the before/after columns side by side
--    until the hours look like the days he actually worked.
-- ─────────────────────────────────────────────────────────────────────────────
with target as (
  select id from public.users where full_name = '<<שם העובד>>'
), shift as (
  select interval '-7 hours' as correction
)
select
  s.id,
  s.clock_in  at time zone 'Asia/Jerusalem'                      as was_clock_in,
  (s.clock_in  + shift.correction) at time zone 'Asia/Jerusalem' as will_be_clock_in,
  s.clock_out at time zone 'Asia/Jerusalem'                      as was_clock_out,
  (s.clock_out + shift.correction) at time zone 'Asia/Jerusalem' as will_be_clock_out
from public.attendance_sessions s
cross join shift
where s.user_id in (select id from target)
  and s.clock_in >= '<<YYYY-MM-DD>>'
  and s.clock_in <  '<<YYYY-MM-DD>>'
order by s.clock_in;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) THE CORRECTION — commented out. Read this before uncommenting it.
--
--    * These are hours somebody gets paid for. Run section 4 first and satisfy
--      yourself that every row's "will_be" column is the shift he actually
--      worked. The id list below is deliberate: paste the ids you checked, so a
--      wrong date range cannot quietly rewrite shifts you never looked at.
--    * A session already inside a LOCKED or PAID payroll period must not be
--      moved this way — fix the payslip, or reopen the period first. The check
--      below refuses to touch one. (Periods are global, one row per month, so
--      this looks at the month the shift falls in, not at the worker.)
--    * worked_minutes does not change: shifting both ends by the same amount
--      leaves the length alone. If a row's length is also wrong, that is a
--      different problem and this is not the fix for it.
--    * Easier alternative for a handful of shifts: correct them in the app.
--      /payroll → the worker → edit the shift. Since the timezone fix those
--      editors write Israel time whatever device they are used from.
-- ─────────────────────────────────────────────────────────────────────────────
-- begin;
--
-- update public.attendance_sessions s
--    set clock_in  = s.clock_in  + interval '-7 hours',
--        clock_out = s.clock_out + interval '-7 hours'
--  where s.id in (
--          '<<id>>',
--          '<<id>>'
--        )
--    and not exists (
--          select 1
--            from public.payroll_periods p
--           where p.status in ('locked', 'paid')
--             and (s.clock_in at time zone 'Asia/Jerusalem')::date
--                 between p.start_date and p.end_date
--        );
--
-- -- Check the row count, then: commit;  (or: rollback;)
