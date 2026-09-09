-- 20260908202057_worker_insert_delivery_payment.sql shipped payments_worker_insert_order
-- with a WITH CHECK that runs `exists (select 1 from public.orders o where o.id = ... and
-- (order_status_is_open(o.status) or o.status in ('delivered', ...)))`. That subquery is a
-- direct table read on public.orders, so it is ITSELF subject to orders' own RLS policies for
-- the calling worker — specifically orders_worker_select_open, which only lets a worker SELECT
-- an order while it is still open. By the time the payments insert runs in
-- app/api/orders/update/route.ts, the update_sales_order RPC has already committed the order's
-- status to 'delivered' in an earlier, separate request — so the order row is no longer visible
-- to the worker's own SELECT policy, the exists() sees zero rows, and the extra
-- "or o.status in ('delivered', ...)" clause never gets a chance to matter. Net effect: the new
-- policy could never actually succeed for the one moment it exists to cover, and the worker kept
-- hitting "new row violates row-level security policy for table \"payments\"" (Sentry,
-- JAVASCRIPT-NEXTJS-W, 2026-09-09).
--
-- This is the exact trap current_app_user_id() (20260810000000_worker_self_service.sql) was
-- introduced to avoid for public.users lookups — a policy needing to read a row on another
-- RLS-protected table must do so through a SECURITY DEFINER function, not an inline subquery,
-- or it recurses into that table's own policies as the CALLING role.
--
-- Idempotent / safe to re-run.

create or replace function public.order_is_worker_deliverable(p_order_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and (
        public.order_status_is_open(o.status)
        or o.status in ('delivered', 'completed', 'סופקה', 'הושלמה')
      )
  );
$$;

grant execute on function public.order_is_worker_deliverable(uuid) to authenticated;

drop policy if exists "payments_worker_insert_order" on public.payments;
create policy "payments_worker_insert_order" on public.payments
  for insert
  to authenticated
  with check (
    public.current_user_role() = 'worker'::user_role_enum
    and order_id is not null
    and public.order_is_worker_deliverable(order_id)
  );
