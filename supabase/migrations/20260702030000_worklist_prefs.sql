-- Per-user worklist ("מה דורש טיפול") section layout — which reminder-type
-- sections to show and in what order. Mirrors dashboard_prefs.
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Shape: { "order": ["tasks","money",...], "hidden": ["ops"] } — section ids only.
-- NULL = never customized → the default section order for everyone.

alter table public.users
  add column if not exists worklist_prefs jsonb;

comment on column public.users.worklist_prefs is
  'Per-user worklist section layout (NULL = defaults). { order: section-id[], hidden: section-id[] }.';

-- Let any signed-in user update ONLY their own worklist_prefs. security definer +
-- auth.uid() scoping keeps it self-limited (mirrors set_my_dashboard_prefs).
create or replace function public.set_my_worklist_prefs(p_prefs jsonb)
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
  set worklist_prefs = v_prefs
  where auth_user_id = auth.uid();

  return v_prefs;
end;
$$;

grant execute on function public.set_my_worklist_prefs(jsonb) to authenticated;
