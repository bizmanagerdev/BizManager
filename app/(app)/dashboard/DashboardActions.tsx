"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  Clock3,
  FolderKanban,
  ListTodo,
  PlayCircle,
  ShoppingCart,
  UserPlus,
} from "lucide-react";
import SessionEditorDialog from "@/app/(app)/payroll/SessionEditorDialog";
import type { SessionFormState } from "@/app/(app)/payroll/SalaryCenter.types";
import type { SalaryCenterProjectOption, SalaryCenterUserRow } from "@/lib/payroll-center";
import NewOrderClient from "@/app/(app)/sales/orders/new/NewOrderClient";
import NewProjectClient, { mapProjectCustomer, type ProjectCustomerOption } from "@/app/(app)/projects/NewProjectClient";
import { HEBREW } from "./DashboardActions.constants";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import type { UserRole } from "@/lib/auth/requireProfile";
import { type SalaryAgreementRow } from "@/lib/payroll";
import type { WorkerDebtItemRow } from "@/lib/payroll-center";
import {
  payrollWorkerTypeAllowsSessions,
  type PayrollWorkerType,
} from "@/lib/payroll-worker-type";
import { getTodayDate, nowLocal } from "./DashboardActions.helpers";
import { buildWeekView } from "@/lib/dashboard/week";
import { QUICK_TILE_CLASS, QuickTileContent } from "@/components/ui/quick-tile";
import {
  buildWorkerPaymentAllocations,
  sortOpenWorkerDebt,
  sumOpenOwed,
  validateWorkerPaymentForm,
} from "./DashboardActions.forms";
import { WeekOverviewDialog, WorkerPaymentDialog } from "./DashboardActions.dialogs";
import { IncomeDialog } from "@/components/financial/IncomeDialog";
import { type Account } from "@/lib/accounts";
import type { CalendarEntry } from "@/lib/projectSchedule";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateCustomerDialog } from "@/components/customers/CreateCustomerDialog";
import { type ProjectPickerOption } from "@/components/projects/ProjectPicker";
import { TaskUpsertDialog } from "@/components/tasks/TaskUpsertDialog";
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";

type Row = Record<string, unknown>;

export type ProjectOption = {
  id: string;
  name: string;
  type?: string;
  customerId: string;
  customerName: string;
  startDate?: string;
};

export type UserOption = {
  id: string;
  label: string;
  role?: UserRole;
  payroll_worker_type?: PayrollWorkerType | null;
  pay_tracking_mode?: string | null;
};

export type EntityOption = {
  id: string;
  name: string;
  subtitle?: string;
};

export type OpenSessionInfo = {
  id: string;
  clock_in: string;
};

