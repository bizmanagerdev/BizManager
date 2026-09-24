-- ════════════════════════════════════════════════════════════════════════════
-- Why is this document showing "ללא שיוך"?
--
-- A document counts as attached if ANY of these is true:
--   * it has a document_links row (the polymorphic path)
--   * it has an entity_tags row (a vehicle or other tag)
--   * some table points at it by foreign key — see lib/documents/owners.ts:
--       vehicles.photo_document_id · card_statements.document_id ·
--       bank_statements.document_id · lease_agreements.document_id ·
--       morning_documents.document_id
--
-- The archive resolves all of them. So anything this query returns is genuinely
-- unattached IN THE DATA, not a display bug — the owner row was deleted, or the
-- flow that should have created the link never finished (a statement uploaded
-- but the import abandoned is the common one).
--
-- Read-only. Safe to run any time.
-- ════════════════════════════════════════════════════════════════════════════

select
  d.id,
  d.title,
  d.file_name,
  d.document_type          as category,
  d.source,                                  -- where it came from
  d.business_domain        as domain,
  d.uploaded_at,
  -- The likely reason, in plain terms.
  case
    when d.source = 'vehicle_photo'
      then 'צילום רכב שאיבד את הרכב — הרכב נמחק, או שההחלפה/מחיקה נכשלה באמצע'
    when d.source in ('card_statement', 'bank_statement')
      then 'דף חיוב שהועלה אך הייבוא לא הושלם — אין שורה ב-card_statements/bank_statements'
    when d.source = 'task_attachment'
      then 'צרופת משימה שהמשימה שלה נמחקה'
    when d.source in ('expense_attachment', 'payment_attachment', 'session_attachment')
      then 'צרופת תנועה שהתנועה שלה נמחקה'
    when d.source = 'manual_upload'
      then 'הועלה ידנית בלי לבחור לקוח/פרויקט/נכס — זה פשוט לא שויך מעולם'
    else 'לא ידוע — בדוק ידנית'
  end                      as likely_reason
from public.documents d
where not exists (select 1 from public.document_links dl where dl.document_id = d.id)
  and not exists (
    select 1 from public.entity_tags et
    where et.entity_type = 'document' and et.entity_id = d.id
  )
  and not exists (select 1 from public.vehicles v where v.photo_document_id = d.id)
  and not exists (select 1 from public.card_statements cs where cs.document_id = d.id)
  and not exists (select 1 from public.bank_statements bs where bs.document_id = d.id)
  and not exists (select 1 from public.lease_agreements la where la.document_id = d.id)
  and not exists (select 1 from public.morning_documents md where md.document_id = d.id)
order by d.uploaded_at desc;

-- ── Summary: how many, and why ──────────────────────────────────────────────
-- Run this second to see whether it is one broken flow or a long tail.
--
-- select coalesce(source, '(null)') as source, count(*)
-- from public.documents d
-- where not exists (select 1 from public.document_links dl where dl.document_id = d.id)
--   and not exists (select 1 from public.entity_tags et
--                   where et.entity_type = 'document' and et.entity_id = d.id)
--   and not exists (select 1 from public.vehicles v where v.photo_document_id = d.id)
--   and not exists (select 1 from public.card_statements cs where cs.document_id = d.id)
--   and not exists (select 1 from public.bank_statements bs where bs.document_id = d.id)
--   and not exists (select 1 from public.lease_agreements la where la.document_id = d.id)
--   and not exists (select 1 from public.morning_documents md where md.document_id = d.id)
-- group by 1 order by 2 desc;

-- ════════════════════════════════════════════════════════════════════════════
-- SWEEP: stranded statement files
--
-- A statement file is uploaded as a `documents` row BEFORE its statement row
-- exists (CardImportClient uploads, then POSTs /api/expenses/import). If that
-- import failed, the document was left behind with nothing pointing at it —
-- which is why some statements show under "ללא שיוך" and others do not: the
-- ones that imported cleanly have a card_statements/bank_statements row.
--
-- The client now rolls the upload back on failure, so this only cleans up the
-- ones stranded before that fix.
--
-- ⚠️ REVIEW THE SELECT BEFORE RUNNING THE DELETE. These rows are real uploaded
-- files; the storage objects are NOT removed by this (delete them from the
-- bucket separately, or leave them — they are orphaned either way).
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Look first.
select d.id, d.title, d.file_name, d.source, d.uploaded_at
from public.documents d
where d.source in ('card_statement', 'bank_statement')
  and not exists (select 1 from public.card_statements cs where cs.document_id = d.id)
  and not exists (select 1 from public.bank_statements bs where bs.document_id = d.id)
  and not exists (select 1 from public.document_links dl where dl.document_id = d.id)
  and d.uploaded_at < now() - interval '1 day'
order by d.uploaded_at desc;

-- 2. Then, if that list is only failed imports, remove them.
-- delete from public.documents d
-- where d.source in ('card_statement', 'bank_statement')
--   and not exists (select 1 from public.card_statements cs where cs.document_id = d.id)
--   and not exists (select 1 from public.bank_statements bs where bs.document_id = d.id)
--   and not exists (select 1 from public.document_links dl where dl.document_id = d.id)
--   and d.uploaded_at < now() - interval '1 day';
