import { createClient } from "@supabase/supabase-js";

// Direct DB setup/teardown for tests that need a real record to navigate to
// (detail pages are keyed off an id — there's no way to open one without
// one existing). Uses the service-role key from .env.test.local (see
// e2e/README.md) to bypass RLS entirely; this only ever runs against the
// local Supabase stack, never the real database.

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — copy .env.test.example to " +
        ".env.test.local and fill in the local `supabase start` output (see e2e/README.md)."
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type TestCustomer = { id: string; name: string };
export type TestProject = { id: string; name: string };

export async function createTestCustomer(overrides: { name?: string; phone?: string } = {}): Promise<TestCustomer> {
  const { data, error } = await adminClient()
    .from("customers")
    .insert({
      name: overrides.name ?? `לקוח בדיקה ${Date.now()}`,
      phone: overrides.phone ?? "0500000000",
      city: "תל אביב",
    })
    .select("id,name")
    .single();
  if (error) throw error;
  return data as TestCustomer;
}

export async function deleteTestCustomer(id: string): Promise<void> {
  const { error } = await adminClient().from("customers").delete().eq("id", id);
  if (error) throw error;
}

export async function getAdminUserId(): Promise<string> {
  const { data, error } = await adminClient()
    .from("users")
    .select("id")
    .eq("email", "e2e-admin@bizh.test")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function createTestProject(
  customerId: string,
  overrides: { name?: string } = {}
): Promise<TestProject> {
  const { data, error } = await adminClient()
    .from("projects")
    .insert({
      customer_id: customerId,
      name: overrides.name ?? `פרויקט בדיקה ${Date.now()}`,
      project_type: "other",
      status: "active",
    })
    .select("id,name")
    .single();
  if (error) throw error;
  return data as TestProject;
}

export async function deleteTestProject(id: string): Promise<void> {
  const { error } = await adminClient().from("projects").delete().eq("id", id);
  if (error) throw error;
}

export async function getProjectStatus(id: string): Promise<string> {
  const { data, error } = await adminClient().from("projects").select("status").eq("id", id).single();
  if (error) throw error;
  return (data as { status: string }).status;
}

export type TestOrder = { id: string };

export async function createTestOrder(customerId: string): Promise<TestOrder> {
  const createdBy = await getAdminUserId();
  const { data, error } = await adminClient()
    .from("orders")
    .insert({
      customer_id: customerId,
      status: "draft",
      payment_status: "unpaid",
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as TestOrder;
}

export async function deleteTestOrder(id: string): Promise<void> {
  const supabase = adminClient();
  // payments.order_id is ON DELETE SET NULL, but payments_sales_requires_order_chk
  // forbids a NULL order_id on a 'sales'-domain row — deleting an order straight
  // through FK cascade violates that CHECK on any payment still attached. The real
  // app's own /api/orders/delete route deletes payments first for the same reason
  // (app/api/orders/delete/route.ts); this helper needs to match that ordering.
  const { error: paymentsError } = await supabase.from("payments").delete().eq("order_id", id);
  if (paymentsError) throw paymentsError;
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) throw error;
}

// Off-catalog line (description, no product_id) — order_items.product_id is
// nullable specifically to support this (20260724020000_order_items_custom_
// lines.sql), so it needs no product/category fixture chain at all.
export async function createTestOrderItem(
  orderId: string,
  overrides: { quantityOrdered?: number; unitPrice?: number; description?: string } = {}
): Promise<{ id: string }> {
  const { data, error } = await adminClient()
    .from("order_items")
    .insert({
      order_id: orderId,
      product_id: null,
      description: overrides.description ?? "פריט בדיקה",
      quantity_ordered: overrides.quantityOrdered ?? 1,
      quantity_delivered: 0,
      unit_price: overrides.unitPrice ?? 100,
      discount_amount: 0,
      line_total: (overrides.quantityOrdered ?? 1) * (overrides.unitPrice ?? 100),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function getOrderStatus(
  id: string
): Promise<{ status: string; payment_status: string; total_amount: number }> {
  const { data, error } = await adminClient()
    .from("orders")
    .select("status,payment_status,total_amount")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as { status: string; payment_status: string; total_amount: number };
}

export type TestProperty = { id: string; address: string };

export async function createTestProperty(overrides: { address?: string } = {}): Promise<TestProperty> {
  const { data, error } = await adminClient()
    .from("properties")
    .insert({ address: overrides.address ?? `נכס בדיקה ${Date.now()}` })
    .select("id,address")
    .single();
  if (error) throw error;
  return data as TestProperty;
}

export async function deleteTestProperty(id: string): Promise<void> {
  const { error } = await adminClient().from("properties").delete().eq("id", id);
  if (error) throw error;
}

export async function getPropertyIdByName(name: string): Promise<string | null> {
  const { data, error } = await adminClient().from("properties").select("id").eq("name", name).maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

export async function getLeaseAgreementByProperty(
  propertyId: string
): Promise<{ id: string; customer_id: string; monthly_rent_amount: number } | null> {
  const { data, error } = await adminClient()
    .from("lease_agreements")
    .select("id,customer_id,monthly_rent_amount")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; customer_id: string; monthly_rent_amount: number } | null;
}

// Both property_id and customer_id are ON DELETE RESTRICT — must be deleted
// before either parent (deleteTestProperty/deleteTestCustomer).
export async function deleteTestLeaseAgreement(id: string): Promise<void> {
  const { error } = await adminClient().from("lease_agreements").delete().eq("id", id);
  if (error) throw error;
}

export type TestVehicle = { id: string; tagId: string };

// Vehicle detail pages are keyed by their TAG id, not the vehicles.id row
// itself (see VehiclesClient.tsx's `/vehicles/${v.tagId}` link) — vehicles
// is a cross-cutting overlay on the shared tags table, not standalone.
export async function createTestVehicle(overrides: { name?: string } = {}): Promise<TestVehicle> {
  const supabase = adminClient();
  const { data: tag, error: tagError } = await supabase
    .from("tags")
    .insert({ kind: "vehicle", name: overrides.name ?? `רכב בדיקה ${Date.now()}` })
    .select("id")
    .single();
  if (tagError) throw tagError;
  const tagId = (tag as { id: string }).id;

  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .insert({ tag_id: tagId })
    .select("id")
    .single();
  if (vehicleError) throw vehicleError;
  return { id: (vehicle as { id: string }).id, tagId };
}

export async function deleteTestVehicle(vehicle: TestVehicle): Promise<void> {
  const supabase = adminClient();
  const { error: vehicleError } = await supabase.from("vehicles").delete().eq("id", vehicle.id);
  if (vehicleError) throw vehicleError;
  const { error: tagError } = await supabase.from("tags").delete().eq("id", vehicle.tagId);
  if (tagError) throw tagError;
}

// For a vehicle created through the UI (no id available from the dialog's
// own response) — createVehicle names the tag from the form (deriveName),
// so the tag row is findable by that name once the write lands.
export async function getVehicleByTagName(name: string): Promise<TestVehicle | null> {
  const { data: tag, error: tagError } = await adminClient().from("tags").select("id").eq("name", name).maybeSingle();
  if (tagError) throw tagError;
  if (!tag) return null;
  const tagId = (tag as { id: string }).id;
  const { data: vehicle, error: vehicleError } = await adminClient()
    .from("vehicles")
    .select("id")
    .eq("tag_id", tagId)
    .maybeSingle();
  if (vehicleError) throw vehicleError;
  if (!vehicle) return null;
  return { id: (vehicle as { id: string }).id, tagId };
}

// For tests that create a task through the board's UI (no id available from
// the response) rather than via a direct insert — cleans up by exact title.
export async function deleteTestTaskByTitle(subject: string): Promise<void> {
  const { error } = await adminClient().from("tasks").delete().eq("subject", subject);
  if (error) throw error;
}

export type TestTask = { id: string; subject: string };

export async function createTestTask(
  overrides: {
    subject?: string;
    assignedUserId?: string;
    status?: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
    isPrivate?: boolean;
    privateOwnerId?: string;
  } = {}
): Promise<TestTask> {
  const { data, error } = await adminClient()
    .from("tasks")
    .insert({
      subject: overrides.subject ?? `משימת בדיקה ${Date.now()}`,
      status: overrides.status ?? "todo",
      assigned_user_id: overrides.assignedUserId ?? null,
      is_private: overrides.isPrivate ?? false,
      private_owner_id: overrides.privateOwnerId ?? null,
    })
    .select("id,subject")
    .single();
  if (error) throw error;
  return data as TestTask;
}

export async function deleteTestTask(id: string): Promise<void> {
  const { error } = await adminClient().from("tasks").delete().eq("id", id);
  if (error) throw error;
}

export async function getTaskStatus(id: string): Promise<string> {
  const { data, error } = await adminClient().from("tasks").select("status").eq("id", id).single();
  if (error) throw error;
  return (data as { status: string }).status;
}

export async function getReminderAssignee(id: string): Promise<string | null> {
  const { data, error } = await adminClient().from("reminders").select("assigned_to").eq("id", id).single();
  if (error) throw error;
  return (data as { assigned_to: string | null }).assigned_to;
}

export async function getReminderStatus(id: string): Promise<string> {
  const { data, error } = await adminClient().from("reminders").select("status").eq("id", id).single();
  if (error) throw error;
  return (data as { status: string }).status;
}

export async function getReminderSnoozedUntil(id: string): Promise<string | null> {
  const { data, error } = await adminClient().from("reminders").select("snoozed_until").eq("id", id).single();
  if (error) throw error;
  return (data as { snoozed_until: string | null }).snoozed_until;
}

export async function deleteTestReminder(id: string): Promise<void> {
  const { error } = await adminClient().from("reminders").delete().eq("id", id);
  if (error) throw error;
}

export type TestReminder = { id: string; remind_at: string };

export async function createTestReminder(
  overrides: {
    remindAt?: string;
    content?: string;
    customerId?: string | null;
    taskId?: string | null;
    assignedTo?: string | null;
    category?: string;
    actionType?: string;
    status?: "pending" | "done" | "cancelled";
    createdBy?: string | null;
  } = {}
): Promise<TestReminder> {
  const { data, error } = await adminClient()
    .from("reminders")
    .insert({
      remind_at: overrides.remindAt ?? new Date(Date.now() + 86_400_000).toISOString(),
      content: overrides.content ?? `תזכורת בדיקה ${Date.now()}`,
      customer_id: overrides.customerId ?? null,
      task_id: overrides.taskId ?? null,
      assigned_to: overrides.assignedTo ?? null,
      category: overrides.category ?? "general",
      action_type: overrides.actionType ?? "other",
      status: overrides.status ?? "pending",
      created_by: overrides.createdBy ?? null,
    })
    .select("id,remind_at")
    .single();
  if (error) throw error;
  return data as TestReminder;
}

export async function getLatestAttendanceReportStatus(userId: string): Promise<string | null> {
  const { data, error } = await adminClient()
    .from("phone_attendance_reports")
    .select("status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { status: string } | null)?.status ?? null;
}

export async function deleteTestAttendanceReports(userId: string): Promise<void> {
  const { error } = await adminClient().from("phone_attendance_reports").delete().eq("user_id", userId);
  if (error) throw error;
}

// Seeds a pending_review report directly, skipping the worker's own clock-
// in/out UI (already covered by worker-attendance.spec.ts) — this is for
// exercising the admin/office APPROVAL side on its own.
export async function createTestAttendanceReport(
  userId: string,
  overrides: { clockIn?: Date; clockOut?: Date; notes?: string } = {}
): Promise<{ id: string }> {
  const clockIn = overrides.clockIn ?? new Date(Date.now() - 60 * 60_000);
  const clockOut = overrides.clockOut ?? new Date();
  const workedMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000);
  const { data, error } = await adminClient()
    .from("phone_attendance_reports")
    .insert({
      user_id: userId,
      clock_in: clockIn.toISOString(),
      clock_out: clockOut.toISOString(),
      worked_minutes: workedMinutes,
      status: "pending_review",
      source: "phone",
      notes: overrides.notes ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function getAttendanceReportStatus(reportId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("phone_attendance_reports")
    .select("status")
    .eq("id", reportId)
    .single();
  if (error) throw error;
  return (data as { status: string }).status;
}

export async function getAttendanceSessionForReport(reportId: string): Promise<{ id: string } | null> {
  const { data: report, error: reportError } = await adminClient()
    .from("phone_attendance_reports")
    .select("attendance_session_id")
    .eq("id", reportId)
    .single();
  if (reportError) throw reportError;
  const sessionId = (report as { attendance_session_id: string | null }).attendance_session_id;
  return sessionId ? { id: sessionId } : null;
}

export async function deleteTestAttendanceSession(id: string): Promise<void> {
  const { error } = await adminClient().from("attendance_sessions").delete().eq("id", id);
  if (error) throw error;
}

// A real, already-closed session with a labor_cost — worker_debt_items_view's
// session_items CTE picks up any attendance_sessions row for a
// pay_tracking_mode='session' worker (createTestWorker's own DB default,
// unset by createTestWorker unless payrollWorkerType overrides it) with
// labor_cost > 0, with no approval/status gate of its own (unlike
// phone_attendance_reports, which is only a staging table for the phone
// clock-in flow) — so this is the direct, minimal way to seed a worker debt
// payoff scenario without going through attendance UI or payroll periods at
// all. getPayableDebtAmount() has no date gate for session-type items either
// (only payslips do), so it's payable the moment it exists.
export async function createTestAttendanceSession(
  userId: string,
  overrides: { laborCost?: number; clockIn?: Date; clockOut?: Date } = {}
): Promise<{ id: string }> {
  const clockIn = overrides.clockIn ?? new Date(Date.now() - 4 * 60 * 60_000);
  const clockOut = overrides.clockOut ?? new Date(Date.now() - 60 * 60_000);
  const workedMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000);
  const { data, error } = await adminClient()
    .from("attendance_sessions")
    .insert({
      user_id: userId,
      clock_in: clockIn.toISOString(),
      clock_out: clockOut.toISOString(),
      worked_minutes: workedMinutes,
      labor_cost: overrides.laborCost ?? 180,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

// Mirrors exactly what worker_debt_items_view (and so the payment dialog's
// "יתרה להקצאה" figure) reports for one session — the real source of truth
// for "did the payoff actually clear the debt", not just "did a payment row
// get inserted somewhere."
export async function getSessionDebtStatus(
  sessionId: string
): Promise<{ payment_status: string; owed_amount: number; paid_amount: number } | null> {
  const { data, error } = await adminClient()
    .from("worker_debt_items_view")
    .select("payment_status,owed_amount,paid_amount")
    .eq("source_type", "session")
    .eq("source_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data as { payment_status: string; owed_amount: number; paid_amount: number } | null;
}

// worker_payment_allocations.worker_payment_id cascades, but
// .attendance_session_id has no ON DELETE action (RESTRICT) — delete the
// payment (and so its allocations) before deleting the session it was
// allocated against, same ordering deleteTestWorker's own caller must use.
export async function deleteTestWorkerPayment(paymentId: string): Promise<void> {
  const { error } = await adminClient().from("worker_payments").delete().eq("id", paymentId);
  if (error) throw error;
}

// By relationship, not a specific captured id: worker_payments_user_id_fkey
// has no ON DELETE action either, and a test's own local paymentId variable
// is only as reliable as everything that ran before it was read — a save
// that genuinely succeeded server-side but whose response body a later step
// failed to parse/assert on leaves a REAL row behind with the test never
// having learned its id. Cleaning up by user_id catches that regardless.
export async function deleteTestWorkerPaymentsForUser(userId: string): Promise<void> {
  const { error } = await adminClient().from("worker_payments").delete().eq("user_id", userId);
  if (error) throw error;
}

export type WorkerSectionAccess = Partial<{
  dashboard: boolean;
  deliveries: boolean;
  tasks: boolean;
  calendar: boolean;
  vehicles: boolean;
}>;

export type TestWorker = {
  id: string;
  authUserId: string;
  email: string;
  password: string;
  fullName: string;
};

// A REAL, separately-provisioned worker (own auth account, own login) —
// deliberately given a FRESH public.users.id distinct from its auth_user_id,
// matching the shape a real admin-provisioned worker gets via
// admin_upsert_user_profile. This is unlike the shared e2e-worker@bizh.test
// seed fixture, where id === auth_user_id (see login.spec.ts's user) — that
// shortcut hides the exact class of RLS identity bug this helper exists to
// exercise (see 20260910130000_fix_worker_update_own_tasks_identity.sql).
//
// Each test gets its OWN worker (not the shared seed) so parallel specs
// (playwright.config.ts has fullyParallel: true) never race on section_access
// or role by mutating shared state.
export async function createTestWorker(
  overrides: {
    fullName?: string;
    role?: "worker" | "worker_no_access";
    sectionAccess?: WorkerSectionAccess;
    payrollWorkerType?: "session_only" | "hourly_payslip" | "monthly_payslip";
    locale?: "he" | "ar";
  } = {}
): Promise<TestWorker> {
  const supabase = adminClient();
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-worker-${unique}@bizh.test`;
  const password = "e2e-test-password-123";
  const fullName = overrides.fullName ?? `עובד בדיקה ${unique}`;

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError) throw authError;
  const authUserId = authUser.user.id;

  const { data: row, error: rowError } = await supabase
    .from("users")
    .insert({
      auth_user_id: authUserId,
      full_name: fullName,
      email,
      role: overrides.role ?? "worker",
      active: true,
      system_access: true,
      section_access: overrides.sectionAccess ?? null,
      payroll_worker_type: overrides.payrollWorkerType ?? "monthly_payslip",
      locale: overrides.locale ?? "he",
    })
    .select("id")
    .single();
  if (rowError) throw rowError;

  return { id: (row as { id: string }).id, authUserId, email, password, fullName };
}

export async function deleteTestWorker(worker: TestWorker): Promise<void> {
  const supabase = adminClient();
  const { error: rowError } = await supabase.from("users").delete().eq("id", worker.id);
  if (rowError) throw rowError;
  const { error: authError } = await supabase.auth.admin.deleteUser(worker.authUserId);
  if (authError) throw authError;
}

// Links an entity (expense/document/payment/task) to a vehicle's tag row —
// the mechanism section_access.vehicles-gated RLS policies key off (see
// 20260907100558_worker_vehicle_expenses_documents_rls.sql and siblings).
export async function tagEntityAsVehicle(
  entityType: "expense" | "document" | "payment" | "task",
  entityId: string,
  vehicleTagId: string
): Promise<void> {
  const { error } = await adminClient()
    .from("entity_tags")
    .insert({ entity_type: entityType, entity_id: entityId, tag_id: vehicleTagId });
  if (error) throw error;
}

// Same entity_tags backbone tagEntityAsVehicle uses, entity_type="customer"
// (TagPicker's own createTagDirect() creates the tags row client-side; this
// is only for reading back / cleaning up what the UI wrote).
export async function getCustomerTagNames(customerId: string): Promise<string[]> {
  const { data, error } = await adminClient()
    .from("entity_tags")
    .select("tags(name)")
    .eq("entity_type", "customer")
    .eq("entity_id", customerId);
  if (error) throw error;
  return ((data ?? []) as unknown as { tags: { name: string } | null }[])
    .map((r) => r.tags?.name)
    .filter((name): name is string => Boolean(name));
}

// tags.id is entity_tags.tag_id's ON DELETE CASCADE target — deleting the
// tag alone cleans up any entity_tags row pointing at it too.
export async function deleteTestTagByName(name: string): Promise<void> {
  const { error } = await adminClient().from("tags").delete().eq("name", name);
  if (error) throw error;
}

// Direct-insert counterpart to TagPicker's own createTagDirect() — for tests
// that need an existing tag+link in place before the page ever loads,
// rather than driving the picker's create UI (already covered by
// admin-customer-tags.spec.ts).
export async function createTestTag(name: string, kind: string = "general"): Promise<{ id: string; name: string }> {
  const { data, error } = await adminClient().from("tags").insert({ name, kind }).select("id,name").single();
  if (error) throw error;
  return data as { id: string; name: string };
}

export async function linkCustomerTag(customerId: string, tagId: string): Promise<void> {
  const { error } = await adminClient()
    .from("entity_tags")
    .insert({ entity_type: "customer", entity_id: customerId, tag_id: tagId });
  if (error) throw error;
}

export type TestExpense = { id: string };

export async function createTestExpense(
  overrides: { amount?: number; description?: string; paymentStatus?: "paid" | "not_paid" | "partial" } = {}
): Promise<TestExpense> {
  const recordedBy = await getAdminUserId();
  const { data, error } = await adminClient()
    .from("expenses")
    .insert({
      amount: overrides.amount ?? 100,
      category: "אחר",
      description: overrides.description ?? `הוצאת בדיקה ${Date.now()}`,
      recorded_by: recordedBy,
      payment_status: overrides.paymentStatus ?? "paid",
      business_domain: "general_business",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as TestExpense;
}

export async function deleteTestExpense(id: string): Promise<void> {
  const supabase = adminClient();
  // project_expenses.expense_id is ON DELETE RESTRICT — deleting an expense
  // still linked from a project blocks outright. The real app's own
  // /api/expenses/delete route deletes the link row first for the same
  // reason (app/api/expenses/delete/route.ts); this helper needs to match.
  const { error: linkError } = await supabase.from("project_expenses").delete().eq("expense_id", id);
  if (linkError) throw linkError;
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw error;
}

// A card statement + one draft row, seeded directly rather than through the
// XLSX/PDF upload+parse wizard (unit-tested thoroughly already in
// __tests__/lib/financial/cardImport.test.ts) — this is for exercising the
// statement DETAIL page's own review/confirm step
// (POST /api/expenses/statement-rows/create-expenses), which nothing else
// covers. include defaults to true at the DB level (baseline.sql), and a
// business_domain set here already satisfies eligibleRows' filter
// (StatementDetailClient.tsx: !expenseExists && !expenseId && include &&
// isExpenseBusinessDomain(businessDomain) && amount > 0) — a fresh row is
// eligible for "צור הוצאות" with no further UI interaction needed.
export async function createTestCardStatement(
  overrides: { fileName?: string } = {}
): Promise<{ id: string }> {
  const { data, error } = await adminClient()
    .from("card_statements")
    .insert({ file_name: overrides.fileName ?? `e2e-statement-${Date.now()}.csv`, source: "excel", total_rows: 1 })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function createTestCardStatementRow(
  statementId: string,
  overrides: { amount?: number; description?: string; businessDomain?: string; expenseDate?: string } = {}
): Promise<{ id: string }> {
  const { data, error } = await adminClient()
    .from("card_statement_rows")
    .insert({
      statement_id: statementId,
      expense_date: overrides.expenseDate ?? new Date().toISOString().slice(0, 10),
      amount: overrides.amount ?? 220,
      description: overrides.description ?? `E2E merchant ${Date.now()}`,
      category: "כרטיס אשראי",
      business_domain: overrides.businessDomain ?? "general_business",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

export async function getCardStatementRowExpenseId(rowId: string): Promise<string | null> {
  const { data, error } = await adminClient()
    .from("card_statement_rows")
    .select("expense_id")
    .eq("id", rowId)
    .single();
  if (error) throw error;
  return (data as { expense_id: string | null }).expense_id;
}

// card_statement_rows.statement_id is ON DELETE CASCADE — deleting the
// statement alone is enough, but the CREATED expense isn't touched by that
// (expense_id is ON DELETE SET NULL, the other direction) and needs its own
// cleanup first, same as any other test-created expense.
export async function deleteTestCardStatement(id: string): Promise<void> {
  const { error } = await adminClient().from("card_statements").delete().eq("id", id);
  if (error) throw error;
}

export async function getExpensePaymentStatus(id: string): Promise<string | null> {
  const { data, error } = await adminClient().from("expenses").select("payment_status").eq("id", id).single();
  if (error) throw error;
  return (data as { payment_status: string | null }).payment_status;
}

export async function getRecurringExpenseTemplate(
  id: string
): Promise<{ id: string; template_name: string; frequency: string; is_active: boolean } | null> {
  const { data, error } = await adminClient()
    .from("recurring_expense_templates")
    .select("id,template_name,frequency,is_active")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; template_name: string; frequency: string; is_active: boolean } | null;
}

export async function createTestRecurringExpenseTemplate(
  overrides: { templateName?: string; category?: string; amount?: number } = {}
): Promise<{ id: string; template_name: string }> {
  const { data, error } = await adminClient()
    .from("recurring_expense_templates")
    .insert({
      template_name: overrides.templateName ?? `E2E recurring seed ${Date.now()}`,
      category: overrides.category ?? "רכישה",
      amount: overrides.amount ?? 250,
      business_domain: "general_business",
      frequency: "monthly",
      is_active: true,
    })
    .select("id,template_name")
    .single();
  if (error) throw error;
  return data as { id: string; template_name: string };
}

// Saving a new template also generates its first occurrence(s) as real
// `expenses` rows (expenses.recurring_expense_template_id is ON DELETE SET
// NULL, so deleting the template alone wouldn't clean those up) — delete
// generated expenses first so no orphaned test expense is left behind.
export async function deleteTestRecurringExpenseTemplate(id: string): Promise<void> {
  const supabase = adminClient();
  const { data: generated, error: findError } = await supabase
    .from("expenses")
    .select("id")
    .eq("recurring_expense_template_id", id);
  if (findError) throw findError;
  for (const row of (generated ?? []) as { id: string }[]) {
    await deleteTestExpense(row.id);
  }
  const { error } = await supabase.from("recurring_expense_templates").delete().eq("id", id);
  if (error) throw error;
}

export type TestDocument = { id: string };

export async function createTestDocument(overrides: { title?: string } = {}): Promise<TestDocument> {
  const uploadedBy = await getAdminUserId();
  const { data, error } = await adminClient()
    .from("documents")
    .insert({
      document_type: "other",
      title: overrides.title ?? `מסמך בדיקה ${Date.now()}`,
      file_name: "test.pdf",
      uploaded_by: uploadedBy,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as TestDocument;
}

export async function deleteTestDocument(id: string): Promise<void> {
  const { error } = await adminClient().from("documents").delete().eq("id", id);
  if (error) throw error;
}

export async function linkTestDocumentToTask(documentId: string, taskId: string): Promise<void> {
  const { error } = await adminClient()
    .from("document_links")
    .insert({ document_id: documentId, entity_type: "task", entity_id: taskId });
  if (error) throw error;
}

export async function getVehicleMileage(tagId: string): Promise<number | null> {
  const { data, error } = await adminClient().from("vehicles").select("mileage").eq("tag_id", tagId).single();
  if (error) throw error;
  return (data as { mileage: number | null }).mileage;
}

// expenses.description has no uniqueness constraint, so tests give theirs a
// Date.now()-suffixed value and look it up afterward — used when a value was
// entered through the real ExpenseDialog UI rather than inserted directly, so
// there's no id to capture from a network response.
export async function getExpenseIdByDescription(description: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("expenses")
    .select("id")
    .eq("description", description)
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function getCustomerNotes(id: string): Promise<string | null> {
  const { data, error } = await adminClient().from("customers").select("notes").eq("id", id).single();
  if (error) throw error;
  return (data as { notes: string | null }).notes;
}

// customer_branches has ON DELETE CASCADE on customer_id — deleteTestCustomer
// alone cleans these up, no separate delete helper needed.
export async function getCustomerBranchByName(
  customerId: string,
  name: string
): Promise<{ id: string; address: string | null; active: boolean } | null> {
  const { data, error } = await adminClient()
    .from("customer_branches")
    .select("id,address,active")
    .eq("customer_id", customerId)
    .eq("name", name)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; address: string | null; active: boolean } | null;
}

export type TestPayment = { id: string };

// The payments table has 4 check constraints tying business_domain to
// which single target FK (order/project/property) may be set — see
// supabase/migrations/20250101000000_baseline.sql:1203-1209. Default here
// (general_business, no target) is the one combination that needs nothing
// else seeded first — /checks itself has no create UI at all (it's a
// derived view over payments WHERE payment_method='check', see lib/
// checks.ts), so this is the only way to seed one directly.
export async function createTestPayment(
  overrides: {
    amount?: number;
    paymentMethod?: string;
    paymentStatus?: "pending" | "cleared" | "rejected";
    dueDate?: string;
    checkNumber?: string;
    orderId?: string;
  } = {}
): Promise<TestPayment> {
  const recordedBy = await getAdminUserId();
  const amount = overrides.amount ?? 1000;
  const { data, error } = await adminClient()
    .from("payments")
    .insert({
      payment_method: overrides.paymentMethod ?? "check",
      amount_total: amount,
      net_amount: amount,
      // amount_including_vat has a column default of 0, not null - but
      // payments_split_consistency_chk requires it to be NULL whenever
      // requires_split is false (the default here). Must be set explicitly;
      // relying on the column default violates the constraint.
      amount_including_vat: null,
      amount_before_vat: null,
      payment_status: overrides.paymentStatus ?? "pending",
      business_domain: overrides.orderId ? "sales" : "general_business",
      order_id: overrides.orderId ?? null,
      due_date: overrides.dueDate ?? null,
      check_number: overrides.checkNumber ?? "12345",
      recorded_by: recordedBy,
      payment_date: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as TestPayment;
}

export async function getPaymentStatus(id: string): Promise<string> {
  const { data, error } = await adminClient().from("payments").select("payment_status").eq("id", id).single();
  if (error) throw error;
  return (data as { payment_status: string }).payment_status;
}

export async function deleteTestPayment(id: string): Promise<void> {
  const { error } = await adminClient().from("payments").delete().eq("id", id);
  if (error) throw error;
}

export type TestLoan = { id: string; lender: string; borrower: string };

export async function createTestLoan(
  overrides: {
    direction?: "taken" | "given";
    lender?: string;
    borrower?: string;
    amount?: number;
    loanDate?: string;
  } = {}
): Promise<TestLoan> {
  const { data, error } = await adminClient()
    .from("loans")
    .insert({
      direction: overrides.direction ?? "taken",
      lender: overrides.lender ?? `מלווה בדיקה ${Date.now()}`,
      borrower: overrides.borrower ?? `לווה בדיקה ${Date.now()}`,
      loan_date: overrides.loanDate ?? new Date().toISOString().slice(0, 10),
      amount: overrides.amount ?? 5000,
    })
    .select("id,lender,borrower")
    .single();
  if (error) throw error;
  return data as TestLoan;
}

export async function getLoanStatus(id: string): Promise<string> {
  const { data, error } = await adminClient().from("loans").select("status").eq("id", id).single();
  if (error) throw error;
  return (data as { status: string }).status;
}

export async function getLoanIdByLender(lender: string): Promise<string | null> {
  const { data, error } = await adminClient().from("loans").select("id").eq("lender", lender).maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

export async function deleteTestLoan(id: string): Promise<void> {
  const { error } = await adminClient().from("loans").delete().eq("id", id);
  if (error) throw error;
}

export async function getLoanRepaymentTotal(loanId: string): Promise<number> {
  const { data, error } = await adminClient().from("loan_repayments").select("amount").eq("loan_id", loanId);
  if (error) throw error;
  return (data as { amount: number }[]).reduce((sum, row) => sum + row.amount, 0);
}

// business_settings is a singleton row (id=true) — vat_rate is shared, global
// business state, not a row a test can scope to itself. A test that changes
// it MUST restore the original value in a `finally`. The row itself is never
// seeded (no INSERT in any migration or supabase/seed.sql) — a fresh CI stack
// genuinely has none until the first save creates it, same as a fresh real
// deployment. lib/settings/vat.ts's getCurrentVatRate/setCurrentVatRate
// tolerate that (maybeSingle + a DEFAULT_VAT_RATE fallback, upsert on save);
// these helpers need to match, not assume the row already exists.
const DEFAULT_VAT_RATE = 0.18;

export async function getVatRate(): Promise<number> {
  const { data, error } = await adminClient().from("business_settings").select("vat_rate").eq("id", true).maybeSingle();
  if (error) throw error;
  return (data as { vat_rate: number } | null)?.vat_rate ?? DEFAULT_VAT_RATE;
}

export async function setVatRate(rate: number): Promise<void> {
  const { error } = await adminClient().from("business_settings").upsert({ id: true, vat_rate: rate }, { onConflict: "id" });
  if (error) throw error;
}

// Account creation/edit (AccountsCard.tsx) goes through a direct browser ->
// Supabase call (saveAccountDirect), not an API route — no response to
// capture an id from the way admin-income/admin-expenses do. Cleanup by
// name instead, same pattern as deleteTestTaskByTitle. No local e2e stack
// has any accounts seeded (confirmed repeatedly this session — several
// expense/income/order wizard steps are conditioned on accountsList.length
// === 0), so a test creating one here MUST always delete it in a `finally`.
export async function deleteTestAccountByName(name: string): Promise<void> {
  const { error } = await adminClient().from("accounts").delete().eq("name", name);
  if (error) throw error;
}

export type TestAccount = { id: string; name: string };

// For tests that need one seeded ahead of time (e.g. AccountTransferDialog
// requires at least 2 active accounts before it'll even open a "from"/"to"
// step). account_transfers.from_account_id/to_account_id are both ON DELETE
// CASCADE, so deleting the account(s) afterward also removes any transfer
// row that referenced them — no separate transfer cleanup needed.
export async function createTestAccount(
  overrides: { name?: string; kind?: "bank" | "cash" | "card"; openingBalance?: number } = {}
): Promise<TestAccount> {
  const { data, error } = await adminClient()
    .from("accounts")
    .insert({
      name: overrides.name ?? `חשבון בדיקה ${Date.now()}`,
      kind: overrides.kind ?? "bank",
      opening_balance: overrides.openingBalance ?? 0,
      opening_date: new Date().toISOString().slice(0, 10),
      is_active: true,
    })
    .select("id,name")
    .single();
  if (error) throw error;
  return data as TestAccount;
}

export async function deleteTestAccount(id: string): Promise<void> {
  const { error } = await adminClient().from("accounts").delete().eq("id", id);
  if (error) throw error;
}

export async function getAccountTransferAmount(fromAccountId: string, toAccountId: string): Promise<number | null> {
  const { data, error } = await adminClient()
    .from("account_transfers")
    .select("amount")
    .eq("from_account_id", fromAccountId)
    .eq("to_account_id", toAccountId)
    .maybeSingle();
  if (error) throw error;
  return (data as { amount: number } | null)?.amount ?? null;
}

// getDigestAnchor (lib/audit.ts) reads users.digest_seen_at first and only
// falls back to login history when it's null — pinning it directly makes the
// "missed activity" dashboard card's window deterministic regardless of how
// many other parallel specs have logged this same shared fixture in and out.
export async function setUserDigestSeenAt(userId: string, iso: string | null): Promise<void> {
  const { error } = await adminClient().from("users").update({ digest_seen_at: iso }).eq("id", userId);
  if (error) throw error;
}

export async function getUserDigestSeenAt(userId: string): Promise<string | null> {
  const { data, error } = await adminClient().from("users").select("digest_seen_at").eq("id", userId).single();
  if (error) throw error;
  return (data as { digest_seen_at: string | null }).digest_seen_at;
}
