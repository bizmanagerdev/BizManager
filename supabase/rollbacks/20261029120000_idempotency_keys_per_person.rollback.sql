-- Rollback for 20261029120000_idempotency_keys_per_person.sql.
--
-- Puts back the key alone as the primary key. Fails if two people have used
-- the same key since — find them first:
--   select key from public.idempotency_keys group by key having count(*) > 1;

alter table public.idempotency_keys drop constraint idempotency_keys_pkey;
alter table public.idempotency_keys add constraint idempotency_keys_pkey primary key (key);
