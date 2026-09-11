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
  const { error } = await adminClient().from("orders").delete().eq("id", id);
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

export async function deleteTestReminder(id: string): Promise<void> {
  const { error } = await adminClient().from("reminders").delete().eq("id", id);
  if (error) throw error;
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

export type TestExpense = { id: string };

export async function createTestExpense(overrides: { amount?: number; description?: string } = {}): Promise<TestExpense> {
  const recordedBy = await getAdminUserId();
  const { data, error } = await adminClient()
    .from("expenses")
    .insert({
      amount: overrides.amount ?? 100,
      category: "אחר",
      description: overrides.description ?? `הוצאת בדיקה ${Date.now()}`,
      recorded_by: recordedBy,
      payment_status: "paid",
      business_domain: "general_business",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as TestExpense;
}

export async function deleteTestExpense(id: string): Promise<void> {
  const { error } = await adminClient().from("expenses").delete().eq("id", id);
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
