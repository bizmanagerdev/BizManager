-- The dashboard/financial engine (lib/financial/db.ts scanRows) pages every one
-- of these tables with `.gte(dateColumn, since).order(dateColumn desc).order(id desc)`.
-- Only orders.order_date was indexed (performance_hot_indexes.sql) — every other
-- table it scans (payments, expenses, attendance_sessions, projects, loans,
-- loan_repayments) was doing a full sequential scan + sort on every single
-- dashboard load, financial page load, and report. Indexes here match the
-- exact (date desc, id desc) order-by so Postgres can walk the index directly
-- instead of sorting the whole table each time.
create index if not exists idx_payments_payment_date_id
  on public.payments (payment_date desc, id desc);

create index if not exists idx_expenses_expense_date_id
  on public.expenses (expense_date desc, id desc);

create index if not exists idx_attendance_sessions_clock_in_id
  on public.attendance_sessions (clock_in desc, id desc);

create index if not exists idx_projects_created_at_id
  on public.projects (created_at desc, id desc);

create index if not exists idx_loans_loan_date
  on public.loans (loan_date desc);

create index if not exists idx_loan_repayments_repayment_date
  on public.loan_repayments (repayment_date asc);
