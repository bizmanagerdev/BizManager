-- ════════════════════════════════════════════════════════════════════════════
-- AUDIT — attach the generic log_changes trigger to vehicles + tags.
-- Run in the Supabase SQL Editor. Idempotent / safe to re-run.
--
-- The existing public.log_changes() function is generic (TG_TABLE_NAME, NEW.id /
-- OLD.id, to_jsonb(OLD/NEW)) and works on any table with a `uuid id` PK. Here we
-- bring the Vehicles feature into the activity feed:
--   • vehicles — plate / make_model / year / טסט / ביטוח / רישוי / owner_name / notes
--   • tags     — a car's name + color (and any future tag kinds) live here
--
-- Deploy order: run this BEFORE (or together with) the app change that adds
-- 'vehicles' and 'tags' to TRIGGER_AUDITED_TABLES, so there is never a gap where
-- neither the DB nor the app logs them.
--
-- NOTE: entity_tags is deliberately left UNAUDITED — re-tagging is high-volume,
-- low-value noise (each car link/unlink would flood the feed).
-- ════════════════════════════════════════════════════════════════════════════

drop trigger if exists trg_audit_vehicles on public.vehicles;
create trigger trg_audit_vehicles
  after insert or update or delete on public.vehicles
  for each row execute function public.log_changes();

drop trigger if exists trg_audit_tags on public.tags;
create trigger trg_audit_tags
  after insert or update or delete on public.tags
  for each row execute function public.log_changes();
