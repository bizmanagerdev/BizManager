-- A worker confirming a delivery with an on-the-spot payment STILL hit
-- "new row violates row-level security policy for table \"payments\"" after both
-- 20260908202057_worker_insert_delivery_payment.sql and
-- 20260909200005_fix_worker_payment_insert_orders_rls_recursion.sql were live
-- (Sentry 2026-09-15 16:32, order מרכז קהילתי בית בינגו, ₪680 check).
--
-- The INSERT policies were never the blocker. app/api/orders/update/route.ts
-- inserts the collected payment as `.insert(rows).select("id")` — the `.select()`
-- adds a RETURNING clause, and Postgres then enforces the table's SELECT policies
-- on the returned rows as additional WITH CHECK options (rowsecurity.c), raising
-- the exact same error text as a failed INSERT check. So the row must ALSO be
-- readable by the worker at the moment it is inserted.
--
-- payments_worker_select_order only let a worker read payments on an OPEN order,
-- through an inline subquery on public.orders that is itself filtered by
-- orders_worker_select_open. The SECURITY DEFINER update_sales_order RPC has
-- already flipped the order to 'delivered' earlier in the same request, so the
-- freshly inserted payment was invisible to its own author and the RETURNING
-- check rejected it. Because the route is not atomic, the order stayed closed
-- and unpaid while the payment was never saved.
--
-- Fix: make the read policy mirror the insert policy — same
-- order_is_worker_deliverable(uuid) SECURITY DEFINER helper (open OR just closed
-- to delivered/completed), no inline subquery into orders' own RLS. This lets a
-- worker read payment rows on orders he can deliver or has delivered; it grants
-- no UPDATE, no reads on payments outside orders (vehicle income stays under its
-- own tagged policy), and the worker role still has no financial section in
-- lib/auth/sections.ts.
--
-- Idempotent / safe to re-run.

drop policy if exists "payments_worker_select_order" on public.payments;
create policy "payments_worker_select_order" on public.payments
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'worker'::user_role_enum
    and order_id is not null
    and public.order_is_worker_deliverable(order_id)
  );
