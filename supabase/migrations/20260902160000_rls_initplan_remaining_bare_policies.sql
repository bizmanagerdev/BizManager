-- ════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE ONLY. Zero change to who can read or write what.
--
-- Full-catalog audit (2026-09-02, after 3 confirmed incidents on shared
-- identity helper functions: current_user_role/is_admin, current_app_user_id,
-- task_current_user_id/task_is_office_admin) turned up ~35 more tables whose
-- OWN policies embed a bare, unwrapped auth.uid()/auth.jwt() call directly in
-- an EXISTS(...) subquery or plain comparison — not routed through any of the
-- three already-fixed helpers, so those fixes never reached them.
--
-- Same mechanism as the prior three: Postgres re-parses request.jwt.claims on
-- every candidate row a policy is checked against unless the call is wrapped
-- in a scalar subquery, which Postgres can then cache once per statement
-- (InitPlan). Confirmed empirically in this app across all three prior fixes,
-- including cases where the wrapped call sat inside a subquery to a different
-- table (not just a top-level comparison) — the same shape as most of these.
--
-- Includes `reminders`' own three policies (Assignee reads/updates own
-- reminders, Office manages reminders) — likely explains why nav-counts/
-- page-alerts were still seen swinging back up to 2.6-4s after the
-- task_current_user_id()/task_is_office_admin() fix: those helpers got
-- faster, but reminders' own RLS re-parses auth.uid() per row independently
-- of them.
--
-- ALTER POLICY only rewrites the clauses given — semantics unchanged, same
-- roles/rows qualify, only evaluated once per statement instead of once per
-- row. Idempotent (safe to re-run).
-- ════════════════════════════════════════════════════════════════════════════

-- recurring_expense_templates
alter policy "Admins and office can manage recurring expense templates" on public.recurring_expense_templates
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])));

alter policy "System users can read recurring expense templates" on public.recurring_expense_templates
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true));

-- recurring_task_template_assignees
alter policy "Admins and office can manage recurring task assignees" on public.recurring_task_template_assignees
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])));

alter policy "System users can read recurring task assignees" on public.recurring_task_template_assignees
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true));

-- recurring_task_templates
alter policy "Admins and office can manage recurring task templates" on public.recurring_task_templates
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])));

alter policy "System users can read recurring task templates" on public.recurring_task_templates
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true));

-- worker_payment_allocations / worker_payments
alter policy "Admins can manage worker payment allocations" on public.worker_payment_allocations
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = 'admin'::user_role_enum and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = 'admin'::user_role_enum and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Admins can manage worker payments" on public.worker_payments
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = 'admin'::user_role_enum and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = 'admin'::user_role_enum and u.active = true and coalesce(u.system_access, false) = true));

-- reminders (see header note — likely culprit for continued nav-counts/page-alerts variance)
alter policy "Assignee reads own reminders" on public.reminders
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.id = reminders.assigned_to and u.active = true));

alter policy "Assignee updates own reminders" on public.reminders
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.id = reminders.assigned_to and u.active = true));

alter policy "Office manages reminders" on public.reminders
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

-- communication_logs
alter policy "Office manages communication logs" on public.communication_logs
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

-- card_statement_rows / card_statements / card_account_mappings / card_statement_charges
alter policy "Staff manage card statement rows" on public.card_statement_rows
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Staff manage card statements" on public.card_statements
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Staff manage card account mappings" on public.card_account_mappings
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Staff manage card statement charges" on public.card_statement_charges
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

-- expense_merchant_mappings
alter policy "Staff manage merchant mappings" on public.expense_merchant_mappings
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

-- loans / loan_repayments
alter policy "Staff manage loans" on public.loans
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Staff manage loan repayments" on public.loan_repayments
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

-- tags (the OTHER policy on this table, "Read tags", is already wrapped)
alter policy "Staff manage tags" on public.tags
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

