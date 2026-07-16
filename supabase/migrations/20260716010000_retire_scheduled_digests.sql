-- Reminders/Alerts redesign — Phase F.
-- Retire the scheduled task/project digests that the new per-user daily summary
-- replaces, so nobody receives the same facts twice.
--
-- Background: these rows were ALREADY disabled in 20260703020000 as "redundant
-- with the live per-item rules". The redesign inverts that call — the digest is
-- what users actually want, and the per-item pings were the noise. The digest is
-- now rebuilt properly in /api/cron/daily-summary, which reads the SAME inbox
-- model as the bell and the page (so the numbers can never disagree) and fires at
-- each user's own notification_prefs.summary_hour.
--
-- These push_alert_config rows are therefore obsolete rather than merely off:
-- keeping them invites someone to re-enable a second, contradictory digest.
-- Idempotent; safe to re-run.

delete from public.push_alert_config
where alert_type in (
  'overdue_tasks',
  'today_tasks',
  'tomorrow_tasks',
  'projects_starting',
  'projects_deadline'
);

-- Deliberately KEPT (they are not per-user inbox facts, so the summary doesn't
-- cover them):
--   * deliveries      — an operational route sheet grouped by city
--   * weekly_summary   — a forward-looking week view
--   * nightly_review   — mode='night', owned by /api/cron/nightly-review

-- Point any remaining config rows at the merged inbox. /alerts still redirects,
-- but stored payloads shouldn't depend on a redirect.
update public.push_alert_config
set url = '/inbox'
where url = '/alerts';
