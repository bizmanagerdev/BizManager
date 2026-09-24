-- Correct two over-eager is_money_doc flags from 20260922132453.
--
-- `is_money_doc` means "this paper records ONE movement that should be tied to
-- an expense or a payment row". Two of the seeded categories do not:
--
--   דף חיוב אשראי / דף עובר ושב — a statement is a BATCH of movements, and it
--     links to its import through `card_statements.document_id`, not through
--     `document_links`. The unlinked-money check only looks at document_links,
--     so every statement was permanently badged "לא משויך לתנועה". A false
--     positive on a whole category trains people to ignore the badge.
--
--   הצעת מחיר — a quote is an offer. No money has moved, so there is nothing
--     to tie it to. It only becomes money when it turns into an order.
--
-- Idempotent.

update public.document_categories
set is_money_doc = false, updated_at = now()
where code in ('דף חיוב אשראי', 'דף עובר ושב', 'הצעת מחיר', 'morning_10')
  and is_money_doc = true;
