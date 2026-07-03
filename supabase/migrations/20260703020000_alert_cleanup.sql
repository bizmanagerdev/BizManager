-- Alert cleanup: remove redundancy + noise. Run in the Supabase SQL Editor. Idempotent.
--
-- #1 The scheduled digests below duplicate the LIVE worklist rules (same info,
--    twice). Turn them OFF by default — they're opt-in summaries now; the live
--    rules already surface these in "מה דורש טיפול". Admin can re-enable any.
update public.push_alert_config set enabled = false
where mode = 'scheduled'
  and alert_type in ('overdue_tasks', 'today_tasks', 'tomorrow_tasks', 'projects_starting', 'projects_deadline');
-- (kept enabled: 'deliveries' + 'weekly_summary' — genuine summaries with no live equivalent.)

-- #6a session_unallocated is a heuristic (default domain + no project) that
--     over-counts → disable by default, keep it toggleable for later refinement.
update public.push_alert_config set enabled = false where rule_key = 'session_unallocated';
-- Close any open worklist items it already created.
update public.reminders set status = 'auto_resolved', resolved_at = now()
where source = 'system' and status = 'pending' and dedupe_key like 'session_unallocated:%';

-- #6b active_projects ("N active projects") is noise on a to-do surface → retire it.
delete from public.push_alert_config where rule_key = 'active_projects';
delete from public.reminders where source = 'system' and dedupe_key like 'active_projects:%';
