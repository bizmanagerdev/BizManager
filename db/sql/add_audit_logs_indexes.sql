create index if not exists audit_logs_table_name_record_id_idx
  on public.audit_logs (table_name, record_id);

create index if not exists audit_logs_created_at_desc_idx
  on public.audit_logs (created_at desc);

create index if not exists audit_logs_changed_by_created_at_desc_idx
  on public.audit_logs (changed_by, created_at desc);
