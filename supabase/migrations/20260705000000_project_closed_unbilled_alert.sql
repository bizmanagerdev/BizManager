-- Register the "closed project, never billed" alert in the unified config so
-- admins can toggle/route it in Settings → התראות. The rule itself runs with a
-- sane default (office) even without this row; this just surfaces it in the UI.
-- Run in the Supabase SQL Editor. Idempotent.

insert into public.push_alert_config (title, body, url, mode, rule_key, audience_role, enabled, send_hour_israel, send_hour_end_israel)
values
  ('פרויקטים סגורים ללא חיוב', '', '/projects', 'live', 'project_closed_unbilled', 'office', true, 8, null)
on conflict (rule_key) where rule_key is not null do nothing;
