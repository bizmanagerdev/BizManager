alter table public.customers
add column if not exists morning_client_id text null,
add column if not exists morning_synced_at timestamptz null,
add column if not exists morning_match_status text null
  check (morning_match_status in ('unmatched', 'matched', 'manual_review', 'ignored')),
add column if not exists morning_last_sync_error text null;

create index if not exists customers_morning_client_id_idx
  on public.customers (morning_client_id);

create table if not exists public.morning_documents (
  id uuid primary key default gen_random_uuid(),
  morning_document_id text not null,
  morning_document_number text null,
  document_type int not null,
  document_type_label text not null,
  status text not null default 'created',
  customer_id uuid references public.customers(id),
  order_id uuid references public.orders(id),
  project_id uuid references public.projects(id),
  payment_id uuid references public.payments(id),
  document_id uuid references public.documents(id),
  morning_client_id text null,
  amount numeric null,
  currency text not null default 'ILS',
  morning_url text null,
  pdf_url text null,
  source_payload jsonb null,
  response_payload jsonb null,
  issued_by uuid references public.users(id),
  issued_at timestamptz default now(),
  closed_at timestamptz null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists morning_documents_customer_id_idx
  on public.morning_documents (customer_id);

create index if not exists morning_documents_order_id_idx
  on public.morning_documents (order_id);

create index if not exists morning_documents_project_id_idx
  on public.morning_documents (project_id);

create index if not exists morning_documents_payment_id_idx
  on public.morning_documents (payment_id);

create index if not exists morning_documents_morning_document_id_idx
  on public.morning_documents (morning_document_id);
