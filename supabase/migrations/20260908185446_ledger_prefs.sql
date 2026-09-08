-- Per-user "תנועות" ledger view preference (group-by / sort-by on the project
-- money-movements table). Mirrors dashboard_prefs / worklist_prefs.
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Shape: { "groupBy": "none"|"employee"|"category"|"date",
--          "sortBy": "date"|"amount"|"status", "sortDirection": "asc"|"desc" }
-- NULL = never customized → the default view (no grouping, newest date first).

alter table public.users
  add column if not exists ledger_prefs jsonb;

comment on column public.users.ledger_prefs is
  'Per-user תנועות ledger view (NULL = defaults). { groupBy, sortBy, sortDirection }.';

-- Let any signed-in user update ONLY their own ledger_prefs. security definer +
-- auth.uid() scoping keeps it self-limited (mirrors set_my_dashboard_prefs).
create or replace function public.set_my_ledger_prefs(p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefs jsonb := p_prefs;
begin
  if v_prefs is not null and jsonb_typeof(v_prefs) <> 'object' then
    v_prefs := null;
  end if;

  update public.users
  set ledger_prefs = v_prefs
  where auth_user_id = auth.uid();

  return v_prefs;
end;
$$;

grant execute on function public.set_my_ledger_prefs(jsonb) to authenticated;