-- vehicles / accounts / payment_promises / phone_attendance_reports / account_transfers / worker_absences
alter policy "Staff manage vehicles" on public.vehicles
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Staff manage accounts" on public.accounts
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Staff manage payment promises" on public.payment_promises
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Staff manage phone attendance reports" on public.phone_attendance_reports
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Staff manage account transfers" on public.account_transfers
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "worker_absences_staff_manage" on public.worker_absences
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

-- order_delivery_recipients
alter policy "Office manages order_delivery_recipients" on public.order_delivery_recipients
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum]) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Recipient reads own delivery assignment" on public.order_delivery_recipients
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.id = order_delivery_recipients.user_id and u.active = true));

-- morning_settings / morning_documents
alter policy "System users can read morning settings" on public.morning_settings
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Admins can manage morning settings" on public.morning_settings
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = 'admin'::user_role_enum))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = 'admin'::user_role_enum));

alter policy "Admins can delete morning documents" on public.morning_documents
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = 'admin'::user_role_enum));

alter policy "System users can read morning documents" on public.morning_documents
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true));

alter policy "Admins and office can insert morning documents" on public.morning_documents
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])));

alter policy "Admins and office can update morning documents" on public.morning_documents
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.active = true and coalesce(u.system_access, false) = true and u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])));

-- notifications
alter policy "own notifications read" on public.notifications
  using (user_id = (select auth.uid()));

alter policy "own notifications update" on public.notifications
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- dunning_stages
alter policy "Admin manage dunning stages" on public.dunning_stages
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = 'admin'::user_role_enum and u.active = true))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = 'admin'::user_role_enum and u.active = true));

-- fcm_tokens / push_subscriptions
alter policy "Users manage own fcm tokens" on public.fcm_tokens
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "Users manage own subscriptions" on public.push_subscriptions
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- users (two SELECT policies with identical logic exist here — "users_can_view_self"
-- and "users_view_self_by_auth_id" — left both in place, just wrapped; the
-- apparent duplication is a separate, non-urgent cleanup, not touched here)
alter policy "users_view_self_by_auth_id" on public.users
  using (auth_user_id = (select auth.uid()));

alter policy "users_can_view_self" on public.users
  using (auth_user_id = (select auth.uid()));

alter policy "policy users_can_insert_self" on public.users
  with check (id = (select auth.uid()) and email = ((select auth.jwt()) ->> 'email'::text));

-- idempotency_keys
alter policy "idempotency_keys_select_own" on public.idempotency_keys
  using ((select auth.uid()) = user_id);

alter policy "idempotency_keys_insert_own" on public.idempotency_keys
  with check ((select auth.uid()) = user_id);

alter policy "idempotency_keys_update_own" on public.idempotency_keys
  using ((select auth.uid()) = user_id);

alter policy "idempotency_keys_delete_own" on public.idempotency_keys
  using ((select auth.uid()) = user_id);

-- audit_logs / business_settings / documents (write-path, single-row-at-a-time —
-- included for completeness/consistency, not because they were suspected hot spots)
alter policy "audit_self_login_events" on public.audit_logs
  with check (table_name = 'auth'::text and action = any (array['login'::text, 'logout'::text]) and changed_by = (select u.id from users u where u.auth_user_id = (select auth.uid())));

alter policy "business_settings_write" on public.business_settings
  using (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = 'admin'::user_role_enum))
  with check (exists (select 1 from users u where u.auth_user_id = (select auth.uid()) and u.role = 'admin'::user_role_enum));

alter policy "documents_worker_insert" on public.documents
  with check (current_user_role() = 'worker'::user_role_enum and uploaded_by = (select auth.uid()));

-- expenses / project_expenses / tasks
alter policy "worker_insert_expenses" on public.expenses
  with check (recorded_by = (select auth.uid()));

alter policy "worker_insert_project_expenses" on public.project_expenses
  with check (exists (select 1 from tasks t where t.project_id = project_expenses.project_id and t.assigned_user_id = (select auth.uid())));

alter policy "worker_update_own_tasks" on public.tasks
  using (assigned_user_id = (select auth.uid()));

alter policy "worker_view_assigned_tasks" on public.tasks
  using (assigned_user_id = (select auth.uid()));
