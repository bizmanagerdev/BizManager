-- Run this in Supabase SQL Editor.
-- Recommended clarity migration:
-- 1. Rename the current monthly aggregate view.
-- 2. Recreate cash_flow_view as a compatibility alias during transition.

alter view if exists public.cash_flow_view rename to cash_flow_monthly_view;

create or replace view public.cash_flow_view as
select
  month,
  total_income,
  total_expenses,
  net_cash_flow
from public.cash_flow_monthly_view;

grant select on public.cash_flow_monthly_view to authenticated;
grant select on public.cash_flow_view to authenticated;
