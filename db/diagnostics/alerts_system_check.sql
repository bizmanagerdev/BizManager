-- Alerts/reminders system health check. Run in the Supabase SQL Editor.
-- Nothing is modified — all SELECTs.

-- 1) Unified alert center is seeded. Expect: scheduled=7, live=17, night=1.
select mode, count(*) as rows
from public.push_alert_config
group by mode
order by mode;

-- 2) Every live/night rule is present with its on/off + audience.
select rule_key, mode, enabled, audience_role, send_hour_israel, send_hour_end_israel
from public.push_alert_config
where rule_key is not null
order by mode, rule_key;

-- 3) System reminders currently open in the worklist (created by the rules sync),
--    grouped by rule. This fills in after the sync runs (cron or "רענן התראות").
select split_part(dedupe_key, ':', 1) as rule, count(*) as open_items
from public.reminders
where source = 'system' and status = 'pending'
group by 1
order by 2 desc;

-- 4) All reminders by source/status (sanity on manual vs system, snoozed, resolved).
select source, status, count(*)
from public.reminders
group by source, status
order by source, status;

-- 5) Migrations applied? Each returns rows/columns only if the migration ran.
select 'payment_promises table' as check, count(*)::text as result from public.payment_promises
union all
select 'users.digest_seen_at + worklist_prefs',
       string_agg(column_name, ', ')
  from information_schema.columns
  where table_name = 'users' and column_name in ('digest_seen_at', 'worklist_prefs')
union all
select 'reminders unify columns',
       string_agg(column_name, ', ')
  from information_schema.columns
  where table_name = 'reminders' and column_name in ('source', 'next_ping_at', 'snoozed_until', 'dedupe_key')
union all
select 'communication_logs.customer_id nullable',
       is_nullable
  from information_schema.columns
  where table_name = 'communication_logs' and column_name = 'customer_id';
