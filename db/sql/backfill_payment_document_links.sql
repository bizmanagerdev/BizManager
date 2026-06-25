-- ════════════════════════════════════════════════════════════════════════════
-- Backfill: relate EXISTING financial-attachment documents (check photos, payment
-- receipts, expense attachments, work-session attachments) to the order / project
-- / customer they belong to.
--
-- New uploads do this automatically (app/api/financial-attachments/upload). This
-- one-time backfill fixes older files that were only linked to the payment /
-- expense / session and therefore showed "ללא שיוך" in the documents archive.
--
-- Run in the Supabase SQL Editor. Idempotent — safe to re-run (NOT EXISTS guards).
-- Domain is left to inference: once a doc links to its order it shows מכירות; to
-- its project, the project's domain. Manual "שינוי תחום" overrides still win.
-- ════════════════════════════════════════════════════════════════════════════

-- payment → order
insert into public.document_links (document_id, entity_type, entity_id)
select distinct dl.document_id, 'order', p.order_id
from public.document_links dl
join public.payments p on p.id = dl.entity_id
where dl.entity_type = 'payment'
  and p.order_id is not null
  and not exists (
    select 1 from public.document_links x
    where x.document_id = dl.document_id and x.entity_type = 'order' and x.entity_id = p.order_id
  );

-- payment → project
insert into public.document_links (document_id, entity_type, entity_id)
select distinct dl.document_id, 'project', p.project_id
from public.document_links dl
join public.payments p on p.id = dl.entity_id
where dl.entity_type = 'payment'
  and p.project_id is not null
  and not exists (
    select 1 from public.document_links x
    where x.document_id = dl.document_id and x.entity_type = 'project' and x.entity_id = p.project_id
  );

-- payment → customer (via its order)
insert into public.document_links (document_id, entity_type, entity_id)
select distinct dl.document_id, 'customer', o.customer_id
from public.document_links dl
join public.payments p on p.id = dl.entity_id
join public.orders o on o.id = p.order_id
where dl.entity_type = 'payment'
  and o.customer_id is not null
  and not exists (
    select 1 from public.document_links x
    where x.document_id = dl.document_id and x.entity_type = 'customer' and x.entity_id = o.customer_id
  );

-- payment → customer (via its project, when there is no order)
insert into public.document_links (document_id, entity_type, entity_id)
select distinct dl.document_id, 'customer', pr.customer_id
from public.document_links dl
join public.payments p on p.id = dl.entity_id
join public.projects pr on pr.id = p.project_id
where dl.entity_type = 'payment'
  and p.order_id is null
  and pr.customer_id is not null
  and not exists (
    select 1 from public.document_links x
    where x.document_id = dl.document_id and x.entity_type = 'customer' and x.entity_id = pr.customer_id
  );

-- ── expense attachments ─────────────────────────────────────────────────────

-- expense → order
insert into public.document_links (document_id, entity_type, entity_id)
select distinct dl.document_id, 'order', e.order_id
from public.document_links dl
join public.expenses e on e.id = dl.entity_id
where dl.entity_type = 'expense'
  and e.order_id is not null
  and not exists (
    select 1 from public.document_links x
    where x.document_id = dl.document_id and x.entity_type = 'order' and x.entity_id = e.order_id
  );

-- expense → project
insert into public.document_links (document_id, entity_type, entity_id)
select distinct dl.document_id, 'project', e.project_id
from public.document_links dl
join public.expenses e on e.id = dl.entity_id
where dl.entity_type = 'expense'
  and e.project_id is not null
  and not exists (
    select 1 from public.document_links x
    where x.document_id = dl.document_id and x.entity_type = 'project' and x.entity_id = e.project_id
  );

-- expense → customer (via its order)
insert into public.document_links (document_id, entity_type, entity_id)
select distinct dl.document_id, 'customer', o.customer_id
from public.document_links dl
join public.expenses e on e.id = dl.entity_id
join public.orders o on o.id = e.order_id
where dl.entity_type = 'expense'
  and o.customer_id is not null
  and not exists (
    select 1 from public.document_links x
    where x.document_id = dl.document_id and x.entity_type = 'customer' and x.entity_id = o.customer_id
  );

-- expense → customer (via its project, when there is no order)
insert into public.document_links (document_id, entity_type, entity_id)
select distinct dl.document_id, 'customer', pr.customer_id
from public.document_links dl
join public.expenses e on e.id = dl.entity_id
join public.projects pr on pr.id = e.project_id
where dl.entity_type = 'expense'
  and e.order_id is null
  and pr.customer_id is not null
  and not exists (
    select 1 from public.document_links x
    where x.document_id = dl.document_id and x.entity_type = 'customer' and x.entity_id = pr.customer_id
  );

-- ── work-session attachments (attendance_sessions: project only, no order) ───

-- session → project
insert into public.document_links (document_id, entity_type, entity_id)
select distinct dl.document_id, 'project', s.project_id
from public.document_links dl
join public.attendance_sessions s on s.id = dl.entity_id
where dl.entity_type = 'session'
  and s.project_id is not null
  and not exists (
    select 1 from public.document_links x
    where x.document_id = dl.document_id and x.entity_type = 'project' and x.entity_id = s.project_id
  );

-- session → customer (via its project)
insert into public.document_links (document_id, entity_type, entity_id)
select distinct dl.document_id, 'customer', pr.customer_id
from public.document_links dl
join public.attendance_sessions s on s.id = dl.entity_id
join public.projects pr on pr.id = s.project_id
where dl.entity_type = 'session'
  and pr.customer_id is not null
  and not exists (
    select 1 from public.document_links x
    where x.document_id = dl.document_id and x.entity_type = 'customer' and x.entity_id = pr.customer_id
  );

-- session → user (the worker; attendance_sessions.user_id = public.users.id)
insert into public.document_links (document_id, entity_type, entity_id)
select distinct dl.document_id, 'user', s.user_id
from public.document_links dl
join public.attendance_sessions s on s.id = dl.entity_id
where dl.entity_type = 'session'
  and s.user_id is not null
  and not exists (
    select 1 from public.document_links x
    where x.document_id = dl.document_id and x.entity_type = 'user' and x.entity_id = s.user_id
  );

-- ── explicit business_domain from the source entity ─────────────────────────
-- Payments/expenses/sessions each carry their own authoritative business_domain;
-- copy it onto the document (only where not already set, so manual "שינוי תחום"
-- overrides are preserved).

update public.documents d
set business_domain = p.business_domain::text
from public.document_links dl
join public.payments p on p.id = dl.entity_id
where dl.entity_type = 'payment'
  and dl.document_id = d.id
  and d.business_domain is null
  and p.business_domain is not null;

update public.documents d
set business_domain = e.business_domain::text
from public.document_links dl
join public.expenses e on e.id = dl.entity_id
where dl.entity_type = 'expense'
  and dl.document_id = d.id
  and d.business_domain is null
  and e.business_domain is not null;

update public.documents d
set business_domain = s.business_domain::text
from public.document_links dl
join public.attendance_sessions s on s.id = dl.entity_id
where dl.entity_type = 'session'
  and dl.document_id = d.id
  and d.business_domain is null
  and s.business_domain is not null;
