-- ════════════════════════════════════════════════════════════════════════════
-- Vehicle cover photo (single photo per car, not a gallery).
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Stored as a normal `documents` row (document_type='vehicle_photo') the same
-- way every other file in the app is stored — but referenced directly by a FK
-- from `vehicles`, so there is always at most ONE photo per car. Replacing the
-- photo swaps the FK to a new document and removes the old one; there is no
-- separate photo table and no gallery/list semantics.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.vehicles
  add column if not exists photo_document_id uuid null references public.documents(id) on delete set null;

create index if not exists vehicles_photo_document_idx on public.vehicles (photo_document_id);
