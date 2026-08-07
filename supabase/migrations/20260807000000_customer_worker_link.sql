-- ════════════════════════════════════════════════════════════════════════════
-- עובד שהוא גם לקוח — linking a customer row to the worker (users row) that
-- is the SAME PERSON.
--
-- WHY A LINK AND NOT A MERGE: every customer-side FK points at customers.id
-- (orders, projects, loans.counterparty_customer_id, properties, reminders,
-- communication_logs, morning_documents) and every worker-side FK points at
-- users.id (attendance_sessions, salary_agreements, payslips, worker_payments).
-- A worker who buys from us therefore MUST have his own customers row — there
-- is no way to hang an order off a users row. That is also the right accounting:
-- what he owes us (receivable) and what we owe him (payroll liability) are two
-- different buckets and must not be silently netted into one number.
--
-- What this column adds is only IDENTITY: "these two rows are one human". It
-- powers the עובד badge, the cross-links between /customers/:id and
-- /payroll/workers/:id, the combined מאזן מול העסק card, and the duplicate
-- warning when someone types a worker's phone into the new-customer form.
--
-- Nothing existing changes: the column is nullable, no FK is repointed, and
-- every current row keeps linked_user_id = null.
--
-- Idempotent / safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.customers
  add column if not exists linked_user_id uuid null references public.users(id) on delete set null;

comment on column public.customers.linked_user_id is
  'The users row that is the SAME PERSON as this customer (a worker who also buys from us). Identity only — money stays on separate sides: receivables on the customer, payroll on the user.';

-- One customer row per worker. Without this, two people could each create "the
-- customer for עובד X" and the combined balance would silently show half the
-- picture. Partial so the (overwhelming) majority of customers with a null link
-- are unconstrained.
create unique index if not exists customers_linked_user_id_key
  on public.customers (linked_user_id)
  where linked_user_id is not null;
