-- Run in Supabase SQL Editor
-- Practical indexes for faster pages/mutations used in this app.

create index if not exists idx_orders_order_date_desc on public.orders (order_date desc);
create index if not exists idx_orders_customer_status on public.orders (customer_id, status, payment_status);

create index if not exists idx_customers_name on public.customers (name);
create index if not exists idx_customers_email on public.customers (email);

create index if not exists idx_tasks_due_date on public.tasks (due_date);
create index if not exists idx_tasks_status_priority on public.tasks (status, priority);

create index if not exists idx_inventory_movements_date on public.inventory_movements (movement_date desc);
create index if not exists idx_inventory_movements_product on public.inventory_movements (product_id);
