-- ════════════════════════════════════════════════════════════════════════════
-- Worker self-service: a worker sees his OWN payroll data and reports his OWN
-- shifts into the existing admin approval queue.
--
-- Two things happen here.
--
-- 1) IDENTITY FIX (this is a live bug, not a nicety).
--    public.users.id is an independent app PK; the auth link is
--    public.users.auth_user_id (20260629000000_fix_legacy_auth_uid_identity.sql).
--    Every "own row" policy on the payroll tables was written against the app PK
--    (`user_id = auth.uid()`), which only ever matches accounts that
--    self-registered (where the two happen to be equal). A worker created by an
--    admin in the salary centre — the normal case, via admin_upsert_user_profile,
--    which inserts a FRESH users.id — matches none of them, so he reads zero rows
--    from users/attendance_sessions/payslips and cannot use the app at all.
--    They are all re-created below against public.current_app_user_id().
--
--    The pre-existing `users_can_view_self` policy is deliberately LEFT IN PLACE
--    rather than replaced: it is permissive (policies OR together), and dropping
--    it would lock out any legacy row whose auth_user_id was never backfilled.
--
-- 2) SELF-REPORTED SHIFTS. A worker may open a shift and submit it, and that is
--    all: the row lands in phone_attendance_reports exactly like a kosher-phone
--    call (source = 'app'), so an admin still classifies the business domain and
--    approves it before it becomes an attendance_sessions row that touches
--    payroll. The worker's WRITE policies on attendance_sessions are dropped for
--    the same reason — nothing may reach payroll without passing the queue.
--
-- Idempotent / safe to re-run. Run in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Canonical identity helper ────────────────────────────────────────────────
-- The app PK of the calling account. SECURITY DEFINER so a policy can use it
-- without the caller needing to read public.users first (which is itself
-- RLS-gated), and STABLE so it is evaluated once per statement, not per row.
create or replace function public.current_app_user_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select u.id from public.users u where u.auth_user_id = auth.uid() limit 1;
$$;

grant execute on function public.current_app_user_id() to authenticated;

-- (users' own-profile read is already correct — 20260629000000 re-pointed
--  users_can_view_self at the auth link. Nothing to do here.)

-- ── attendance_sessions: read-only, own rows ─────────────────────────────────
-- The write policies are removed on purpose: an approved session is payroll, and
-- payroll is created by an admin approving a queued report, never by the worker.
drop policy if exists "attendance_worker_insert_own" on public.attendance_sessions;
drop policy if exists "attendance_worker_update_own" on public.attendance_sessions;
drop policy if exists "attendance_worker_select_own" on public.attendance_sessions;
create policy "attendance_worker_select_own"
on public.attendance_sessions
for select
to authenticated
using (user_id = public.current_app_user_id());

-- ── payslips + their line items ──────────────────────────────────────────────
drop policy if exists "payslips_view_own" on public.payslips;
create policy "payslips_view_own"
on public.payslips
for select
to authenticated
using (user_id = public.current_app_user_id());

drop policy if exists "payslip_items_view_own" on public.payslip_items;
create policy "payslip_items_view_own"
on public.payslip_items
for select
to authenticated
using (
  exists (
    select 1
    from public.payslips p
    where p.id = payslip_items.payslip_id
      and p.user_id = public.current_app_user_id()
  )
);

-- ── salary agreement + hourly overrides: your own terms ──────────────────────
drop policy if exists "salary_view_own" on public.salary_agreements;
create policy "salary_view_own"
on public.salary_agreements
for select
to authenticated
using (user_id = public.current_app_user_id());

drop policy if exists "hourly_salary_overrides_view_own" on public.hourly_salary_overrides;
create policy "hourly_salary_overrides_view_own"
on public.hourly_salary_overrides
for select
to authenticated
using (user_id = public.current_app_user_id());

