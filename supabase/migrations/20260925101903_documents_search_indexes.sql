-- Make the documents archive filter in the database instead of in the browser.
--
-- Until now the page read up to a thousand documents and filtered them in
-- memory. That is instant at two hundred documents and wrong past a thousand:
-- the counts describe the window, not the archive. Moving the filter into SQL
-- fixes that — but only if the filter is fast, and right now none of it is.
--
-- What the archive does on EVERY load, and what it costs today:
--
--   * order by uploaded_at desc      → sequential scan + sort. No index.
--   * document_links where document_id in (…)  → sequential scan. `document_id`
--     is a FOREIGN KEY, and Postgres does not index those; only the primary key
--     on `id` exists, which no query here uses.
--   * entity_tags where entity_id in (…)       → sequential scan, same reason.
--
-- Three sequential scans and a sort, for a page whose whole job is "show me the
-- files". These are the indexes that make the filtered query cheap.
--
-- Plain `create index`, not `concurrently`: migrations run inside a
-- transaction, where CONCURRENTLY is not allowed, and these tables are small
-- enough that the brief write lock is not worth the added complexity of an
-- out-of-band build. Revisit if `documents` ever reaches the millions.
--
-- Idempotent. Safe to re-run.

-- ── the sort every load pays for ────────────────────────────────────────────
-- Matches `order by uploaded_at desc nulls last` exactly, so the planner can
-- walk the index instead of sorting the table.
create index if not exists documents_uploaded_at_desc_idx
  on public.documents (uploaded_at desc nulls last);

-- ── the facets ──────────────────────────────────────────────────────────────
create index if not exists documents_document_type_idx
  on public.documents (document_type);

create index if not exists documents_business_domain_idx
  on public.documents (business_domain);

-- Category + recency together: "every ביטוח, newest first" is one index walk
-- rather than a filter over the whole table followed by a sort.
create index if not exists documents_type_uploaded_at_idx
  on public.documents (document_type, uploaded_at desc nulls last);

-- ── the joins ───────────────────────────────────────────────────────────────
-- The direction the archive reads: given these documents, what are they
-- attached to?
create index if not exists document_links_document_id_idx
  on public.document_links (document_id);

-- …and the direction an entity's own page reads: given this customer, which
-- documents? Both matter, and neither had an index.
create index if not exists document_links_entity_idx
  on public.document_links (entity_type, entity_id);

-- A vehicle holds its papers through entity_tags, so the archive walks this the
-- same two ways.
create index if not exists entity_tags_entity_idx
  on public.entity_tags (entity_type, entity_id);

create index if not exists entity_tags_tag_id_idx
  on public.entity_tags (tag_id);

-- ── search ──────────────────────────────────────────────────────────────────
-- A search box runs `ilike '%…%'`, and a btree index cannot help a leading
-- wildcard — it is a sequential scan however the column is indexed. Trigrams
-- can, so the search stays fast as the archive grows.
--
-- Wrapped because creating an extension needs privileges this migration may not
-- have on every environment. Without it the search still works, just linearly,
-- which at these volumes nobody would notice.
do $$
begin
  create extension if not exists pg_trgm;
exception
  when insufficient_privilege then
    raise notice 'pg_trgm unavailable — document search will scan rather than use a trigram index';
  when others then
    raise notice 'pg_trgm could not be created: %', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create index if not exists documents_title_trgm_idx
      on public.documents using gin (title gin_trgm_ops);
    create index if not exists documents_file_name_trgm_idx
      on public.documents using gin (file_name gin_trgm_ops);
  end if;
end $$;

comment on index public.documents_uploaded_at_desc_idx is
  'The archive orders by uploaded_at desc on every load; without this it sorts the whole table.';
comment on index public.document_links_document_id_idx is
  'document_id is a foreign key, which Postgres does not index. The archive joins on it for every page.';
