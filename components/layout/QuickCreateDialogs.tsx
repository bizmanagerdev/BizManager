"use client";

// The dialog bodies behind the top-bar quick-create (+) menu. Split out of
// QuickCreateMenu and loaded with next/dynamic so the order wizard, project
// wizard, expense form etc. are NOT in the bundle of every page that renders the
// top bar — they arrive only once the user reaches for the + menu.
//
// Every action here is a dialog on purpose: the point of the menu is that you can
// add a task while mid-way through the financial page and land back exactly where
// you were. Nothing navigates; saving calls router.refresh(), which re-renders the
// current route in place (same scroll position, same open tab).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import SessionEditorDialog from "@/app/(app)/payroll/SessionEditorDialog";
import type { SessionFormState } from "@/app/(app)/payroll/SalaryCenter.types";
import type { SalaryCenterProjectOption, SalaryCenterUserRow } from "@/lib/payroll-center";
import type { SalaryAgreementRow } from "@/lib/payroll";
import { WorkerPaymentDialog } from "@/components/payroll/WorkerPaymentDialog";
import { nowLocal } from "@/app/(app)/dashboard/DashboardActions.helpers";
import NewOrderClient from "@/app/(app)/sales/orders/new/NewOrderClient";
import NewProjectClient, {
  mapProjectCustomer,
  type ProjectCustomerOption,
} from "@/app/(app)/projects/NewProjectClient";
import { HEBREW } from "@/app/(app)/dashboard/DashboardActions.constants";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UploadDocumentDialog } from "@/components/documents/UploadDocumentDialog";
import { CreateCustomerDialog } from "@/components/customers/CreateCustomerDialog";
import { TaskUpsertDialog } from "@/components/tasks/TaskUpsertDialog";
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import { IncomeDialog } from "@/components/financial/IncomeDialog";
import { AccountTransferDialog } from "@/components/financial/AccountTransferDialog";
import { CollectPaymentDialog } from "@/components/collections/CollectPaymentDialog";
import ReminderFormDialog from "@/components/reminders/ReminderFormDialog";
import { AttendanceLogDialog } from "@/components/attendance/AttendanceLogDialog";
import { OrderDeliveryDateDialog } from "@/components/orders/OrderDeliveryDateDialog";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";
import type { QuickCreateAction, QuickCreateData } from "@/components/layout/quick-create-types";

