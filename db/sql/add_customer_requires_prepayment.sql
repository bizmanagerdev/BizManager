alter table public.customers
add column if not exists requires_prepayment boolean not null default false;
