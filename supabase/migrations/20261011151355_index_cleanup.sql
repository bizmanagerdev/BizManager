-- Index clean-up from the 10×/20× scale study (owner, 2026-10-11: "if there's
-- missing indexes or duplicate ones, then let's fix it"). Applied to the
-- database through the Supabase connector the same day.

-- Ten indexes repeated another on the same column(s): every save wrote both.
drop index if exists public.idx_document_links_document_id;   -- = document_links_document_id_idx
drop index if exists public.entity_tags_tag_idx;              -- = entity_tags_tag_id_idx
drop index if exists public.idx_expenses_recorded_by;         -- = expenses_recorded_by_idx
drop index if exists public.idx_loans_loan_date;              -- = loans_loan_date_idx
drop index if exists public.idx_order_items_product_id;       -- = order_items_product_id_idx
drop index if exists public.idx_payments_order_id;            -- = payments_order_id_idx
drop index if exists public.project_expenses_expense_idx;     -- = project_expenses_expense_id_idx
drop index if exists public.project_expenses_project_idx;     -- = project_expenses_project_id_idx
drop index if exists public.idx_tasks_assignee;               -- = tasks_assigned_user_id_idx
drop index if exists public.vehicles_tag_idx;                 -- = the unique vehicles_tag_id_key

-- Columns the pages filter and sort by with no index, so each read walked the
-- whole table (cheap today, linear in every order and payment ever).
create index if not exists orders_order_date_idx on public.orders (order_date desc);
create index if not exists orders_requested_delivery_date_idx on public.orders (requested_delivery_date)
  where requested_delivery_date is not null;
create index if not exists payments_due_date_idx on public.payments (due_date)
  where due_date is not null;
create index if not exists worker_payments_payment_date_idx on public.worker_payments (payment_date);
create index if not exists order_delivery_recipients_user_id_idx on public.order_delivery_recipients (user_id);
