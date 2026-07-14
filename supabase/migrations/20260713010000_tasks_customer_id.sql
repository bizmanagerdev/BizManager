-- Let a task/follow-up attach directly to a customer (e.g. a prospect with no
-- order/project yet). This is an INDEPENDENT link — orthogonal to the existing
-- project_id/property_id "target" and its business_domain checks. A task may have
-- both a project and a customer, so customer_id is NOT part of the one-target rule.
-- Idempotent.

alter table public.tasks
  add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_customer_id_fkey'
  ) then
    alter table public.tasks
      add constraint tasks_customer_id_fkey
      foreign key (customer_id) references public.customers(id) on delete set null;
  end if;
end $$;

create index if not exists idx_tasks_customer_id on public.tasks(customer_id);
