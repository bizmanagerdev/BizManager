-- Undoes supabase/migrations/20261023120000_properties_zoning_region_tax_account.sql.
-- Puts the global search's property line back, then drops the columns and
-- whatever was filled into them. Take a copy first if they matter:
--   create table backup.properties_zoning_region_tax_account as
--     select id, zoning, region, tax_account_number from public.properties;

set lock_timeout = '5s';

do $mig$
declare
  v_def text := pg_get_functiondef('public.global_search(jsonb,text,text[],integer)'::regprocedure);
  v_old text := 'pp.owner_company_type, pp.owner_company_notes, pp.zoning, pp.region, pp.tax_account_number]::text[],';
  v_new text := 'pp.owner_company_type, pp.owner_company_notes]::text[],';
begin
  if position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end
$mig$;

alter table public.properties
  drop column if exists tax_account_number,
  drop column if exists region,
  drop column if exists zoning;
