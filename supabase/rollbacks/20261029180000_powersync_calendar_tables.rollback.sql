-- ROLLBACK for supabase/migrations/20261029180000_powersync_calendar_tables.sql
-- Deploy sync rules without payment_promises (v1.14) first.

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'powersync' and schemaname = 'public' and tablename = 'payment_promises'
  ) then
    alter publication powersync drop table public.payment_promises;
  end if;
end $$;

revoke select on table public.payment_promises from powersync_role;