-- ── what you were actually PAID ──────────────────────────────────────────────
-- Without these two, worker_debt_items_view (security_invoker) shows a worker his
-- earnings with paid_amount permanently 0 — every shift would read "unpaid".
drop policy if exists "worker_payments_view_own" on public.worker_payments;
create policy "worker_payments_view_own"
on public.worker_payments
for select
to authenticated
using (user_id = public.current_app_user_id());

drop policy if exists "worker_payment_allocations_view_own" on public.worker_payment_allocations;
create policy "worker_payment_allocations_view_own"
on public.worker_payment_allocations
for select
to authenticated
using (
  exists (
    select 1
    from public.worker_payments wp
    where wp.id = worker_payment_allocations.worker_payment_id
      and wp.user_id = public.current_app_user_id()
  )
);

-- ── phone_attendance_reports: the worker's own queue rows ────────────────────
-- 'app' joins 'phone' / 'phone_manual' as a report source. No constraint on the
-- column, so this is documentation — the app writes it and the queue labels it.
comment on column public.phone_attendance_reports.source is
  'Where the report came from: phone (call-in), phone_manual (added by staff), app (worker self-report).';

-- Read your own reports (open shift, pending approval, and the history).
drop policy if exists "phone_attendance_worker_select_own" on public.phone_attendance_reports;
create policy "phone_attendance_worker_select_own"
on public.phone_attendance_reports
for select
to authenticated
using (user_id = public.current_app_user_id());

-- Open a shift: your own row, from the app, and it must start as 'open'. The
-- partial unique index phone_attendance_reports_one_open_per_user still allows
-- only one at a time.
drop policy if exists "phone_attendance_worker_insert_own" on public.phone_attendance_reports;
create policy "phone_attendance_worker_insert_own"
on public.phone_attendance_reports
for insert
to authenticated
with check (
  user_id = public.current_app_user_id()
  and status = 'open'
  and source = 'app'
);

-- Close a shift: only your own STILL-OPEN app report, and only into
-- pending_review. USING pins the pre-image (can't touch an already-reviewed row),
-- WITH CHECK pins the post-image (can't self-approve, can't reassign the row to
-- someone else, can't relabel the source).
drop policy if exists "phone_attendance_worker_close_own" on public.phone_attendance_reports;
create policy "phone_attendance_worker_close_own"
on public.phone_attendance_reports
for update
to authenticated
using (
  user_id = public.current_app_user_id()
  and status = 'open'
  and source = 'app'
)
with check (
  user_id = public.current_app_user_id()
  and status = 'pending_review'
  and source = 'app'
);

-- ════════════════════════════════════════════════════════════════════════════
-- PART 2 — the delivery run.
--
-- A worker's delivery policies already existed but were written against a status
-- vocabulary the application never writes: `status in ('reserved','delivered')`.
-- 'reserved' is not one of the nine statuses in ORDER_STATUS_OPTIONS, and
-- 'delivered' is CLOSED — the deliveries queue filters it out. Net effect today:
-- a worker's delivery list is empty and he can update nothing. Worse, the UPDATE
-- policies had no WITH CHECK at all, so the post-image was unconstrained.
--
-- Replaced below with the real vocabulary. "Open" = anything not yet finished:
--   draft · confirmed · processing · out_for_delivery · partially_delivered
-- (plus the Hebrew literals some legacy rows carry, matching the app's own
-- CLOSED_ORDER_STATUSES list in app/(app)/sales/loadDeliveries.ts).
-- ════════════════════════════════════════════════════════════════════════════

-- Is this an order still out for delivery? Kept as a function so the four
-- policies below can't drift from one another.
create or replace function public.order_status_is_open(p_status text)
  returns boolean
  language sql
  immutable
as $$
  select coalesce(p_status, '') not in (
    'delivered', 'completed', 'closed', 'cancelled',
    'סופקה', 'הושלמה', 'סגורה', 'בוטלה'
  );
$$;

grant execute on function public.order_status_is_open(text) to authenticated;

-- Orders: read the open ones, and close them out by delivering.
drop policy if exists "worker_view_deliverable_orders" on public.orders;
drop policy if exists "orders_worker_select_open" on public.orders;
create policy "orders_worker_select_open"
on public.orders
for select
to authenticated
using (
  public.current_user_role() = 'worker'::user_role_enum
  and public.order_status_is_open(status)
);

-- The post-image is pinned to the outcomes a delivery can actually produce, so
-- a driver can mark an order delivered but not cancel or re-open one.
drop policy if exists "worker_update_deliverable_orders" on public.orders;
drop policy if exists "orders_worker_update_open" on public.orders;
create policy "orders_worker_update_open"
on public.orders
for update
to authenticated
using (
  public.current_user_role() = 'worker'::user_role_enum
  and public.order_status_is_open(status)
)
with check (
  public.current_user_role() = 'worker'::user_role_enum
  and (
    public.order_status_is_open(status)
    or status in ('delivered', 'completed', 'סופקה', 'הושלמה')
  )
);

-- Order lines: what to load onto the van, and how much of it was handed over.
drop policy if exists "worker_view_order_items" on public.order_items;
drop policy if exists "order_items_worker_select" on public.order_items;
create policy "order_items_worker_select"
on public.order_items
for select
to authenticated
using (
  public.current_user_role() = 'worker'::user_role_enum
  and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and public.order_status_is_open(o.status)
  )
);

drop policy if exists "worker_update_order_items" on public.order_items;
drop policy if exists "order_items_worker_update" on public.order_items;
create policy "order_items_worker_update"
on public.order_items
for update
to authenticated
using (
  public.current_user_role() = 'worker'::user_role_enum
  and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and public.order_status_is_open(o.status)
  )
)
with check (
  public.current_user_role() = 'worker'::user_role_enum
  and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
  )
);

