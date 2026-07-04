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
create or replace function public.get_alert_rule_metrics(days int default 30)
returns table (
  rule_key          text,
  fired             int,
  pushable          int,
  still_open        int,
  resolved          int,
  snoozed           int,
  pushed            int,
  resolved_unpushed int,
  avg_resolve_hours numeric
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(nullif(split_part(r.dedupe_key, ':', 1), ''), 'manual')                    as rule_key,
    count(*)::int                                                                        as fired,
    -- fires that are ELIGIBLE to push (not info, not silent). A rule with 0 here
    -- is worklist-only by design and can't be "noisy" — it never interrupts.
    count(*) filter (where r.severity <> 'info' and r.behavior <> 'silent')::int         as pushable,
    count(*) filter (where r.status = 'pending')::int                                    as still_open,
    count(*) filter (where r.status in ('auto_resolved', 'done'))::int                   as resolved,
    count(*) filter (where r.snoozed_until is not null)::int                             as snoozed,
    count(*) filter (where r.notified_at is not null)::int                               as pushed,
    -- self-resolve noise: a PUSHABLE fire that resolved before it ever pushed.
    -- Scoped to pushable so silent/info rules don't look noisy for never pushing.
    count(*) filter (where r.status in ('auto_resolved', 'done')
                       and r.notified_at is null
                       and r.severity <> 'info' and r.behavior <> 'silent')::int         as resolved_unpushed,
    round(
      avg(extract(epoch from (r.resolved_at - r.created_at)) / 3600.0)
        filter (where r.resolved_at is not null),
      1
    )                                                                                    as avg_resolve_hours
  from public.reminders r
  where r.source = 'system'
    and r.created_at >= now() - make_interval(days => greatest(days, 1))
    and exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.role = 'admin')
  group by 1
  order by fired desc;
$$;

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
