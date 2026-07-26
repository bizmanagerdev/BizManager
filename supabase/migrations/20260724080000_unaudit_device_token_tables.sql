-- Device-token tables are plumbing, not user actions — stop auditing them.
--
-- migration 20260724050000 attached the audit trigger to every uuid-PK table,
-- which swept in the push-token tables. The native app refreshes its FCM token
-- (and web push bumps last_seen), so each refresh produced a "fcm_tokens · עודכן"
-- / "push_subscriptions · עודכן" row — device churn with no business meaning.
--
-- These belong on the 050000 denylist; drop their triggers here. (If 050000 is
-- ever re-run it would re-add them — re-run this afterwards, or add them to that
-- file's v_deny.)
--
-- Idempotent.

DROP TRIGGER IF EXISTS "trg_audit_fcm_tokens" ON "public"."fcm_tokens";
DROP TRIGGER IF EXISTS "trg_audit_push_subscriptions" ON "public"."push_subscriptions";
