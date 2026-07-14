-- Allow tagging/segmenting customers via the existing entity_tags cross-cut.
-- Until now entity_tags.entity_type excluded 'customer'; this widens the CHECK so
-- customers can carry general-kind tags (wholesale/retail/source/VIP/…).
-- Idempotent: drop + recreate the named constraint with the extended allow-list.

alter table public.entity_tags
  drop constraint if exists entity_tags_entity_type_check;

alter table public.entity_tags
  add constraint entity_tags_entity_type_check
  check (entity_type = any (array[
    'task'::text,
    'expense'::text,
    'payment'::text,
    'document'::text,
    'work_session'::text,
    'customer'::text
  ]));
