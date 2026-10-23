-- ════════════════════════════════════════════════════════════════════════════
-- A property whose rent a management company handles, and the company that
-- owns it (owner, 2026-10-23, the Canada buildings: "rent is managed by the
-- management company, so we need to have a checkbox … we don't deal with the
-- rent"; "the company we opened to purchase the apartment is something else";
-- "just save the details to each apartment").
--
--   properties.rent_managed_by_company   ticked: a management company collects
--                                        the rent — the page shows no renter
--                                        or rent-this-month cards.
--   properties.management_company_*      its name, the owner-portal link and
--                                        anything else about it, as notes.
--   properties.owner_company_*           the company that bought the property:
--                                        name, number (NEQ / ח.פ.), type, the
--                                        registry link, notes.
--
-- Saved on each property — no shared list (owner). The global search reads the
-- companies' names, numbers and notes too: changed in place from the live
-- definition (it is not the repo's text word for word), the property's one line.
--
-- Nothing already saved changes. Rollback: supabase/rollbacks/.
-- ════════════════════════════════════════════════════════════════════════════

set lock_timeout = '5s';

alter table public.properties
  add column if not exists rent_managed_by_company boolean not null default false,
  add column if not exists management_company_name text,
  add column if not exists management_portal_url text,
  add column if not exists management_notes text,
  add column if not exists owner_company_name text,
  add column if not exists owner_company_number text,
  add column if not exists owner_company_type text,
  add column if not exists owner_company_url text,
  add column if not exists owner_company_notes text;

comment on column public.properties.rent_managed_by_company is 'A management company collects the rent: no renter / rent-this-month cards on the page (owner, 2026-10-23).';

do $mig$
declare
  v_def text := pg_get_functiondef('public.global_search(jsonb,text,text[],integer)'::regprocedure);
  v_old text := 'pp.gas_contract_number, pp.arnona_contract_number, array_to_string(pp.furniture_items, '', '')]::text[],';
  v_new text := 'pp.gas_contract_number, pp.arnona_contract_number, array_to_string(pp.furniture_items, '', ''),
      pp.management_company_name, pp.management_notes, pp.owner_company_name, pp.owner_company_number,
      pp.owner_company_type, pp.owner_company_notes]::text[],';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'global_search: the property line is not there exactly once';
  end if;
  execute replace(v_def, v_old, v_new);
end
$mig$;
