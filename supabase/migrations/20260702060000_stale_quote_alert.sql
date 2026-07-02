-- Register the "stale quote" live rule in the unified alert center so it can be
-- toggled/edited in Settings → התראות. Run in the Supabase SQL Editor. Idempotent.
--
-- Rule: a project still in 'quote' status a week after it was created → surfaces
-- in "מה דורש טיפול" suggesting to delete it (or push the status forward).

insert into public.push_alert_config (title, body, url, mode, rule_key, audience_role, enabled, send_hour_israel)
values ('הצעות מחיר ישנות למחיקה', '', '/projects', 'live', 'stale_quote', 'office', true, 8)
on conflict (rule_key) where rule_key is not null do nothing;
