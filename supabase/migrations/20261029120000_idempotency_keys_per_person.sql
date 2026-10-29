-- ════════════════════════════════════════════════════════════════════════════
-- Duplicate-protection keys belong to the person who sent them (audit
-- 2026-10-27; owner, 2026-10-29: "yes, build it").
--
-- A save from a phone carries an Idempotency-Key (lib/idempotency.ts): the
-- same key twice is done once. The key alone was the primary key, for
-- everyone — so another person's save with the same key (the device copy's
-- keys are built from the row and a counter that starts again after a
-- sign-out) hit theirs, and RLS hid whose it was: it was answered "still
-- working" and never saved. Now the key is unique per person.
--
-- The routes look a key up as the person (RLS, and user_id in the query), so
-- nothing else changes. Safety copy: backup.idempotency_keys_20261029.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.idempotency_keys drop constraint idempotency_keys_pkey;
alter table public.idempotency_keys add constraint idempotency_keys_pkey primary key (user_id, key);
