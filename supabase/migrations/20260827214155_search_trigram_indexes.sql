-- Orders/Projects search (and the shared global-search helpers in
-- lib/search/findMatchingCustomers.ts and lib/search/findMatchingChildIds.ts)
-- all filter with leading-wildcard `ilike '%term%'` against these columns.
-- A plain btree index can't serve that pattern, so every keystroke was doing a
-- sequential scan (with RLS quals re-evaluated per row) over customers,
-- contacts, orders, order_items, tasks, task_comments and products — the
-- direct cause of the slow search and the "canceling statement due to
-- statement timeout" error on /projects.
--
-- pg_trgm + a GIN index lets Postgres serve `ilike '%term%'` from the index.
create extension if not exists pg_trgm;

create index if not exists idx_projects_name_trgm
  on public.projects using gin (name gin_trgm_ops);
create index if not exists idx_projects_notes_trgm
  on public.projects using gin (notes gin_trgm_ops);

create index if not exists idx_customers_name_trgm
  on public.customers using gin (name gin_trgm_ops);
create index if not exists idx_customers_name_for_invoice_trgm
  on public.customers using gin (name_for_invoice gin_trgm_ops);
create index if not exists idx_customers_email_trgm
  on public.customers using gin (email gin_trgm_ops);
create index if not exists idx_customers_phone_trgm
  on public.customers using gin (phone gin_trgm_ops);
create index if not exists idx_customers_whatsapp_trgm
  on public.customers using gin (whatsapp gin_trgm_ops);
create index if not exists idx_customers_address_trgm
  on public.customers using gin (address gin_trgm_ops);

create index if not exists idx_contacts_full_name_trgm
  on public.contacts using gin (full_name gin_trgm_ops);
create index if not exists idx_contacts_phone_trgm
  on public.contacts using gin (phone gin_trgm_ops);
create index if not exists idx_contacts_email_trgm
  on public.contacts using gin (email gin_trgm_ops);
create index if not exists idx_contacts_whatsapp_trgm
  on public.contacts using gin (whatsapp gin_trgm_ops);

create index if not exists idx_orders_notes_trgm
  on public.orders using gin (notes gin_trgm_ops);
create index if not exists idx_order_items_notes_trgm
  on public.order_items using gin (notes gin_trgm_ops);

create index if not exists idx_tasks_subject_trgm
  on public.tasks using gin (subject gin_trgm_ops);
create index if not exists idx_tasks_description_trgm
  on public.tasks using gin (description gin_trgm_ops);
create index if not exists idx_task_comments_body_trgm
  on public.task_comments using gin (body gin_trgm_ops);

create index if not exists idx_products_name_trgm
  on public.products using gin (name gin_trgm_ops);
create index if not exists idx_products_sku_trgm
  on public.products using gin (sku gin_trgm_ops);
create index if not exists idx_products_barcode_trgm
  on public.products using gin (barcode gin_trgm_ops);

-- Default/alternate sort columns on the projects list (app/(app)/projects/loadProjects.ts).
create index if not exists idx_projects_start_date_desc
  on public.projects (start_date desc);
create index if not exists idx_projects_updated_at_desc
  on public.projects (updated_at desc);
