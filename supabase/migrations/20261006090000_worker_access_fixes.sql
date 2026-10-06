-- ════════════════════════════════════════════════════════════════════════════
-- Worker access fixes, part 1 — the security gaps found while planning the
-- PowerSync move (plan approved 2026-10-06). Admins and office: no change.
--
-- 1. PAYMENTS — a worker could add ANY payment.
--    `worker_insert_payment` let a worker insert any payment row (no order, any
--    amount, any account) straight through the API. Dropped. Delivery
--    confirmation with payment is unaffected: it saves through the
--    update_sales_order function, which doesn't go through these rules.
--    `payments_worker_insert_order` (payments on an open or just-delivered
--    order) stays.
--
-- 2. CUSTOMERS — a worker could change ANY field of ANY customer.
--    The rule was meant for the delivery location only. Now:
--    - which customers: those with an order a worker may deliver (open, or
--      just delivered) — the same test the order and payment rules use;
--    - which fields: delivery_instructions, delivery_lat, delivery_lng only,
--      enforced by a trigger (access rules can't limit columns). Anything else
--      is refused with "permission denied".
--
-- 3. WRONG USER ID — 7 worker rules compared an app-user column to the LOGIN id
--    (auth.uid()). users.id and the login id differ for 4 of the 6 workers, so
--    for them these rules never matched: uploading a delivery photo or a file,
--    adding a vehicle expense, seeing the projects of their own tasks. They now
--    use current_app_user_id() (the logged-in person's users.id). The app now
--    writes users.id into documents.uploaded_by and expenses.recorded_by (same
--    commit), which is what those columns' foreign keys point at.
--
-- 4. TASK ATTACHMENTS — a worker could never attach a file to a task: the link
--    rule only allowed links to orders. Now also to a task the worker may open
--    (task_can_access).
--
-- 5. FINANCE TABLES workers don't need — recurring bills, card settlement
--    confirmations, outflow source settings were readable by every logged-in
--    user. Now admins and office only (their existing manage rules). No worker
--    screen reads them.
--
-- ROLLBACK: supabase/rollbacks/20261006090000_worker_access_fixes.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Payments ----------------------------------------------------------------
drop policy if exists worker_insert_payment on public.payments;

-- 2. Customers ---------------------------------------------------------------
create or replace function public.customer_is_worker_deliverable(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.orders o
    where o.customer_id = p_customer_id
      and public.order_is_worker_deliverable(o.id)
  );
$$;
revoke all on function public.customer_is_worker_deliverable(uuid) from public, anon;
grant execute on function public.customer_is_worker_deliverable(uuid) to authenticated, service_role;

alter policy customers_worker_update_delivery_location on public.customers
  using (((select public.current_user_role()) = 'worker'::user_role_enum) and public.customer_is_worker_deliverable(id))
  with check (((select public.current_user_role()) = 'worker'::user_role_enum) and public.customer_is_worker_deliverable(id));

create or replace function public.customers_worker_fields_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  allowed constant text[] := array['delivery_instructions', 'delivery_lat', 'delivery_lng', 'updated_at'];
begin
  if (select public.current_user_role()) = 'worker'::user_role_enum
     and (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'A worker can only change a customer''s delivery location'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_worker_fields_guard on public.customers;
create trigger customers_worker_fields_guard
  before update on public.customers
  for each row execute function public.customers_worker_fields_guard();

-- 3. Wrong user id -----------------------------------------------------------
alter policy documents_worker_insert on public.documents
  with check (((select public.current_user_role()) = 'worker'::user_role_enum)
              and uploaded_by = (select public.current_app_user_id()));

alter policy worker_insert_expenses on public.expenses
  with check (recorded_by = (select public.current_app_user_id()));

alter policy expenses_worker_select_own on public.expenses
  using (recorded_by = (select public.current_app_user_id()));

alter policy worker_update_own_expenses on public.expenses
  using (recorded_by = (select public.current_app_user_id()));

alter policy worker_insert_project_expenses on public.project_expenses
  with check (exists (
    select 1 from public.tasks t
    where t.project_id = project_expenses.project_id
      and t.assigned_user_id = (select public.current_app_user_id())
  ));

alter policy worker_view_assigned_projects on public.projects
  using (exists (
    select 1 from public.tasks t
    where t.project_id = projects.id
      and t.assigned_user_id = (select public.current_app_user_id())
  ));

alter policy worker_view_assigned_tasks on public.tasks
  using (assigned_user_id = (select public.current_app_user_id()));

-- 4. Task attachments --------------------------------------------------------
alter policy document_links_worker_insert on public.document_links
  with check (((select public.current_user_role()) = 'worker'::user_role_enum)
              and (entity_type = 'order'
                   or (entity_type = 'task' and public.task_can_access(entity_id))));

-- 5. Finance tables ----------------------------------------------------------
drop policy if exists "System users can read recurring expense templates" on public.recurring_expense_templates;
drop policy if exists "System users can read card settlement confirmations" on public.card_settlement_confirmations;
drop policy if exists "System users can read outflow source settings" on public.outflow_source_settings;
