-- ════════════════════════════════════════════════════════════════════════════
-- FIX: "most-ordered products first" must be the SAME for every user.
-- Run in the Supabase SQL Editor.
--
-- PROBLEM
--   products_with_last_used was flipped to security_invoker (to close an anon
--   read leak — see fix_rls_views_security_invoker.sql). Its order_count /
--   last_used_at are computed by joining order_items → orders, and `orders` is
--   RLS-restricted per role:
--     • admin  : admin_full_access_orders            → sees ALL orders
--     • office : office_full_orders                  → sees ALL orders
--     • worker : worker_view_deliverable_orders      → sees ONLY reserved/
--                delivered orders
--   So for a worker the view counts only the handful of orders they can see →
--   the "most-bought first" sort comes out different (or empty → falls back to
--   name order). That's why one user's new-order form doesn't follow the rule.
--
-- FIX
--   Compute the popularity aggregate in a SECURITY DEFINER function so the
--   counts are GLOBAL for every caller. The VIEW stays security_invoker, so:
--     • products RLS still applies (the view only widens the order aggregate),
--     • anon still cannot read it (function granted to authenticated only).
--   order_count / last_used_at are harmless per-product totals — no customer or
--   order-level detail is exposed.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.product_order_stats()
returns table (product_id uuid, order_count bigint, last_used_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    oi.product_id,
    count(*)::bigint               as order_count,
    max(o.order_date)::timestamptz as last_used_at
  from public.order_items oi
  inner join public.orders o on o.id = oi.order_id
  where oi.product_id is not null
  group by oi.product_id
$$;

revoke all on function public.product_order_stats() from public, anon;
grant execute on function public.product_order_stats() to authenticated;

-- Rebuild the view to source the (now global) stats from the function.
create or replace view public.products_with_last_used
with (security_invoker = on) as
select
  p.*,
  os.last_used_at,
  coalesce(os.order_count, 0)::bigint as order_count
from public.products p
left join public.product_order_stats() os on os.product_id = p.id;

grant select on public.products_with_last_used to authenticated;