export default function DashboardActions({
  customers,
  products,
  projects,
  orders,
  properties,
  users,
  currentUserId,
  currentUserRole,
  currentOpenSession,
  salaryAgreements,
  scheduleEntries,
}: {
  customers: Row[];
  products: Row[];
  projects: ProjectOption[];
  orders: EntityOption[];
  properties: EntityOption[];
  users: UserOption[];
  currentUserId?: string;
  currentUserRole?: UserRole;
  currentOpenSession?: OpenSessionInfo | null;
  salaryAgreements: SalaryAgreementRow[];
  scheduleEntries: CalendarEntry[];
}) {
  const router = useRouter();

  const [orderActionLocked, setOrderActionLocked] = useState(false);

  const [weekOverviewOpen, setWeekOverviewOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [manualSessionOpen, setManualSessionOpen] = useState(false);
  const [availableUsers, setAvailableUsers] = useState(users);
  // The dropdown data may stream in AFTER the buttons first render (so the
  // quick-action buttons appear instantly and dialogs fill in a moment later).
  // `users` is the only data prop copied into local state, so sync it when it
  // changes — every other dropdown reads its prop directly and updates on its own.
  // Skip the empty initial payload so a worker added mid-session isn't clobbered.
  useEffect(() => {
    if (users.length > 0) setAvailableUsers(users);
  }, [users]);

  // The project create flow now runs through the shared <NewProjectClient/> wizard.
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  // Manager defaulting: prefer the configured PM ("הלר") if present in the users list.
  const defaultProjectManagerId = users.find((u) => u.label.replace(/[^א-ת]/g, "").includes("הלר"))?.id ?? "";

  const wizardProjectCustomers = useMemo<ProjectCustomerOption[]>(
    () =>
      customers
        .map((row) => mapProjectCustomer(row))
        .filter((row): row is ProjectCustomerOption => row !== null),
    [customers]
  );
  const wizardProjectManagers = useMemo(
    () => users.map((u) => ({ id: u.id, label: u.label })),
    [users]
  );

  const [accountsList, setAccountsList] = useState<Account[]>([]);

  const [selfSessionSubmitting, setSelfSessionSubmitting] = useState(false);
  // Salary-unlock context for the shared <SessionEditorDialog/> (price + mark-paid sit
  // behind <SalaryProtected/>, same as the payroll workers page). Managers can unlock.
  const [salaryUnlocked, setSalaryUnlocked] = useState(false);
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  // Single source of truth for week bucketing — shared with the inline WeekOverview
  // (was duplicated inline here; see lib/dashboard/week.buildWeekView).
  const weekView = useMemo(() => buildWeekView(scheduleEntries, today), [scheduleEntries, today]);
  const weekStart = weekView.weekStart;
  const weekEnd = weekView.weekEnd;

  // ── Worker payment (pay an hourly / monthly / contract worker) ──────────────
  // Unlike the session flows above, this records a direct worker payment and
  // auto-allocates it to the worker's OPEN debt items (payslips for hourly/monthly
  // workers, sessions for contract workers) so payslip workers can be paid here too.
  const [workerPaymentOpen, setWorkerPaymentOpen] = useState(false);
  const [workerPaymentUserId, setWorkerPaymentUserId] = useState("");
  const [workerPaymentDate, setWorkerPaymentDate] = useState(getTodayDate());
  const [workerPaymentAmount, setWorkerPaymentAmount] = useState("");
  const [workerPaymentMethod, setWorkerPaymentMethod] = useState("");
  const [workerPaymentAccountId, setWorkerPaymentAccountId] = useState("");
  const [workerPaymentReference, setWorkerPaymentReference] = useState("");
  const [workerPaymentNotes, setWorkerPaymentNotes] = useState("");
  const [workerPaymentDebtItems, setWorkerPaymentDebtItems] = useState<WorkerDebtItemRow[]>([]);
  const [workerPaymentDebtLoading, setWorkerPaymentDebtLoading] = useState(false);
  const [workerPaymentSubmitting, setWorkerPaymentSubmitting] = useState(false);
  const [workerPaymentError, setWorkerPaymentError] = useState<string | null>(null);

  const projectPickerOptions: ProjectPickerOption[] = useMemo(
    () =>
      projects.map((project) => ({
        id: project.id,
        label: project.name,
        customerName: project.customerName,
        startDate: project.startDate,
      })),
    [projects]
  );
  // Buckets derived from the shared weekView (logic now lives in lib/dashboard/week).
  const weeklyGeneralEntries = weekView.generalEntries;
  const weeklyBuckets = weekView.days;
  const weeklyEntryCount = weekView.totalCount;
  const canManageWorkerSessions = currentUserRole === "admin" || currentUserRole === "office";
  // Workers that can be paid from the dashboard. Admin can pay anyone payroll-tracked;
  // office may only pay workers below them (matches the protected endpoint's scoping).
  const payableWorkers = useMemo(() => {
    const adminPayable = currentUserRole === "admin";
    return availableUsers.filter((user) => {
      if (user.role === "worker" || user.role === "worker_no_access") return true;
      return adminPayable && (user.role === "admin" || user.role === "office");
    });
  }, [availableUsers, currentUserRole]);
  const workerPaymentOpenOwed = useMemo(
    () => sumOpenOwed(workerPaymentDebtItems),
    [workerPaymentDebtItems]
  );
  // ── Shared <SessionEditorDialog/> data (manual "add shift" quick action) ─────
  // Map the dashboard's lighter data shapes into the shapes the shared payroll
  // dialog expects (it owns all the session/split/payment behaviour internally).
  const sessionEditorWorkers = useMemo<SalaryCenterUserRow[]>(
    () =>
      availableUsers.map((user) => ({
        id: user.id,
        full_name: user.label,
        email: null,
        phone: null,
        role: user.role ?? null,
        active: true,
        system_access: true,
        payroll_worker_type: user.payroll_worker_type ?? null,
        pay_tracking_mode: (user.pay_tracking_mode as "session" | "payslip" | null) ?? null,
      })),
    [availableUsers]
  );
  const sessionEditorProjectOptions = useMemo<SalaryCenterProjectOption[]>(
    () => projects.map((project) => ({ id: project.id, label: project.name })),
    [projects]
  );
  const sessionEditorPropertyOptions = useMemo<SalaryCenterProjectOption[]>(
    () => properties.map((property) => ({ id: property.id, label: property.name })),
    [properties]
  );
  const sessionEditorAgreementsByUserId = useMemo(() => {
    const next = new Map<string, SalaryAgreementRow[]>();
    salaryAgreements.forEach((agreement) => {
      const list = next.get(agreement.user_id) ?? [];
      list.push(agreement);
      next.set(agreement.user_id, list);
    });
    return next;
  }, [salaryAgreements]);
  const sessionEditorInitialForm = useMemo<SessionFormState>(
    () => ({
      session_id: "",
      user_id: canManageWorkerSessions ? "" : currentUserId ?? "",
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
    [canManageWorkerSessions, currentUserId]
  );


  useEffect(() => {
    setAvailableUsers(users);
  }, [users]);

  // "Open shift" is a self-service action — only show it to workers whose pay
  // type actually tracks sessions (קבלנות / שעתי), not monthly-payslip or staff
  // with no worker type.
  const currentUserWorkerType = currentUserId
    ? availableUsers.find((u) => u.id === currentUserId)?.payroll_worker_type ?? null
    : null;
  const canStartOwnSession =
    currentUserWorkerType != null && payrollWorkerTypeAllowsSessions(currentUserWorkerType);

  async function startOwnSession() {
    if (!currentUserId || currentOpenSession?.id || selfSessionSubmitting) return;

    setSelfSessionSubmitting(true);
    try {
      const res = await fetch("/api/profile/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: null }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(HEBREW.selfSessionStartFailed, {
          description: toHebrewError(json.error, HEBREW.saveErrorUnknown),
        });
        return;
      }

      toast.success(HEBREW.selfSessionStarted);
      router.refresh();
    } catch (error: unknown) {
      toast.error(HEBREW.selfSessionStartFailed, {
        description: toHebrewError(error, HEBREW.saveErrorUnknown),
      });
    } finally {
      setSelfSessionSubmitting(false);
    }
  }

  function resetWorkerPaymentForm() {
    setWorkerPaymentError(null);
    setWorkerPaymentUserId("");
    setWorkerPaymentDate(getTodayDate());
    setWorkerPaymentAmount("");
    setWorkerPaymentMethod("");
    setWorkerPaymentAccountId("");
    setWorkerPaymentReference("");
    setWorkerPaymentNotes("");
    setWorkerPaymentDebtItems([]);
    setWorkerPaymentDebtLoading(false);
  }

  // Load the chosen worker's OPEN debt items (so the payment can be allocated and the
  // open balance shown). Scoped server-side to this one worker via the protected endpoint.
  async function loadWorkerPaymentDebt(userId: string) {
    if (!userId) {
      setWorkerPaymentDebtItems([]);
      return;
    }
    setWorkerPaymentDebtLoading(true);
    setWorkerPaymentError(null);
    try {
      const res = await fetch(`/api/payroll/center/protected?userId=${encodeURIComponent(userId)}&fresh=1`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        workerDebtItems?: WorkerDebtItemRow[];
      };
      if (!res.ok) {
        setWorkerPaymentError(toHebrewError(json.error, "טעינת יתרת העובד נכשלה."));
        setWorkerPaymentDebtItems([]);
        return;
      }
      const openItems = sortOpenWorkerDebt(json.workerDebtItems ?? [], userId);
      setWorkerPaymentDebtItems(openItems);
      const owed = sumOpenOwed(openItems);
      // Default the amount to the full open balance (common "pay them what they're owed" case).
      if (owed > 0) setWorkerPaymentAmount(String(Math.round(owed * 100) / 100));
    } catch (error: unknown) {
      setWorkerPaymentError(toHebrewError(error, "טעינת יתרת העובד נכשלה."));
      setWorkerPaymentDebtItems([]);
    } finally {
      setWorkerPaymentDebtLoading(false);
    }
  }

  function selectWorkerPaymentWorker(userId: string) {
    setWorkerPaymentUserId(userId);
    setWorkerPaymentAmount("");
    void loadWorkerPaymentDebt(userId);
  }

  async function saveWorkerPayment() {
    setWorkerPaymentError(null);
    const validationError = validateWorkerPaymentForm({
      workerPaymentUserId,
      workerPaymentDate,
      workerPaymentAmount,
      accountsCount: accountsList.length,
      workerPaymentAccountId,
    });
    if (validationError) {
      setWorkerPaymentError(validationError);
      return;
    }
    const amount = Number(workerPaymentAmount);

    // Auto-allocate across open debts oldest-first; any remainder stays an advance.
    const allocations = buildWorkerPaymentAllocations(amount, workerPaymentDebtItems);

    setWorkerPaymentSubmitting(true);
    try {
      const res = await fetch("/api/payroll/worker-payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: workerPaymentUserId,
          payment_date: workerPaymentDate,
          amount,
          payment_method: workerPaymentMethod.trim() || null,
          account_id: workerPaymentAccountId || null,
          reference_number: workerPaymentReference.trim() || null,
          notes: workerPaymentNotes.trim() || null,
          allocations,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setWorkerPaymentError(toHebrewError(json.error, "שמירת התשלום לעובד נכשלה."));
        return;
      }
      setWorkerPaymentOpen(false);
      resetWorkerPaymentForm();
      router.refresh();
      toast.success("התשלום לעובד נרשם.");
    } catch (error: unknown) {
      setWorkerPaymentError(toHebrewError(error, HEBREW.saveErrorUnknown));
    } finally {
      setWorkerPaymentSubmitting(false);
    }
  }

  return (
    <>
      <AdaptiveGrid variant="quickActions">
        <Button
          type="button"
          variant="outline"
          className={QUICK_TILE_CLASS}
          onClick={() => setWeekOverviewOpen(true)}
        >
          <QuickTileContent icon={FolderKanban} label={HEBREW.thisWeek} />
        </Button>

        <Button
          type="button"
          variant="outline"
          className={QUICK_TILE_CLASS}
          onClick={() => {
            emitNavigationStart();
            router.push("/sales?tab=deliveries");
          }}
        >
          <QuickTileContent icon={ShoppingCart} label={HEBREW.ordersByCity} />
        </Button>

        <Button
          type="button"
          variant="outline"
          className={QUICK_TILE_CLASS}
          onClick={() => setProjectOpen(true)}
        >
          <QuickTileContent icon={FolderKanban} label={HEBREW.projectNew} />
        </Button>

        <Button
          type="button"
          variant="outline"
          className={QUICK_TILE_CLASS}
          onClick={() => {
            setOrderActionLocked(false);
            setOrderOpen(true);
          }}
        >
          <QuickTileContent icon={ShoppingCart} label={HEBREW.orderNew} />
        </Button>

        <Button
          type="button"
          variant="outline"
          className={QUICK_TILE_CLASS}
          onClick={() => setExpenseOpen(true)}
        >
          <QuickTileContent icon={ArrowUpCircle} label={HEBREW.expenseNew} tone="expense" />
        </Button>

        <Button
          type="button"
          variant="outline"
          className={QUICK_TILE_CLASS}
          onClick={() => setIncomeOpen(true)}
        >
          <QuickTileContent icon={ArrowDownCircle} label={HEBREW.incomeNew} tone="income" />
        </Button>

        <Button
          type="button"
          variant="outline"
          className={QUICK_TILE_CLASS}
          onClick={() => setCreateCustomerOpen(true)}
        >
          <QuickTileContent icon={UserPlus} label="לקוח חדש" />
        </Button>

        <Button
          type="button"
          variant="outline"
          className={QUICK_TILE_CLASS}
          onClick={() => setTaskOpen(true)}
        >
          <QuickTileContent icon={ListTodo} label={HEBREW.taskNew} />
        </Button>

        {canStartOwnSession ? (
          <Button
            type="button"
            variant="outline"
            className={QUICK_TILE_CLASS}
            onClick={() => void startOwnSession()}
            disabled={Boolean(currentOpenSession) || selfSessionSubmitting}
          >
            <QuickTileContent icon={PlayCircle} label={HEBREW.selfSessionStart} />
          </Button>
        ) : null}

        {canManageWorkerSessions ? (
          <Button
            type="button"
            variant="outline"
            className={QUICK_TILE_CLASS}
            onClick={() => setManualSessionOpen(true)}
          >
            <QuickTileContent icon={Clock3} label={HEBREW.manualSessionNew} />
          </Button>
        ) : null}

        {canManageWorkerSessions ? (
          <Button
            type="button"
            variant="outline"
            className={QUICK_TILE_CLASS}
            onClick={() => {
              resetWorkerPaymentForm();
              setWorkerPaymentOpen(true);
            }}
          >
            <QuickTileContent icon={Banknote} label="תשלום לעובד" />
          </Button>
        ) : null}
      </AdaptiveGrid>

      <WeekOverviewDialog
        open={weekOverviewOpen}
        onOpenChange={setWeekOverviewOpen}
        weekStart={weekStart}
        weekEnd={weekEnd}
        weeklyEntryCount={weeklyEntryCount}
        weeklyGeneralEntries={weeklyGeneralEntries}
        weeklyBuckets={weeklyBuckets}
      />

      <SessionEditorDialog
        open={manualSessionOpen}
        onOpenChange={setManualSessionOpen}
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
        onSaved={(msg) => {
          router.refresh();
          toast.success(msg);
        }}
      />

      <WorkerPaymentDialog
        open={workerPaymentOpen}
        onOpenChange={(open) => {
          if (!open && workerPaymentSubmitting) return;
          setWorkerPaymentOpen(open);
          if (!open) resetWorkerPaymentForm();
        }}
        submitting={workerPaymentSubmitting}
        payableWorkers={payableWorkers.map((u) => ({ id: u.id, label: u.label }))}
        workerPaymentUserId={workerPaymentUserId}
        onSelectWorker={selectWorkerPaymentWorker}
        debtLoading={workerPaymentDebtLoading}
        openOwed={workerPaymentOpenOwed}
        debtItemCount={workerPaymentDebtItems.length}
        amount={workerPaymentAmount}
        onAmountChange={setWorkerPaymentAmount}
        date={workerPaymentDate}
        onDateChange={setWorkerPaymentDate}
        method={workerPaymentMethod}
        onMethodChange={setWorkerPaymentMethod}
        accountId={workerPaymentAccountId}
        onAccountIdChange={setWorkerPaymentAccountId}
        accountsList={accountsList}
        onAccountsLoaded={setAccountsList}
        reference={workerPaymentReference}
        onReferenceChange={setWorkerPaymentReference}
        notes={workerPaymentNotes}
        onNotesChange={setWorkerPaymentNotes}
        error={workerPaymentError}
        onSave={() => void saveWorkerPayment()}
        onCancel={() => setWorkerPaymentOpen(false)}
      />

      <Dialog
        open={orderOpen}
        onOpenChange={(open) => {
          if (!open && orderActionLocked) return;
          setOrderOpen(open);
        }}
      >
        <AdaptiveDialog size="newOrder">
          <DialogHeader>
            <DialogTitle>{HEBREW.orderNew}</DialogTitle>
            <DialogDescription>{HEBREW.orderDialogDescription}</DialogDescription>
          </DialogHeader>

          <NewOrderClient
            customers={customers}
            products={products}
            customersError={null}
            productsError={null}
            embedded
            onActionLockedChange={setOrderActionLocked}
            onCancel={() => {
              setOrderActionLocked(false);
              setOrderOpen(false);
            }}
            onSubmitted={() => {
              setOrderActionLocked(false);
              setOrderOpen(false);
              router.refresh();
              toast.success(HEBREW.orderSaved);
            }}
          />
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={projectOpen}
        onOpenChange={(open) => {
          if (!open && projectSubmitting) return;
          setProjectOpen(open);
        }}
      >
        <AdaptiveDialog size="newOrder" hideClose className="flex flex-col gap-0 overflow-y-hidden p-0 sm:p-0">
          {/* Title/description kept for screen readers only — the wizard renders its
              own visible per-step heading, so showing them here would duplicate it. */}
          <DialogHeader className="sr-only">
            <DialogTitle>{HEBREW.projectNew}</DialogTitle>
            <DialogDescription>{HEBREW.projectDialogDescription}</DialogDescription>
          </DialogHeader>

          {projectOpen ? (
            <NewProjectClient
              customers={wizardProjectCustomers}
              managers={wizardProjectManagers}
              currentUserId={currentUserId}
              defaultProjectManagerId={defaultProjectManagerId}
              draftKey="project-create"
              onActionLockedChange={setProjectSubmitting}
              onCancel={() => setProjectOpen(false)}
              onSubmitted={() => {
                setProjectOpen(false);
                router.refresh();
                toast.success(HEBREW.projectSaved);
              }}
            />
          ) : null}
        </AdaptiveDialog>
      </Dialog>

      <CreateCustomerDialog
        open={createCustomerOpen}
        onOpenChange={setCreateCustomerOpen}
        description="יוצרים לקוח חדש ישירות מהדשבורד. שדות חובה: שם, טלפון ועיר."
        onCreated={() => {
          router.refresh();
          toast.success("הלקוח נשמר.");
        }}
      />

      <TaskUpsertDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        mode="create"
        wizard
        currentUserId={currentUserId}
        // Only workers with system access can be assigned / added to a task;
        // no-access (payroll-only) workers are excluded from the task pickers.
        users={users.filter((u) => u.role !== "worker_no_access")}
        projects={projectPickerOptions}
        properties={properties.map((property) => ({
          id: property.id,
          label: property.subtitle ? `${property.name} | ${property.subtitle}` : property.name,
        }))}
        onSaved={() => router.refresh()}
      />


      <ExpenseDialog
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        showAttachments
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        users={availableUsers}
        salaryAgreements={salaryAgreements}
        recurringProjects={projectPickerOptions.map((p) => ({ id: p.id, label: p.label }))}
        recurringOrders={orders.map((o) => ({ id: o.id, label: o.subtitle ? `${o.name} | ${o.subtitle}` : o.name }))}
        recurringProperties={properties.map((p) => ({ id: p.id, label: p.subtitle ? `${p.name} | ${p.subtitle}` : p.name }))}
        onSaved={() => router.refresh()}
      />

      <IncomeDialog
        open={incomeOpen}
        onOpenChange={setIncomeOpen}
        projects={projects}
        orders={orders}
        properties={properties}
        onSaved={() => router.refresh()}
      />
    </>
  );
}

