-- Stop the last-seen heartbeat from flooding the audit log.
--
-- The `users` table is audited by trg_audit_users → log_changes(). The presence
-- heartbeat (touch_last_seen, called every ~60s per active user) updates
-- users.last_seen_at, so WITHOUT this each heartbeat would insert a
-- "משתמש · עודכן" audit row — a brand-new flood, exactly what we just removed for
-- reminders.
--
-- Fix: a general, transaction-local opt-out. log_changes() early-returns when the
-- GUC `app.skip_audit` is 'on'; touch_last_seen() sets it locally (so it applies
-- only to that heartbeat UPDATE, never leaking to other writes). Reusable for any
-- future system-maintenance write that shouldn't be audited.

-- 1) Teach the generic audit trigger to honor the opt-out. Body is identical to
--    the original plus the guard at the top.
CREATE OR REPLACE FUNCTION "public"."log_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_user uuid;
  v_role text;
BEGIN
  -- Transaction-local opt-out (e.g. the last-seen heartbeat). Empty/missing = audit.
  IF current_setting('app.skip_audit', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_user := auth.uid();
  v_role := public.current_user_role();

  IF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (table_name, record_id, action, old_data, changed_by, user_role)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), v_user, v_role);
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (table_name, record_id, action, old_data, new_data, changed_by, user_role)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), v_user, v_role);
    RETURN NEW;

  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (table_name, record_id, action, new_data, changed_by, user_role)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), v_user, v_role);
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- 2) Heartbeat sets the opt-out locally, then stamps last_seen_at.
CREATE OR REPLACE FUNCTION "public"."touch_last_seen"()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.skip_audit', 'on', true); -- true = transaction-local
  UPDATE public.users SET last_seen_at = now() WHERE auth_user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION "public"."touch_last_seen"() TO "authenticated";
