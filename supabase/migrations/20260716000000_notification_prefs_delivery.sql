-- Reminders/Alerts redesign — Phase A.
-- notification_prefs gains: delivery, summary_hour, subscribe.
--
-- No schema change is required: notification_prefs is jsonb and
-- set_my_notification_prefs(p_prefs jsonb) already stores the object wholesale.
-- This migration only re-documents the shape so the DB is self-describing, and
-- is safe to re-run.
--
-- Shape (see lib/notifications/prefs.ts — the single source of truth):
--   {
--     "delivery":     "summary" | "summary_urgent" | "all",  -- default "summary"
--     "summary_hour": 8,            -- 0-23, Israel time, per user
--     "subscribe":    ["money"],    -- opt-in role-broadcast buckets; [] = only my own
--     "muted":        ["payroll"],  -- no push AND no inbox for those buckets
--     "push_paused":  false         -- no phone push, still recorded in-app
--   }
--
-- Routing contract:
--   * An item that is MINE (assigned/created/my entity) always reaches me.
--   * An automatic item reaches me only if I subscribed to its bucket.
--   * A "שלי" reminder with a time ALWAYS pings at that time, in every delivery mode.
--   * delivery governs AUTOMATIC alerts only.
-- NULL prefs = defaults (summary @ 08:00, subscribe = none).

comment on column public.users.notification_prefs is
  'Per-user notification prefs (jsonb). { delivery: summary|summary_urgent|all, summary_hour: 0-23, subscribe: bucket[], muted: bucket[], push_paused: bool }. NULL = defaults (summary @08:00, own items only). Source of truth: lib/notifications/prefs.ts';
