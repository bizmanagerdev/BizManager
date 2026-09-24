-- Register the "מסמכים — תוקף פג או מתקרב" live rule in the unified alert
-- center so it can be toggled and re-audienced in Settings → התראות.
-- Run in the Supabase SQL Editor. Idempotent.
--
-- Rule: a document whose category has `tracks_expiry` (ביטוח, תעודה/רישיון,
-- חוזה/הסכם as seeded) and whose `valid_until` falls inside that category's
-- lead window surfaces as a PER-ITEM inbox card — warning while it is still
-- valid, danger once it has passed.
--
-- Per-item rather than one collapsed summary (unlike vehicle_expiry): expiring
-- papers are sparse, and "which policy" is the whole point of the alert.
--
-- Depends on 20260922132453 (the category registry, for tracks_expiry) and
-- 20260922183535 (documents.valid_until). The rule returns an empty set until
-- both have run, so ordering is safe either way.

insert into public.push_alert_config (title, body, url, mode, rule_key, audience_role, enabled, send_hour_israel)
values ('מסמכים — תוקף פג או מתקרב', '', '/documents', 'live', 'document_expiry', 'office', true, 8)
on conflict (rule_key) where rule_key is not null do nothing;
