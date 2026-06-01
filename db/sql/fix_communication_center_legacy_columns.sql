-- Run in Supabase SQL Editor. Idempotent + non-destructive.
--
-- Fixes: `null value in column "communication_channel" of relation
-- "communication_logs" violates not-null constraint` (and any similar leftover).
--
-- Cause: the deployed communication_logs / reminders tables were created from an
-- older Module-9 spec that used different column names (e.g. communication_channel)
-- with NOT NULL. The app's schema (create_communication_center.sql) and all code
-- use `channel`, `direction`, etc. The idempotent setup script added the app
-- columns alongside the legacy ones, but the legacy NOT-NULL columns — which the
-- app never populates — block every insert.
--
-- This relaxes NOT NULL on any column the app does not write to (it does NOT drop
-- columns, so no data is lost). After running, logging a call works again.

-- communication_logs: drop NOT NULL on any leftover column the app doesn't fill.
do $$
declare
  col record;
  app_cols text[] := array[
    'id','customer_id','user_id','channel','direction','content','category',
    'order_id','project_id','property_id','payment_id','created_by','created_at'
  ];
begin
  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'communication_logs'
      and is_nullable = 'NO'
      and column_default is null
      and column_name <> all(app_cols)
  loop
    execute format('alter table public.communication_logs alter column %I drop not null', col.column_name);
  end loop;
end $$;

-- reminders: same treatment (remind_at is intentionally required and is in the
-- keep-list, so it stays NOT NULL).
do $$
declare
  col record;
  app_cols text[] := array[
    'id','customer_id','project_id','assigned_to','remind_at','content','action_type',
    'status','category','order_id','property_id','payment_id','communication_log_id',
    'created_by','created_at','updated_by','updated_at'
  ];
begin
  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reminders'
      and is_nullable = 'NO'
      and column_default is null
      and column_name <> all(app_cols)
  loop
    execute format('alter table public.reminders alter column %I drop not null', col.column_name);
  end loop;
end $$;
