-- "This one genuinely belongs to nothing in particular."
--
-- document_links always points at ONE row, so a delivery note that relates to
-- the sales side generally — rather than to a specific order — has nothing it
-- can honestly be attached to. Until now the only way to clear it out of
-- "ללא שיוך" was to invent a link to an order it does not really belong to,
-- which is worse than leaving it unfiled: it puts a wrong document on a real
-- order's page.
--
-- This flag says the absence of a link is a DECISION, not a backlog item. The
-- document keeps its category and its business_domain (which is where the
-- "these are sales documents" fact already lives); it just stops being counted
-- as unfiled.
--
-- Deliberately NOT a fake link and NOT a magic "general" entity row: either
-- would pollute a real entity's document list.
--
-- Idempotent and additive — the column is nullable-with-default, so inserts
-- that never mention it keep working.

alter table public.documents
  add column if not exists no_link_needed boolean not null default false;

comment on column public.documents.no_link_needed is
  'Set when a document deliberately has no single owner (e.g. a note covering sales generally). Excluded from the "ללא שיוך" facet and from unfiled counts; it is a decision, not a backlog item.';

-- Partial: only the handful of rows that carry the flag.
create index if not exists documents_no_link_needed_idx
  on public.documents (no_link_needed)
  where no_link_needed = true;
