-- Register the "מסמכים כספיים ללא שיוך לתנועה" live rule in the unified alert
-- center. Run in the Supabase SQL Editor. Idempotent.
--
-- Rule: a document whose category is flagged `is_money_doc` (חשבונית, קבלה,
-- צק, קנס, אישור תשלום, דפי חיוב…) with no `document_links` row pointing at an
-- expense or a payment. The paper says money moved; the books do not.
--
-- SILENT and COLLAPSED to ONE summary line — there is no per-invoice push here,
-- the same shape as unprocessed_items. It links to /documents?money=unlinked,
-- where each row has a "שיוך לתנועה" action that connects the EXISTING file
-- instead of re-uploading it onto the expense.
--
-- Deliberately kept separate from unprocessed_items rather than folded into its
-- count: that rule sends you to /financial/statements, which is the wrong place
-- to resolve this.
--
-- A 3-day grace period (UNLINKED_MONEY_GRACE_DAYS in lib/documents/moneyLink.ts)
-- keeps a receipt uploaded this morning out of the count.

insert into public.push_alert_config (title, body, url, mode, rule_key, audience_role, enabled, send_hour_israel)
values (
  'מסמכים כספיים ללא שיוך לתנועה', '', '/documents?money=unlinked',
  'live', 'document_unlinked_money', 'office', true, 8
)
on conflict (rule_key) where rule_key is not null do nothing;
