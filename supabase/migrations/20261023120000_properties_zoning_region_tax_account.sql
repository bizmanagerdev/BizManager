-- ════════════════════════════════════════════════════════════════════════════
-- A property's zoning, region and tax account, as details of its first card
-- (owner, 2026-10-23, the Canada buildings: "put these … as details here, add
-- the columns" — ייעוד: מגורים · מחוז Quebec · חשבון מס 020874-10, beside דירות).
--
--   properties.zoning              ייעוד — מגורים, מסחר…
--   properties.region              מחוז — Quebec
--   properties.tax_account_number  חשבון מס — the city's property-tax account
--                                  (Montréal's 020874-10). An Israeli
--                                  apartment's ארנונה stays its contract number.
--
-- The global search reads them too: its property line changed in place, after
-- the companies' fields (20261023100000).
--
-- Nothing already saved changes. Rollback: supabase/rollbacks/.
-- ════════════════════════════════════════════════════════════════════════════

set lock_timeout = '5s';

alter table public.properties
  add column if not exists zoning text,
  add column if not exists region text,
  add column if not exists tax_account_number text;

do $mig$
declare
  v_def text := pg_get_functiondef('public.global_search(jsonb,text,text[],integer)'::regprocedure);
  v_old text := 'pp.owner_company_type, pp.owner_company_notes]::text[],';
  v_new text := 'pp.owner_company_type, pp.owner_company_notes, pp.zoning, pp.region, pp.tax_account_number]::text[],';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'global_search: the property line is not there exactly once';
  end if;
  execute replace(v_def, v_old, v_new);
end
$mig$;
