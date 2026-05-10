alter table public.products
add column if not exists low_stock_threshold numeric not null default 5;

alter table public.products
drop constraint if exists products_low_stock_threshold_nonnegative;

alter table public.products
add constraint products_low_stock_threshold_nonnegative
check (low_stock_threshold >= 0);
