-- A worker confirming a delivery where the customer paid ON THE SPOT (cash/check
-- handed to the driver, not a bank transfer handled separately by the office)
-- could not finish the אישור אספקה wizard: the final "confirm" step inserts a
-- row into public.payments via the normal RLS-bound client
-- (app/api/orders/update/route.ts, POST /api/orders/update), and no tracked
-- INSERT policy on payments actually covers a worker doing that. Two later
-- migrations (20260810000000_worker_self_service.sql line 294,
-- 20260908104000_worker_vehicle_payments_rls.sql line 12) both refer to a
-- policy called worker_insert_payment as if it already existed and were
-- unconditional — but no CREATE POLICY for it exists anywhere in
-- supabase/migrations/ or db/sql/. It was evidently applied by hand in the
-- Supabase SQL editor at some point and never captured, or never applied at
-- all. Either way the wizard's final step failed with Postgres's row-level-
-- security rejection, surfaced to the driver as the generic
-- "אין הרשאה לבצע את הפעולה."
--
-- This does NOT reopen financial data to workers generally (there is still no
-- payments UPDATE/SELECT-everything policy for them, and the worker role has
-- no financial section in lib/auth/sections.ts). It only lets a worker record
-- a payment tied to an order he is actually entitled to deliver/close, mirroring
-- orders_worker_update_open's WITH CHECK: the order must be open right now, OR
-- must have just been closed to delivered/completed by the SAME confirmation
-- (the RPC update_sales_order flips the order's status to 'delivered' BEFORE
-- this payments insert runs later in the same request, so checking only
-- order_status_is_open() would still reject it at the exact moment it's needed).
--
-- Idempotent / safe to re-run.

drop policy if exists "payments_worker_insert_order" on public.payments;
create policy "payments_worker_insert_order" on public.payments
  for insert
  to authenticated
  with check (
    public.current_user_role() = 'worker'::user_role_enum
    and order_id is not null
    and exists (
      select 1 from public.orders o
      where o.id = payments.order_id
        and (
          public.order_status_is_open(o.status)
          or o.status in ('delivered', 'completed', 'סופקה', 'הושלמה')
        )
    )
  );
