-- Alert-volume metrics: derived, read-only aggregates over the existing
-- reminders (the alert spine) + notifications (in-app read log) tables. No new
-- storage. Run in the Supabase SQL Editor. Idempotent.
--
-- Both functions aggregate ACROSS ALL USERS, so they must run SECURITY DEFINER
-- (bypass RLS) — otherwise an invoker view returns only the caller's own rows
-- (the security-invoker aggregate gotcha). Each guards to admins internally, so
-- a non-admin calling the RPC directly gets nothing.

-- Per-rule reminder metrics: volume, still-open, resolved, snoozed, pushed, the
-- "self-resolved before ever pushing" noise signal, and avg hours-to-resolve.
--
-- SUPERSEDED (2026-09-10, during the migration-baseline backfill — see
-- foundation-hardening memory): this statement would have added a "pushable"
-- column (fires eligible to push) and scoped resolved_unpushed to it. Checked
-- directly against live production's pg_get_functiondef: the deployed function
-- does NOT have "pushable" and never has — this statement was apparently never
-- actually applied there. baseline.sql's capture (the true current live shape,
-- no "pushable") is authoritative, and Postgres's CREATE OR REPLACE FUNCTION
-- can't change a function's OUT-parameter row type without DROP FUNCTION first.
-- Removed rather than commented out wholesale so the file stays readable.
--
-- NOTE: app code (lib/notifications/metrics.ts AlertRuleMetric.pushable,
-- alertNoiseVerdict) DOES expect this column — this is a real, currently-live
-- gap between the app and the DB (the noise-verdict admin feature silently
-- never flags anything noisy, since `pushable` reads as undefined). Left as-is
-- here since fixing it means writing to production, which is out of scope for
-- this baseline-replay pass — flagged separately, not silently dropped.

-- Read-rate per notification bucket: how many in-app notifications were opened.
-- Bucket = notifications.category (money/tasks/projects/…); "never read" is the
-- clearest "pushed but ignored" signal.
create or replace function public.get_alert_read_metrics(days int default 30)
returns table (
  category   text,
  delivered  int,
  read_count int
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(nullif(n.category, ''), 'other')                as category,
    count(*)::int                                            as delivered,
    count(*) filter (where n.read_at is not null)::int       as read_count
  from public.notifications n
  where n.created_at >= now() - make_interval(days => greatest(days, 1))
    and exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.role = 'admin')
  group by 1
  order by delivered desc;
$$;

grant execute on function public.get_alert_rule_metrics(int) to authenticated;
grant execute on function public.get_alert_read_metrics(int) to authenticated;
