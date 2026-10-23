-- Undoes supabase/migrations/20261023100000_properties_management_and_owning_company.sql.
-- Puts the global search's property line back, then drops the columns and
-- whatever was filled into them. Take a copy first if they matter:
--   create table backup.properties_management_and_owning_company as
--     select id, rent_managed_by_company, management_company_name, management_portal_url, management_notes,
--            owner_company_name, owner_company_number, owner_company_type, owner_company_url, owner_company_notes
--     from public.properties;

set lock_timeout = '5s';

do $mig$
declare
  v_def text := pg_get_functiondef('public.global_search(jsonb,text,text[],integer)'::regprocedure);
  v_old text := 'pp.gas_contract_number, pp.arnona_contract_number, array_to_string(pp.furniture_items, '', ''),
      pp.management_company_name, pp.management_notes, pp.owner_company_name, pp.owner_company_number,
      pp.owner_company_type, pp.owner_company_notes]::text[],';
  v_new text := 'pp.gas_contract_number, pp.arnona_contract_number, array_to_string(pp.furniture_items, '', '')]::text[],';
begin
  if position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end
$mig$;

alter table public.properties
  drop column if exists owner_company_notes,
  drop column if exists owner_company_url,
  drop column if exists owner_company_type,
  drop column if exists owner_company_number,
  drop column if exists owner_company_name,
  drop column if exists management_notes,
  drop column if exists management_portal_url,
  drop column if exists management_company_name,
  drop column if exists rent_managed_by_company;
