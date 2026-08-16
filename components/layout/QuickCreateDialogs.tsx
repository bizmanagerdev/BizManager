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
  const attendanceWorkers = useMemo(
    () =>
      data.users
        .filter(
          (u) =>
            (u.role === "worker" || u.role === "worker_no_access") &&
            payrollWorkerTypeAllowsSessions(normalizePayrollWorkerType(u.payroll_worker_type, u.pay_tracking_mode))
        )
        .map((u) => ({ id: u.id, label: u.label })),
    [data.users]
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