-- Customers: who to deliver to. Read-only, and it is the whole customer list by
-- design — the delivery queue is the whole open list, not a per-driver
-- assignment. No money columns live on this table.
drop policy if exists "customers_worker_select" on public.customers;
create policy "customers_worker_select"
on public.customers
for select
to authenticated
using (public.current_user_role() = 'worker'::user_role_enum);

-- Standing arrival directions + the drop-off pin are saved on the CUSTOMER by
-- the delivery confirmation, so the next driver inherits them.
drop policy if exists "customers_worker_update_delivery_location" on public.customers;
create policy "customers_worker_update_delivery_location"
on public.customers
for update
to authenticated
using (public.current_user_role() = 'worker'::user_role_enum)
with check (public.current_user_role() = 'worker'::user_role_enum);

-- Payments on an open order: needed to show what is still owed before the driver
-- collects. Writing one is already covered by the existing worker_insert_payment.
drop policy if exists "payments_worker_select_order" on public.payments;
create policy "payments_worker_select_order"
on public.payments
for select
to authenticated
using (
  public.current_user_role() = 'worker'::user_role_enum
  and order_id is not null
  and exists (
    select 1 from public.orders o
    where o.id = payments.order_id
      and public.order_status_is_open(o.status)
  )
);

-- Proof-of-delivery photos: a worker may already upload them
-- (documents_worker_insert / document_links_worker_insert); without a matching
-- read he can't see the ones already on the order.
drop policy if exists "documents_worker_select_order" on public.documents;
create policy "documents_worker_select_order"
on public.documents
for select
to authenticated
using (
  public.current_user_role() = 'worker'::user_role_enum
  and exists (
    select 1 from public.document_links dl
    where dl.document_id = documents.id
      and dl.entity_type = 'order'
  )
);

drop policy if exists "document_links_worker_select_order" on public.document_links;
create policy "document_links_worker_select_order"
on public.document_links
for select
to authenticated
using (
  public.current_user_role() = 'worker'::user_role_enum
  and entity_type = 'order'
);
