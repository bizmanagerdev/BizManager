-- Activity tab upgrade: user last-seen tracking + kill the reminder-audit flood.
--
-- 1) users.last_seen_at + a SECURITY DEFINER heartbeat RPC. The client
--    (PresenceTracker, mounted for every authenticated user) calls touch_last_seen()
--    on mount and on an interval, so we know when each user was last active even
--    after they close the tab. Powers the redesigned "מחוברים כעת" bar (active-now
--    vs. last-active + session length).
--
-- 2) Drop trg_audit_reminders. The system-rules engine reconciles the reminders
--    table on a schedule (insert new problems, refresh changed ones, auto-close
--    stale ones), and each write fired the generic audit trigger — flooding the
--    activity feed with hundreds of "reminders · עודכן" system rows. We stop
--    auditing reminders entirely and instead log ONE summary row per sync batch
--    from the app (see lib/reminders/system-rules.ts).
--
-- Idempotent: safe to re-run.

-- 1) Last-seen ---------------------------------------------------------------
ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz;

CREATE INDEX IF NOT EXISTS "idx_users_last_seen_at"
  ON "public"."users" USING btree ("last_seen_at");

-- Heartbeat: stamp the calling user's last_seen_at. SECURITY DEFINER so it runs
-- regardless of the users-table RLS write policies (a user may not otherwise be
-- allowed to UPDATE their own row).
CREATE OR REPLACE FUNCTION "public"."touch_last_seen"()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  UPDATE public.users
     SET last_seen_at = now()
   WHERE auth_user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION "public"."touch_last_seen"() TO "authenticated";

-- 2) Stop auditing reminder churn -------------------------------------------
DROP TRIGGER IF EXISTS "trg_audit_reminders" ON "public"."reminders";
