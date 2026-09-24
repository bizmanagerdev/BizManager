-- ════════════════════════════════════════════════════════════════════════════
-- Backfill documents.source from the codes that were being stored in
-- document_type, then clear document_type only where it never held a category.
--
-- Measured against the live archive (234 rows at the time of writing) this
-- touches ~61 rows: 43 blanked (group A) and 18 remapped (group B).
--
-- 🔴🔴 GROUP C IS NEVER UPDATED. Read this before adding anything below.
--
--   vehicle_photo       — SECURITY PREDICATE. The RLS policies
--                         documents_worker_select_vehicle_photo and
--                         documents_worker_delete_vehicle_photo (baseline +
--                         20260908083000_worker_vehicle_photo_rls.sql) match
--                         this literal. Changing it revokes worker access to
--                         vehicle photos, silently.
--   order_delivery_image— matched by literal in app/(app)/sales/orders/[id]/page.tsx
--                         and app/api/orders/[id]/edit-data/route.ts.
--   project_photo       — rendered as its own kind on the project page.
--   morning_<id>        — minted at runtime by the Morning/GreenInvoice
--                         integration; the app must keep round-tripping them.
--
-- These rows get a `source` set IN ADDITION to their document_type, never
-- instead of it. Verify with, before and after:
--   select count(*) from public.documents where document_type = 'vehicle_photo';
-- The number must not move.
--
-- Idempotent: every statement is guarded on `source is null` or on a value
-- that the previous run already consumed, so re-running is a no-op.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Codes that were the source all along (this INCLUDES group C — setting
--    source here is additive; their document_type is left exactly as it is).
update public.documents
set source = document_type
where source is null
  and document_type in (
    'order_delivery_image', 'project_photo', 'vehicle_photo',
    'project_document', 'session_attachment', 'expense_attachment',
    'payment_attachment', 'task_attachment', 'card_statement',
    'bank_statement', 'loan_document', 'general_document'
  );

-- 2. Morning documents.
update public.documents
set source = 'morning'
where source is null
  and document_type like 'morning\_%';

-- 3. Everything else arrived through a human choosing a category.
update public.documents
set source = 'manual_upload'
where source is null;

-- 4. GROUP A ONLY — these codes never described what the document IS, so the
--    category is cleared and the fact is preserved in `source` (step 1).
--    Group C is deliberately absent from this list.
update public.documents
set document_type = ''
where document_type in (
  'task_attachment', 'payment_attachment', 'session_attachment',
  'expense_attachment', 'project_document', 'loan_document'
);

-- 5. GROUP B — a statement IS a real kind of document, so it gets a real
--    category while `source` remembers which importer produced it.
update public.documents
set document_type = 'דף חיוב אשראי'
where document_type = 'card_statement';

update public.documents
set document_type = 'דף עובר ושב'
where document_type = 'bank_statement';
