-- ════════════════════════════════════════════════════════════════════════════
-- documents: separate WHERE A FILE CAME FROM from WHAT IT IS, and give a
-- document the dates that let a category actually do something.
--
-- `document_type` has been carrying both meanings at once. A task attachment
-- was filed under the category "task_attachment", which says nothing about what
-- the paper is — so the archive listed "צרופת משימה" next to "חשבונית" as if
-- they were the same kind of fact. `source` takes over the first meaning; it is
-- set by the writing route and is never user-pickable.
--
-- The dates are what make a category actionable at all: until now the table had
-- no date of its own, so "ביטוח" could not expire and "קנס" could not be due.
--
-- Deliberately NOT added: a `status` column. It would mean four different
-- things per category (a contract is active/expired, an invoice is paid/unpaid)
-- — the same one-column-many-vocabularies failure this whole rework is undoing.
-- Expiry state is derivable from valid_until; payment state belongs to the
-- linked payments/expenses row, not to the file.
--
-- Additive and idempotent: every column is nullable, so existing inserts that
-- do not mention them keep working.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.documents add column if not exists source text;
alter table public.documents add column if not exists valid_until date;
alter table public.documents add column if not exists doc_date date;
alter table public.documents add column if not exists amount numeric(14, 2);

comment on column public.documents.source is
  'Where the file came from (task_attachment, card_statement, morning, manual_upload…). Set by the writing route, never user-picked. NOT a category.';
comment on column public.documents.valid_until is
  'Paper expiry date. Only meaningful for categories whose registry row has tracks_expiry; feeds the document_expiry alert rule.';
comment on column public.documents.doc_date is
  'The date ON the document, as opposed to uploaded_at (when it reached the system).';
comment on column public.documents.amount is
  'Amount on the document, used as a match hint when tying a money document to its expense/payment row.';

-- Partial: only a small minority of documents will ever carry an expiry.
create index if not exists documents_valid_until_idx
  on public.documents (valid_until)
  where valid_until is not null;

create index if not exists documents_source_idx
  on public.documents (source)
  where source is not null;
