-- Speed up the per-entity activity timeline (getEntityAuditTrail in lib/audit.ts),
-- which finds related audit rows by a foreign key stored inside new_data, e.g.
--   where table_name = 'payments' and new_data->>'order_id'   = '<uuid>'
--   where table_name = 'orders'   and new_data->>'customer_id' = '<uuid>'
--   where table_name = 'attendance_sessions' and new_data->>'project_id' = '<uuid>'
--
-- NOTE: a GIN index on new_data would NOT help here — GIN accelerates containment
-- (@>) / key-exists (?) operators, not the `->>` text-equality these queries use.
-- The right tool is a B-tree expression index on the extracted key. Pairing it
-- with table_name matches the WHERE clause exactly and keeps each index small.

create index if not exists audit_logs_new_data_order_id_idx
  on public.audit_logs (table_name, (new_data->>'order_id'));

create index if not exists audit_logs_new_data_project_id_idx
  on public.audit_logs (table_name, (new_data->>'project_id'));

create index if not exists audit_logs_new_data_customer_id_idx
  on public.audit_logs (table_name, (new_data->>'customer_id'));
