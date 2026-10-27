-- Rollback for 20261027190000_drivers_confirm_deliveries_only.sql.
--
-- Takes out the driver rule (the block between the two "-- driver rule" marker
-- lines in update_sales_order) and lets any active user call
-- create_sales_order again. The definitions from before are in
-- backup.security_20261027_orders (kind, name, definition).

do $mig$
declare
  v_fn regprocedure;
  v_def text;
  v_new text;
begin
  v_fn := to_regprocedure(
    'public.update_sales_order(uuid,uuid,timestamp with time zone,text,numeric,numeric,numeric,text,uuid,text,jsonb,text,date,timestamp with time zone,date,uuid,jsonb,jsonb)'
  );
  if v_fn is not null then
    v_def := replace(pg_get_functiondef(v_fn), E'\r\n', E'\n');
    v_new := regexp_replace(v_def, E'\\n  -- driver rule \\(20261027190000\\) begin.*?  -- driver rule end\\n', '');
    if v_new <> v_def then
      execute v_new;
    end if;
  end if;

  for v_fn in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_sales_order'
  loop
    v_def := replace(pg_get_functiondef(v_fn), E'\r\n', E'\n');
    v_new := replace(
      v_def,
      'perform public.require_app_role(array[''admin'', ''office'']::public.user_role_enum[]);  -- guard: require_app_role',
      'perform public.require_app_role();  -- guard: require_app_role'
    );
    if v_new <> v_def then
      execute v_new;
    end if;
  end loop;
end
$mig$;