export default function QuickCreateDialogs({
  action,
  onClose,
  data,
  quickCreateDate,
  quickCreateAccountId,
}: {
  action: QuickCreateAction | null;
  onClose: () => void;
  data: QuickCreateData;
  /** Pre-fill the date on a new task / reminder / project (e.g. a calendar day),
   *  as `YYYY-MM-DD`. */
  quickCreateDate?: string;
  /** Pre-fill the account on a new income / expense (the חשבונות page's + / −). */
  quickCreateAccountId?: string;
}) {
  const router = useRouter();
  // While a wizard is mid-submit its dialog must not be dismissable — closing it
  // would orphan a request that's already creating a row.
  const [submitLocked, setSubmitLocked] = useState(false);

  const projectWizardCustomers = useMemo<ProjectCustomerOption[]>(
    () =>
      data.customers
        .map((row) => mapProjectCustomer(row))
        .filter((row): row is ProjectCustomerOption => row !== null),
    [data.customers]
  );
  const projectWizardManagers = useMemo(
    () => data.users.map((u) => ({ id: u.id, label: u.label })),
    [data.users]
  );
  const defaultProjectManagerId =
    data.users.find((u) => u.label.replace(/[^א-ת]/g, "").includes("הלר"))?.id ?? "";

  const projectPickerOptions = useMemo(
    () =>
      data.projects.map((project) => ({
        id: project.id,
        label: project.name,
        customerName: project.customerName,
        startDate: project.startDate,
      })),
    [data.projects]
  );
  const propertyOptions = useMemo(
    () =>
      data.properties.map((property) => ({
        id: property.id,
        label: property.subtitle ? `${property.name} | ${property.subtitle}` : property.name,
      })),
    [data.properties]
  );
  // Workers eligible for phone-attendance logging (session-logging types).
  // An Arabic-locale worker may only log his OWN attendance — no colleague
  // sign-in (user, 2026-08-20) — so the picker is narrowed to just himself.
  const restrictAttendanceToSelf = data.role === "worker" && data.locale === "ar";
  const attendanceWorkers = useMemo(() => {
    const eligible = data.users
      .filter(
        (u) =>
          (u.role === "worker" || u.role === "worker_no_access") &&
          payrollWorkerTypeAllowsSessions(normalizePayrollWorkerType(u.payroll_worker_type, u.pay_tracking_mode))
      )
      .map((u) => ({ id: u.id, label: u.label }));
    return restrictAttendanceToSelf ? eligible.filter((u) => u.id === data.currentUserId) : eligible;
  }, [data.users, restrictAttendanceToSelf, data.currentUserId]);

  // ── "משמרת ידנית" ───────────────────────────────────────────────────────────
  // The shared payroll <SessionEditorDialog/> owns all the session / split /
  // payment behaviour; these just map the lighter picker shapes into the ones it
  // expects. Only admin + office reach this action (see ADMIN_OR_OFFICE_ACTIONS).
  const canManageWorkerSessions = data.role === "admin" || data.role === "office";
  const [salaryUnlocked, setSalaryUnlocked] = useState(false);
  const sessionEditorWorkers = useMemo<SalaryCenterUserRow[]>(
    () =>
      data.users.map((user) => ({
        id: user.id,
        full_name: user.label,
        email: null,
        phone: null,
        role: user.role ?? null,
        active: true,
        system_access: true,
        payroll_worker_type: user.payroll_worker_type ?? null,
        pay_tracking_mode: (user.pay_tracking_mode as "session" | "payslip" | null) ?? null,
        // Not carried on this lighter picker shape — irrelevant here, this list
        // only feeds the session editor, never a locale-aware display or a
        // deliveries-access check.
        locale: "he" as const,
        deliveries_access: true,
      })),
    [data.users]
  );
  const sessionEditorProjectOptions = useMemo<SalaryCenterProjectOption[]>(
    () => data.projects.map((project) => ({ id: project.id, label: project.name })),
    [data.projects]
  );
  const sessionEditorPropertyOptions = useMemo<SalaryCenterProjectOption[]>(
    () => data.properties.map((property) => ({ id: property.id, label: property.name })),
    [data.properties]
  );
  const sessionEditorAgreementsByUserId = useMemo(() => {
    const next = new Map<string, SalaryAgreementRow[]>();
    data.salaryAgreements.forEach((agreement) => {
      const list = next.get(agreement.user_id) ?? [];
      list.push(agreement);
      next.set(agreement.user_id, list);
    });
    return next;
  }, [data.salaryAgreements]);
  // Defaults to the last hour — the common "I forgot to clock that" shape.
  const sessionEditorInitialForm = useMemo<SessionFormState>(
    () => ({
      session_id: "",
      user_id: canManageWorkerSessions ? "" : data.currentUserId ?? "",
      business_domain: "general_business",
      project_id: "",
      property_id: "",
      notes: "",
      clock_in: nowLocal(-60),
      clock_out: nowLocal(),
      labor_cost: "",
      original_user_id: "",
      original_clock_in: "",
      original_clock_out: "",
      original_labor_cost: "",
      is_billable_to_customer: false,
      bill_to_customer_amount: "",
      billing_status: "not_billable",
      mark_paid_now: false,
      paid_amount_now: "",
    }),
    [canManageWorkerSessions, data.currentUserId]
  );

  // Saved → the underlying page re-renders in place; the user never left it.
  function done(message: string) {
    onClose();
    router.refresh();
    toast.success(message);
  }

  return (
    <>
      <TaskUpsertDialog
        open={action === "task"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        mode="create"
        wizard
        defaultDueDate={quickCreateDate}
        currentUserId={data.currentUserId ?? undefined}
        // Only workers with system access can be assigned a task; no-access
        // (payroll-only) workers are excluded from the pickers.
        users={data.users.filter((u) => u.role !== "worker_no_access")}
        projects={projectPickerOptions}
        properties={propertyOptions}
        onSaved={() => router.refresh()}
      />

      <ExpenseDialog
        open={action === "expense"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        showAttachments
        defaultAccountId={quickCreateAccountId}
        currentUserId={data.currentUserId ?? undefined}
        currentUserRole={data.role ?? undefined}
        users={data.users}
        salaryAgreements={data.salaryAgreements}
        recurringProjects={projectPickerOptions.map((p) => ({ id: p.id, label: p.label }))}
        recurringOrders={data.orders.map((o) => ({
          id: o.id,
          label: o.subtitle ? `${o.name} | ${o.subtitle}` : o.name,
        }))}
        recurringProperties={propertyOptions}
        onSaved={() => router.refresh()}
      />

      <IncomeDialog
        open={action === "income"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        projects={data.projects}
        orders={data.orders}
        properties={data.properties}
        defaultAccountId={quickCreateAccountId}
        onSaved={() => router.refresh()}
      />

      <Dialog
        open={action === "order"}
        onOpenChange={(open) => {
          if (!open && submitLocked) return;
          if (!open) onClose();
        }}
      >
        <AdaptiveDialog size="newOrder" hideClose className="flex flex-col gap-0 overflow-y-hidden p-0 sm:p-0">
          {/* Screen-reader only: the wizard renders its own visible step heading. */}
          <DialogHeader className="sr-only">
            <DialogTitle>{HEBREW.orderNew}</DialogTitle>
            <DialogDescription>{HEBREW.orderDialogDescription}</DialogDescription>
          </DialogHeader>

          {action === "order" ? (
            <NewOrderClient
              customers={data.customers}
              products={data.products}
              customersError={null}
              productsError={null}
              embedded
              onActionLockedChange={setSubmitLocked}
              onCancel={() => {
                setSubmitLocked(false);
                onClose();
              }}
              onSubmitted={() => {
                setSubmitLocked(false);
                done(HEBREW.orderSaved);
              }}
            />
          ) : null}
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={action === "project"}
        onOpenChange={(open) => {
          if (!open && submitLocked) return;
          if (!open) onClose();
        }}
      >
        <AdaptiveDialog size="newOrder" hideClose className="flex flex-col gap-0 overflow-y-hidden p-0 sm:p-0">
          {/* Screen-reader only: the wizard renders its own visible step heading. */}
          <DialogHeader className="sr-only">
            <DialogTitle>{HEBREW.projectNew}</DialogTitle>
            <DialogDescription>{HEBREW.projectDialogDescription}</DialogDescription>
          </DialogHeader>

          {action === "project" ? (
            <NewProjectClient
              customers={projectWizardCustomers}
              managers={projectWizardManagers}
              currentUserId={data.currentUserId ?? undefined}
              defaultProjectManagerId={defaultProjectManagerId}
              defaultStartDate={quickCreateDate}
              draftKey="quick-create-project"
              onActionLockedChange={setSubmitLocked}
              onCancel={() => {
                setSubmitLocked(false);
                onClose();
              }}
              onSubmitted={() => {
                setSubmitLocked(false);
                done(HEBREW.projectSaved);
              }}
            />
          ) : null}
        </AdaptiveDialog>
      </Dialog>

      <CollectPaymentDialog
        open={action === "collect"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onSaved={() => router.refresh()}
      />

      {/* Not a new record — schedules an ALREADY-EXISTING order's delivery.
          Calendar-only entry point (no + menu tile). */}
      <OrderDeliveryDateDialog
        open={action === "delivery"}
        orders={data.orders}
        users={data.users}
        defaultDate={quickCreateDate}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onSaved={() => router.refresh()}
      />

      {/* Moving money between our own accounts (cash withdrawal / bank→bank) —
          not an income and not an expense, so it never reaches the P&L. */}
      <AccountTransferDialog
        open={action === "transfer"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onSaved={() => router.refresh()}
      />

      <CreateCustomerDialog
        open={action === "customer"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onCreated={() => {
          router.refresh();
          toast.success("הלקוח נשמר.");
        }}
      />

      {/* Standalone reminder: no entity links, so it's a plain "remind me at" —
          entity-scoped reminders still live on the order / task / customer. */}
      <ReminderFormDialog
        mode="create"
        category="general"
        canAssignOthers={data.role !== "worker"}
        open={action === "reminder"}
        defaultRemindAt={quickCreateDate ? `${quickCreateDate}T09:00` : undefined}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onSaved={() => router.refresh()}
      />

      <AttendanceLogDialog
        open={action === "attendance"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        workers={attendanceWorkers}
        onSaved={() => router.refresh()}
        locale={data.locale}
      />

      {/* Pay a worker — the amount nets against their open payslips / sessions. */}
      <WorkerPaymentDialog
        open={action === "workerPayment"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        users={data.users}
        currentUserRole={data.role ?? undefined}
        onSaved={() => {
          router.refresh();
          toast.success("התשלום לעובד נרשם.");
        }}
      />

      {/* A closed shift typed in after the fact — writes the session directly,
          unlike "דיווח נוכחות", which lands in the approval queue. */}
      <SessionEditorDialog
        open={action === "manualSession"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        mode="create"
        initialForm={sessionEditorInitialForm}
        workers={sessionEditorWorkers}
        projectOptions={sessionEditorProjectOptions}
        propertyOptions={sessionEditorPropertyOptions}
        agreementsByUserId={sessionEditorAgreementsByUserId}
        salaryUnlocked={salaryUnlocked}
        hasPasswordConfigured={false}
        canViewSalary={canManageWorkerSessions}
        onUnlockSuccess={() => setSalaryUnlocked(true)}
        onSaved={(message) => {
          router.refresh();
          toast.success(message);
        }}
      />

      <UploadDocumentDialog
        open={action === "document"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        projects={projectPickerOptions.map((p) => ({ id: p.id, label: p.label }))}
        properties={propertyOptions}
        onUploaded={() => router.refresh()}
      />
    </>
  );
}
