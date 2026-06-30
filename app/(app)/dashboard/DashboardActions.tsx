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
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { HEBREW } from "./DashboardActions.constants";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import type { UserRole } from "@/lib/auth/requireProfile";
import {
  EXPENSE_CATEGORY_OPTIONS_WITH_WAGE,
  EXPENSE_OTHER_CATEGORY,
  EXPENSE_WORKER_WAGE_CATEGORY,
  EXPENSE_CARS_CATEGORY,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { DomainSelect } from "@/components/financial/DomainSelect";
import {
  calculateSessionLaborCost,
  getActiveSalaryAgreementForDate,
  type SalaryAgreementRow,
} from "@/lib/payroll";
import type { WorkerDebtItemRow } from "@/lib/payroll-center";
import {
  payrollWorkerTypeAllowsSessions,
  shouldShowSessionHours,
  shouldShowSessionPrice,
  type PayrollWorkerType,
} from "@/lib/payroll-worker-type";
import { PAYMENT_METHOD_OPTIONS, type FinancialAttachment } from "@/lib/payments";
import {
  durationHours,
  formatIls,
  getString,
  getTodayDate,
  isImageAttachment,
  normalizeDateOnly,
  nowLocal,
  toIso,
  uploadFinancialAttachment,
} from "./DashboardActions.helpers";
import { buildWeekView } from "@/lib/dashboard/week";
import {
  buildIncomePayload,
  buildRegularExpensePayload,
  buildWorkerPaymentAllocations,
  sortOpenWorkerDebt,
  sumOpenOwed,
  validateIncomeForm,
  validateRegularExpense,
  validateWorkerPaymentForm,
} from "./DashboardActions.forms";
import { WeekOverviewDialog, WorkerPaymentDialog } from "./DashboardActions.dialogs";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { offlineFetch } from "@/lib/offline-queue";
import type { CalendarEntry } from "@/lib/projectSchedule";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { CreateCustomerDialog } from "@/components/customers/CreateCustomerDialog";
import { ProjectPicker, type ProjectPickerOption } from "@/components/projects/ProjectPicker";
import { TaskUpsertDialog } from "@/components/tasks/TaskUpsertDialog";
import { TagPicker } from "@/components/tags/TagPicker";

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

type PaymentChoice = "none" | "paid" | "partial";

const fieldClass =
  "h-11 w-full rounded-xl border border-input bg-background/80 px-4 py-2 text-sm shadow-sm outline-none transition-all focus:border-destructive/40 focus:ring-2 focus:ring-ring";

// Categories come from the shared source of truth in lib/expenses.
const DASHBOARD_EXPENSE_CATEGORY_OPTIONS = EXPENSE_CATEGORY_OPTIONS_WITH_WAGE;
const OTHER_EXPENSE_CATEGORY = EXPENSE_OTHER_CATEGORY;
const EMPLOYEE_WAGE_CATEGORY = EXPENSE_WORKER_WAGE_CATEGORY;
const CARS_EXPENSE_CATEGORY = EXPENSE_CARS_CATEGORY;

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

  const [expenseSubmitting, setExpenseSubmitting] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [expenseBusinessDomain, setExpenseBusinessDomain] = useState<ExpenseBusinessDomain | "">("");
  const [expenseProjectId, setExpenseProjectId] = useState("");
  const [expenseOrderId, setExpenseOrderId] = useState("");
  const [expensePropertyId, setExpensePropertyId] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  const [expenseCategoryOther, setExpenseCategoryOther] = useState("");
  const [expenseDate, setExpenseDate] = useState(getTodayDate());
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");
  const [expenseBilledToCustomer, setExpenseBilledToCustomer] = useState(false);
  const [expenseWorkerUserId, setExpenseWorkerUserId] = useState("");
  const [expenseClockIn, setExpenseClockIn] = useState("");
  const [expenseClockOut, setExpenseClockOut] = useState("");
  const [expenseLaborCost, setExpenseLaborCost] = useState("");
  const [expenseWorkerPaymentChoice, setExpenseWorkerPaymentChoice] = useState<PaymentChoice>("none");
  const [expenseWorkerPaidAmount, setExpenseWorkerPaidAmount] = useState("");
  const [expenseWorkerAccountId, setExpenseWorkerAccountId] = useState("");
  const [expenseBillToCustomerAmount, setExpenseBillToCustomerAmount] = useState("");
  const [expensePaymentStatus, setExpensePaymentStatus] = useState<"paid" | "partial" | "not_paid">("paid");
  const [expensePaymentMethod, setExpensePaymentMethod] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [expenseAttachmentFiles, setExpenseAttachmentFiles] = useState<File[]>([]);
  const [expenseExistingAttachments, setExpenseExistingAttachments] = useState<FinancialAttachment[]>([]);
  const [expenseTagIds, setExpenseTagIds] = useState<string[]>([]);
  const [expenseNewWorkerOpen, setExpenseNewWorkerOpen] = useState(false);
  const [expenseNewWorkerSubmitting, setExpenseNewWorkerSubmitting] = useState(false);
  const [expenseNewWorkerError, setExpenseNewWorkerError] = useState<string | null>(null);
  const [expenseNewWorkerName, setExpenseNewWorkerName] = useState("");
  const [expenseNewWorkerPhone, setExpenseNewWorkerPhone] = useState("");

  const [incomeSubmitting, setIncomeSubmitting] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [incomeBusinessDomain, setIncomeBusinessDomain] = useState<ExpenseBusinessDomain | "">("");
  const [incomeProjectId, setIncomeProjectId] = useState("");
  const [incomeProjectQuery, setIncomeProjectQuery] = useState("");
  const [incomeOrderId, setIncomeOrderId] = useState("");
  const [incomePropertyId, setIncomePropertyId] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeDate, setIncomeDate] = useState(getTodayDate());
  const [incomeMethod, setIncomeMethod] = useState("");
  const [incomeAccountId, setIncomeAccountId] = useState("");
  const [incomeDueDate, setIncomeDueDate] = useState("");
  const [incomeRequiresSplit, setIncomeRequiresSplit] = useState(false);
  const [incomeReference, setIncomeReference] = useState("");
  const [incomeCheckNumber, setIncomeCheckNumber] = useState("");
  const [incomeCheckPhotoFiles, setIncomeCheckPhotoFiles] = useState<File[]>([]);
  const [incomeNotes, setIncomeNotes] = useState("");
  const [incomeAttachmentFiles, setIncomeAttachmentFiles] = useState<File[]>([]);
  const [incomeExistingAttachments, setIncomeExistingAttachments] = useState<FinancialAttachment[]>([]);
  const [incomeTagIds, setIncomeTagIds] = useState<string[]>([]);
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

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );
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
  const filteredIncomeProjects = useMemo(() => {
    const q = incomeProjectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => {
      const name = project.name.toLowerCase();
      const customer = project.customerName.toLowerCase();
      return name.includes(q) || customer.includes(q);
    });
  }, [incomeProjectQuery, projects]);
  // Buckets derived from the shared weekView (logic now lives in lib/dashboard/week).
  const weeklyGeneralEntries = weekView.generalEntries;
  const weeklyBuckets = weekView.days;
  const weeklyEntryCount = weekView.totalCount;
  const workerUsers = useMemo(
    () => availableUsers.filter((user) => user.role === "worker" || user.role === "worker_no_access"),
    [availableUsers]
  );
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

  const finalExpenseCategory =
    expenseCategory === OTHER_EXPENSE_CATEGORY ? expenseCategoryOther.trim() : expenseCategory.trim();
  const expenseIsWorkerPayment = finalExpenseCategory === EMPLOYEE_WAGE_CATEGORY;
  const expenseTargetUserId = canManageWorkerSessions ? expenseWorkerUserId : currentUserId ?? "";
  const selectedExpenseWorkerType = useMemo<PayrollWorkerType | null>(() => {
    if (!expenseIsWorkerPayment || !expenseTargetUserId) return null;
    return availableUsers.find((u) => u.id === expenseTargetUserId)?.payroll_worker_type ?? null;
  }, [availableUsers, expenseIsWorkerPayment, expenseTargetUserId]);
  const showExpenseSessionTimingFields = !expenseIsWorkerPayment || shouldShowSessionHours(selectedExpenseWorkerType);
  const showExpenseSessionPriceField = !expenseIsWorkerPayment || shouldShowSessionPrice(selectedExpenseWorkerType);
  // Contractor/session workers have no clocked hours, so the labor cost is the
  // only way to set what they're owed — it's mandatory for them.
  const expenseSessionPriceRequired = expenseIsWorkerPayment && selectedExpenseWorkerType === "session_only";
  const expenseSessionDateOnly = useMemo(() => {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(expenseClockIn);
    return match ? match[1] : new Date().toISOString().slice(0, 10);
  }, [expenseClockIn]);
  useEffect(() => {
    if (selectedExpenseWorkerType !== "session_only") return;
    const normIn = `${expenseSessionDateOnly}T09:00`;
    const normOut = `${expenseSessionDateOnly}T10:00`;
    if (expenseClockIn !== normIn) setExpenseClockIn(normIn);
    if (expenseClockOut !== normOut) setExpenseClockOut(normOut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExpenseWorkerType]);
  const expenseDuration = useMemo(
    () => durationHours(expenseClockIn, expenseClockOut),
    [expenseClockIn, expenseClockOut]
  );
  const expenseWorkedMinutes = useMemo(() => {
    const start = new Date(expenseClockIn).getTime();
    const end = new Date(expenseClockOut).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.round((end - start) / 60000);
  }, [expenseClockIn, expenseClockOut]);
  const activeExpenseSessionAgreement = useMemo(() => {
    if (!expenseIsWorkerPayment || !expenseTargetUserId) return null;
    const referenceDate = toIso(expenseClockIn);
    if (!referenceDate) return null;
    return getActiveSalaryAgreementForDate(
      salaryAgreements.filter((agreement) => agreement.user_id === expenseTargetUserId),
      new Date(referenceDate)
    );
  }, [expenseClockIn, expenseIsWorkerPayment, expenseTargetUserId, salaryAgreements]);
  const suggestedExpenseWorkerAmount = useMemo(() => {
    if (!expenseIsWorkerPayment) return null;
    if (expenseLaborCost.trim()) {
      const parsed = Number(expenseLaborCost);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (expenseWorkedMinutes <= 0) return null;
    return calculateSessionLaborCost(activeExpenseSessionAgreement, expenseWorkedMinutes);
  }, [activeExpenseSessionAgreement, expenseIsWorkerPayment, expenseLaborCost, expenseWorkedMinutes]);

  useEffect(() => {
    setAvailableUsers(users);
  }, [users]);

  useEffect(() => {
    if (!expenseIsWorkerPayment || !canManageWorkerSessions || expenseWorkerPaymentChoice === "none" || suggestedExpenseWorkerAmount === null) {
      return;
    }
    setExpenseWorkerPaidAmount((current) => {
      if (expenseWorkerPaymentChoice === "paid") {
        return String(Number(suggestedExpenseWorkerAmount.toFixed(2)));
      }
      return current.trim()
        ? current
        : String(Number(suggestedExpenseWorkerAmount.toFixed(2)));
    });
  }, [
    canManageWorkerSessions,
    expenseIsWorkerPayment,
    expenseWorkerPaymentChoice,
    suggestedExpenseWorkerAmount,
  ]);

  function resetExpenseForm() {
    setExpenseError(null);
    setExpenseBusinessDomain("");
    setExpenseProjectId("");
    setExpenseOrderId("");
    setExpensePropertyId("");
    setExpenseAmount("");
    setExpenseCategory("");
    setExpenseCategoryOther("");
    setExpenseDate(getTodayDate());
    setExpenseDescription("");
    setExpenseNotes("");
    setExpenseBilledToCustomer(false);
    setExpensePaymentStatus("paid");
    setExpensePaymentMethod("");
    setExpenseAccountId("");
    setExpenseWorkerAccountId("");
    setExpenseWorkerUserId("");
    setExpenseClockIn("");
    setExpenseClockOut("");
    setExpenseLaborCost("");
    setExpenseWorkerPaymentChoice("none");
    setExpenseWorkerPaidAmount("");
    setExpenseBillToCustomerAmount("");
    setExpenseAttachmentFiles([]);
    setExpenseExistingAttachments([]);
    setExpenseTagIds([]);
    setExpenseNewWorkerOpen(false);
    setExpenseNewWorkerSubmitting(false);
    setExpenseNewWorkerError(null);
    setExpenseNewWorkerName("");
    setExpenseNewWorkerPhone("");
  }

  function resetIncomeForm() {
    setIncomeError(null);
    setIncomeBusinessDomain("");
    setIncomeProjectId("");
    setIncomeProjectQuery("");
    setIncomeOrderId("");
    setIncomePropertyId("");
    setIncomeAmount("");
    setIncomeDate(getTodayDate());
    setIncomeMethod("");
    setIncomeAccountId("");
    setIncomeDueDate("");
    setIncomeRequiresSplit(false);
    setIncomeReference("");
    setIncomeCheckNumber("");
    setIncomeCheckPhotoFiles([]);
    setIncomeNotes("");
    setIncomeAttachmentFiles([]);
    setIncomeExistingAttachments([]);
    setIncomeTagIds([]);
  }

  async function createExpense() {
    setExpenseError(null);
    if (!expenseBusinessDomain) {
      setExpenseError("יש לבחור תחום.");
      return;
    }
    const linkedProjectId = expenseBusinessDomain === "logistics_projects" ? expenseProjectId : "";
    const linkedOrderId = expenseBusinessDomain === "sales" ? expenseOrderId : "";
    const linkedPropertyId = expenseBusinessDomain === "property_management" ? expensePropertyId : "";

    if (!finalExpenseCategory) {
      setExpenseError(HEBREW.expenseRequired);
      return;
    }
    if (expenseBusinessDomain === "logistics_projects" && !linkedProjectId) {
      setExpenseError(HEBREW.sessionInvalidProject);
      return;
    }
    if (expenseBusinessDomain === "property_management" && !linkedPropertyId) {
      setExpenseError(HEBREW.sessionInvalidProperty);
      return;
    }

    if (expenseIsWorkerPayment) {
      if (!expenseTargetUserId) {
        setExpenseError(HEBREW.sessionInvalidWorker);
        return;
      }

      const clockInIso = toIso(expenseClockIn);
      const clockOutIso = toIso(expenseClockOut);
      if (!clockInIso || !clockOutIso || new Date(clockOutIso) <= new Date(clockInIso)) {
        setExpenseError(HEBREW.sessionInvalidTimes);
        return;
      }

      const laborCostNumber =
        expenseLaborCost.trim() === "" ? null : Number(expenseLaborCost);
      if (expenseSessionPriceRequired && laborCostNumber === null) {
        setExpenseError("יש להזין עלות עבודה.");
        return;
      }
      if (
        expenseLaborCost.trim() !== "" &&
        (laborCostNumber === null || !Number.isFinite(laborCostNumber) || laborCostNumber <= 0)
      ) {
        setExpenseError("יש להזין עלות עבודה תקינה.");
        return;
      }

      const workerPaidAmountNumber =
        expenseWorkerPaymentChoice === "none" || !expenseWorkerPaidAmount.trim()
          ? suggestedExpenseWorkerAmount
          : Number(expenseWorkerPaidAmount);
      if (
        canManageWorkerSessions &&
        expenseWorkerPaymentChoice !== "none" &&
        (!Number.isFinite(workerPaidAmountNumber) || workerPaidAmountNumber === null || workerPaidAmountNumber <= 0)
      ) {
        setExpenseError("יש להזין סכום ששולם לעובד.");
        return;
      }
      if (
        expenseWorkerPaymentChoice !== "none" &&
        accountsList.length > 0 &&
        !expenseWorkerAccountId
      ) {
        setExpenseError("יש לבחור חשבון לתשלום לעובד.");
        return;
      }

      const billToCustomerAmountNumber =
        !expenseBilledToCustomer || !expenseBillToCustomerAmount.trim()
          ? null
          : Number(expenseBillToCustomerAmount);
      if (
        expenseBilledToCustomer &&
        (!Number.isFinite(billToCustomerAmountNumber) || billToCustomerAmountNumber === null || billToCustomerAmountNumber <= 0)
      ) {
        setExpenseError("יש להזין סכום לחיוב לקוח.");
        return;
      }

      setExpenseSubmitting(true);
      try {
        const endpoint = canManageWorkerSessions ? "/api/payroll/sessions/create" : "/api/profile/session/create";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            user_id: expenseTargetUserId,
            business_domain: expenseBusinessDomain,
            project_id: linkedProjectId || null,
            property_id: linkedPropertyId || null,
            notes: expenseNotes.trim() || null,
            clock_in: clockInIso,
            clock_out: clockOutIso,
            labor_cost: laborCostNumber,
            is_billable_to_customer: expenseBilledToCustomer,
            bill_to_customer_amount: expenseBilledToCustomer ? billToCustomerAmountNumber : null,
            billing_status: expenseBilledToCustomer ? "billable" : "not_billable",
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          session?: { id?: string; user_id?: string; clock_in?: string; clock_out?: string; labor_cost?: number | string | null };
        };
        if (!res.ok || !json.session) {
          setExpenseError(toHebrewError(json.error, HEBREW.expenseCreateFailed));
          return;
        }

        if (
          canManageWorkerSessions &&
          expenseWorkerPaymentChoice !== "none" &&
          json.session.id &&
          json.session.user_id &&
          Number.isFinite(workerPaidAmountNumber) &&
          workerPaidAmountNumber !== null &&
          workerPaidAmountNumber > 0
        ) {
          const paymentDateSource = json.session.clock_out || json.session.clock_in || new Date().toISOString();
          const paymentResponse = await fetch("/api/payroll/worker-payments", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              user_id: json.session.user_id,
              payment_date: paymentDateSource.slice(0, 10),
              amount: workerPaidAmountNumber,
              payment_method: null,
              account_id: expenseWorkerAccountId || null,
              reference_number: null,
              notes: `תשלום שסומן מתוך הדשבורד עבור משמרת ${paymentDateSource.slice(0, 10)}`,
              allocations: [
                {
                  source_type: "session",
                  source_id: json.session.id,
                  amount: workerPaidAmountNumber,
                },
              ],
            }),
          });
          const paymentJson = (await paymentResponse.json().catch(() => ({}))) as { error?: string };
          if (!paymentResponse.ok) {
            throw new Error(toHebrewError(paymentJson.error, "שמירת התשלום לעובד נכשלה."));
          }
        }

        const sessionId = typeof json.session.id === "string" ? json.session.id : "";
        for (const file of expenseAttachmentFiles) {
          if (!sessionId) break;
          await uploadFinancialAttachment("session", sessionId, file);
        }

        setExpenseOpen(false);
        resetExpenseForm();
        router.refresh();
        toast.success(
          canManageWorkerSessions && expenseWorkerPaymentChoice !== "none"
            ? "הוצאות השכר נשמרו והתשלום לעובד נרשם."
            : HEBREW.expenseSaved
        );
      } catch (error: unknown) {
        setExpenseError(toHebrewError(error, HEBREW.saveErrorUnknown));
      } finally {
        setExpenseSubmitting(false);
      }
      return;
    }

    const isProjectExpense = expenseBusinessDomain === "logistics_projects";
    const regularExpenseError = validateRegularExpense({
      expenseDate,
      expenseAmount,
      expensePaymentStatus,
      expensePaymentMethod,
      accountsCount: accountsList.length,
      expenseAccountId,
      isProjectExpense,
      expenseBilledToCustomer,
      expenseBillToCustomerAmount,
    });
    if (regularExpenseError) {
      setExpenseError(regularExpenseError);
      return;
    }

    setExpenseSubmitting(true);
    try {
      const result = await offlineFetch(
        "/api/expenses/create",
        buildRegularExpensePayload({
          expenseBusinessDomain,
          linkedProjectId,
          linkedOrderId,
          linkedPropertyId,
          expenseAmount,
          finalExpenseCategory,
          expenseDate,
          expenseDescription,
          expenseNotes,
          expenseBilledToCustomer,
          expenseBillToCustomerAmount,
          expensePaymentStatus,
          expensePaymentMethod,
          expenseAccountId,
          expenseCategory,
          carsCategory: CARS_EXPENSE_CATEGORY,
          expenseTagIds,
        }),
        HEBREW.expenseNew,
        { idempotent: true }
      );
      if (result.queued) {
        setExpenseOpen(false);
        resetExpenseForm();
        return;
      }
      if (!result.ok) {
        setExpenseError(toHebrewError(result.error, HEBREW.expenseCreateFailed));
        return;
      }
      const json = result.data as { expense?: Row };
      if (!json.expense) {
        setExpenseError(HEBREW.expenseCreateFailed);
        return;
      }

      const expenseId = getString(json.expense, "id");
      for (const file of expenseAttachmentFiles) {
        if (!expenseId) break;
        await uploadFinancialAttachment("expense", expenseId, file);
      }

      setExpenseOpen(false);
      resetExpenseForm();
      router.refresh();
      toast.success(HEBREW.expenseSaved);
    } catch (error: unknown) {
      setExpenseError(toHebrewError(error, HEBREW.saveErrorUnknown));
    } finally {
      setExpenseSubmitting(false);
    }
  }

  async function createExpenseWorker() {
    setExpenseNewWorkerError(null);

    const fullName = expenseNewWorkerName.trim();
    const phone = expenseNewWorkerPhone.trim();
    if (!fullName || !phone) {
      setExpenseNewWorkerError("יש למלא שם וטלפון לעובד החדש.");
      return;
    }

    setExpenseNewWorkerSubmitting(true);
    try {
      const res = await fetch("/api/users/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          email: null,
          phone,
          password: "",
          role: "worker_no_access",
          system_access: false,
          pay_tracking_mode: "session",
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        user?: { id?: string; full_name?: string | null; email?: string | null; role?: UserRole };
      };
      const createdUser = json.user;
      if (!res.ok || !createdUser?.id) {
        setExpenseNewWorkerError(toHebrewError(json.error, "שגיאה ביצירת עובד."));
        return;
      }

      const label = createdUser.full_name?.trim() || createdUser.email?.trim() || "עובד חדש";
      setAvailableUsers((current) => {
        const nextUser: UserOption = {
          id: createdUser.id ?? "",
          label,
          role: createdUser.role ?? "worker_no_access",
        };
        const withoutDuplicate = current.filter((user) => user.id !== nextUser.id);
        return [nextUser, ...withoutDuplicate];
      });
      setExpenseWorkerUserId(createdUser.id);
      setExpenseNewWorkerOpen(false);
      setExpenseNewWorkerName("");
      setExpenseNewWorkerPhone("");
      toast.success("העובד נוסף ונבחר להוצאה.");
    } catch (error: unknown) {
      setExpenseNewWorkerError(toHebrewError(error, "שגיאה ביצירת עובד."));
    } finally {
      setExpenseNewWorkerSubmitting(false);
    }
  }

  async function createIncome() {
    setIncomeError(null);
    const linkedProjectId = incomeBusinessDomain === "logistics_projects" ? incomeProjectId : "";
    const linkedOrderId = incomeBusinessDomain === "sales" ? incomeOrderId : "";
    const linkedPropertyId = incomeBusinessDomain === "property_management" ? incomePropertyId : "";

    const validationError = validateIncomeForm({
      incomeBusinessDomain,
      linkedProjectId,
      linkedPropertyId,
      incomeDate,
      incomeMethod,
      incomeDueDate,
      incomeAmount,
      accountsCount: accountsList.length,
      incomeAccountId,
    });
    if (validationError) {
      setIncomeError(validationError);
      return;
    }
    const amount = Number(incomeAmount);

    setIncomeSubmitting(true);
    try {
      const result = await offlineFetch(
        "/api/payments/create",
        buildIncomePayload({
          incomeBusinessDomain,
          linkedProjectId,
          linkedOrderId,
          linkedPropertyId,
          projectType: projectById.get(linkedProjectId)?.type ?? null,
          amount,
          incomeDate,
          incomeDueDate,
          incomeRequiresSplit,
          incomeMethod,
          incomeAccountId,
          incomeReference,
          incomeCheckNumber,
          incomeNotes,
          incomeTagIds,
        }),
        HEBREW.incomeNew,
        { idempotent: true }
      );
      if (result.queued) {
        setIncomeOpen(false);
        resetIncomeForm();
        return;
      }
      if (!result.ok) {
        setIncomeError(toHebrewError(result.error, HEBREW.incomeCreateFailed));
        return;
      }
      const json = result.data as { payment?: Row };
      if (!json.payment) {
        setIncomeError(HEBREW.incomeCreateFailed);
        return;
      }

      const paymentId = getString(json.payment, "id");
      for (const file of incomeAttachmentFiles) {
        if (!paymentId) break;
        await uploadFinancialAttachment("payment", paymentId, file);
      }
      if (incomeMethod === "check" && paymentId && incomeCheckPhotoFiles.length > 0) {
        for (const file of incomeCheckPhotoFiles) {
          await uploadFinancialAttachment("payment", paymentId, file);
        }
      }

      setIncomeOpen(false);
      resetIncomeForm();
      router.refresh();
      toast.success(HEBREW.incomeSaved);
    } catch (error: unknown) {
      setIncomeError(toHebrewError(error, HEBREW.saveErrorUnknown));
    } finally {
      setIncomeSubmitting(false);
    }
  }

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
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setWeekOverviewOpen(true)}
        >
          <FolderKanban className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.thisWeek}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => {
            emitNavigationStart();
            router.push("/sales?tab=deliveries");
          }}
        >
          <ShoppingCart className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.ordersByCity}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setProjectOpen(true)}
        >
          <FolderKanban className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.projectNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => {
            setOrderActionLocked(false);
            setOrderOpen(true);
          }}
        >
          <ShoppingCart className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.orderNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setExpenseOpen(true)}
        >
          <ArrowUpCircle className="!h-9 !w-9 text-destructive" strokeWidth={2.4} />
          <span className="font-semibold">{HEBREW.expenseNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setIncomeOpen(true)}
        >
          <ArrowDownCircle className="!h-9 !w-9 text-success" strokeWidth={2.4} />
          <span className="font-semibold">{HEBREW.incomeNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setCreateCustomerOpen(true)}
        >
          <UserPlus className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">לקוח חדש</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setTaskOpen(true)}
        >
          <ListTodo className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.taskNew}</span>
        </Button>

        {canStartOwnSession ? (
          <Button
            type="button"
            variant="outline"
            className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
            onClick={() => void startOwnSession()}
            disabled={Boolean(currentOpenSession) || selfSessionSubmitting}
          >
            <PlayCircle className="!h-9 !w-9" strokeWidth={2.2} />
            <span className="font-semibold">{HEBREW.selfSessionStart}</span>
          </Button>
        ) : null}

        {canManageWorkerSessions ? (
          <Button
            type="button"
            variant="outline"
            className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
            onClick={() => setManualSessionOpen(true)}
          >
            <Clock3 className="!h-9 !w-9" strokeWidth={2.2} />
            <span className="font-semibold">{HEBREW.manualSessionNew}</span>
          </Button>
        ) : null}

        {canManageWorkerSessions ? (
          <Button
            type="button"
            variant="outline"
            className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
            onClick={() => {
              resetWorkerPaymentForm();
              setWorkerPaymentOpen(true);
            }}
          >
            <Banknote className="!h-9 !w-9" strokeWidth={2.2} />
            <span className="font-semibold">תשלום לעובד</span>
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
        users={users}
        projects={projectPickerOptions}
        properties={properties.map((property) => ({
          id: property.id,
          label: property.subtitle ? `${property.name} | ${property.subtitle}` : property.name,
        }))}
        onSaved={() => router.refresh()}
      />

      <Dialog
        open={expenseOpen}
        onOpenChange={(open) => {
          if (!open && expenseSubmitting) return;
          setExpenseOpen(open);
          if (!open) resetExpenseForm();
        }}
      >
        <AdaptiveDialog size="formXl">
          <DialogHeader>
            <DialogTitle>{HEBREW.expenseNew}</DialogTitle>
            <DialogDescription>{HEBREW.expenseDialogDescription}</DialogDescription>
          </DialogHeader>

          <fieldset disabled={expenseSubmitting} className="contents">
            <div className="space-y-4">
              {/* תחום + קטגוריה — always paired in one row */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2 text-sm block">
                  <span>{HEBREW.domain} *</span>
                  <DomainSelect
                    value={expenseBusinessDomain}
                    onChange={(next) => {
                      const nextDomain = next as ExpenseBusinessDomain | "";
                      setExpenseBusinessDomain(nextDomain);
                      if (nextDomain !== "logistics_projects") {
                        setExpenseProjectId("");
                        setExpenseBilledToCustomer(false);
                        setExpenseBillToCustomerAmount("");
                      }
                      if (nextDomain !== "sales") setExpenseOrderId("");
                      if (nextDomain !== "property_management") setExpensePropertyId("");
                    }}
                  />
                </label>

                {expenseBusinessDomain ? (
                  <label className="space-y-2 text-sm block">
                    <span>{HEBREW.category} *</span>
                    <select
                      className={fieldClass}
                      value={expenseCategory}
                      onChange={(e) => {
                        setExpenseCategory(e.target.value);
                        if (e.target.value !== CARS_EXPENSE_CATEGORY) setExpenseTagIds([]);
                      }}
                    >
                      <option value="" />
                      {DASHBOARD_EXPENSE_CATEGORY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              {/* מקור (פרויקט/הזמנה/נכס) + עובד */}
              {expenseBusinessDomain === "logistics_projects" ||
              (expenseBusinessDomain === "sales" && !expenseIsWorkerPayment) ||
              expenseBusinessDomain === "property_management" ||
              (expenseIsWorkerPayment && canManageWorkerSessions) ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {expenseBusinessDomain === "logistics_projects" ? (
                    <div className="space-y-2 text-sm">
                      <span>{HEBREW.project} *</span>
                      <ProjectPicker
                        projects={projectPickerOptions}
                        value={expenseProjectId}
                        onChange={setExpenseProjectId}
                        allowClear={false}
                        placeholder=""
                      />
                    </div>
                  ) : null}

                  {expenseBusinessDomain === "sales" && !expenseIsWorkerPayment ? (
                    <label className="space-y-2 text-sm block">
                      <span>הזמנה</span>
                      <select
                        className={fieldClass}
                        value={expenseOrderId}
                        onChange={(e) => setExpenseOrderId(e.target.value)}
                      >
                        <option value="">ללא הזמנה</option>
                        {orders.map((order) => (
                          <option key={order.id} value={order.id}>
                            {order.name}
                            {order.subtitle ? ` | ${order.subtitle}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {expenseBusinessDomain === "property_management" ? (
                    <label className="space-y-2 text-sm block">
                      <span>נכס *</span>
                      <select
                        className={fieldClass}
                        value={expensePropertyId}
                        onChange={(e) => setExpensePropertyId(e.target.value)}
                      >
                        <option value="">בחרו נכס</option>
                        {properties.map((property) => (
                          <option key={property.id} value={property.id}>
                            {property.name}
                            {property.subtitle ? ` | ${property.subtitle}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {expenseIsWorkerPayment && canManageWorkerSessions ? (
                    <label className="space-y-2 text-sm block">
                      <span>{HEBREW.worker} *</span>
                      <select
                        className={fieldClass}
                        value={expenseWorkerUserId}
                        onChange={(e) => setExpenseWorkerUserId(e.target.value)}
                      >
                        <option value="" />
                        {workerUsers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : null}

              {expenseCategory === OTHER_EXPENSE_CATEGORY ? (
                <label className="space-y-2 text-sm block">
                  <span>{HEBREW.otherCategoryPrompt} *</span>
                  <Input
                    value={expenseCategoryOther}
                    onChange={(e) => setExpenseCategoryOther(e.target.value)}
                  />
                </label>
              ) : null}

              {expenseCategory === CARS_EXPENSE_CATEGORY ? (
                <TagPicker value={expenseTagIds} onChange={setExpenseTagIds} />
              ) : null}

              {expenseIsWorkerPayment && canManageWorkerSessions ? (
                <div className="space-y-3">
                  {!expenseNewWorkerOpen ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setExpenseNewWorkerOpen(true)}>
                      עובד חדש
                    </Button>
                  ) : (
                    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
                      <div className="text-sm font-medium">הוספת עובד חדש</div>
                      <Input
                        value={expenseNewWorkerName}
                        onChange={(e) => setExpenseNewWorkerName(e.target.value)}
                        placeholder="שם עובד"
                      />
                      <Input
                        value={expenseNewWorkerPhone}
                        onChange={(e) => setExpenseNewWorkerPhone(e.target.value)}
                        placeholder="טלפון עובד"
                      />
                      <div className="text-xs text-muted-foreground">
                        עובד חדש ייווצר כרשומת עובד בלבד, בלי גישה למערכת.
                      </div>
                      {expenseNewWorkerError ? (
                        <div className="text-sm text-destructive">{expenseNewWorkerError}</div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void createExpenseWorker()}
                          disabled={
                            expenseNewWorkerSubmitting ||
                            !expenseNewWorkerName.trim() ||
                            !expenseNewWorkerPhone.trim()
                          }
                        >
                          {expenseNewWorkerSubmitting ? "שומר..." : "הוסף עובד"}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={expenseNewWorkerSubmitting}
                          onClick={() => {
                            setExpenseNewWorkerOpen(false);
                            setExpenseNewWorkerError(null);
                            setExpenseNewWorkerName("");
                            setExpenseNewWorkerPhone("");
                          }}
                        >
                          ביטול
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {expenseIsWorkerPayment ? (
                <>
                  {showExpenseSessionTimingFields ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="space-y-2 text-sm">
                        <span>כניסה *</span>
                        <DateTimeInput
                          value={expenseClockIn}
                          onChange={(e) => setExpenseClockIn(e.target.value)}
                        />
                      </label>

                      <label className="space-y-2 text-sm">
                        <span>סה״כ שעות</span>
                        <Input
                          inputMode="decimal"
                          value={expenseDuration}
                          onChange={(e) => {
                            const nextValue = e.target.value;
                            if (!nextValue.trim()) {
                              setExpenseClockOut("");
                              return;
                            }
                            const parsedHours = Number(nextValue);
                            const clockInIso = toIso(expenseClockIn);
                            if (!Number.isFinite(parsedHours) || parsedHours <= 0 || !clockInIso) return;
                            const nextClockOut = new Date(new Date(clockInIso).getTime() + parsedHours * 60 * 60 * 1000);
                            if (Number.isNaN(nextClockOut.getTime())) return;
                            const pad = (n: number) => String(n).padStart(2, "0");
                            setExpenseClockOut(
                              `${nextClockOut.getFullYear()}-${pad(nextClockOut.getMonth() + 1)}-${pad(nextClockOut.getDate())}T${pad(nextClockOut.getHours())}:${pad(nextClockOut.getMinutes())}`
                            );
                          }}
                          placeholder="למשל 8"
                        />
                      </label>

                      <label className="space-y-2 text-sm">
                        <span>יציאה *</span>
                        <DateTimeInput
                          value={expenseClockOut}
                          onChange={(e) => setExpenseClockOut(e.target.value)}
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="space-y-2 text-sm block">
                      <span>תאריך *</span>
                      <DateInput
                        value={expenseSessionDateOnly}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (!next) return;
                          setExpenseClockIn(`${next}T09:00`);
                          setExpenseClockOut(`${next}T10:00`);
                        }}
                      />
                    </label>
                  )}

                  {showExpenseSessionPriceField ? (
                    <label className="space-y-2 text-sm block">
                      <span>עלות עבודה{expenseSessionPriceRequired ? " *" : ""}</span>
                      <CurrencyInput
                        value={expenseLaborCost}
                        onChange={(e) => setExpenseLaborCost(e.target.value)}
                      />
                      <span className="block text-xs text-muted-foreground">
                        {suggestedExpenseWorkerAmount !== null
                          ? `סה״כ לתשלום עבור המשמרת: ${formatIls(suggestedExpenseWorkerAmount)}`
                          : "הסכום שמגיע לעובד יוצג כאן אחרי הזנת שעות תקינות או עלות עבודה."}
                      </span>
                    </label>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {suggestedExpenseWorkerAmount !== null
                        ? `סה״כ לתשלום עבור המשמרת (חישוב אוטומטי): ${formatIls(suggestedExpenseWorkerAmount)}`
                        : "העלות תחושב אוטומטית לפי הסכם השכר לאחר שמירה."}
                    </div>
                  )}

                  {expenseBusinessDomain === "logistics_projects" ? (
                    <section className="space-y-3 rounded-xl border bg-muted/30 p-4">
                      <h4 className="text-sm font-semibold">חיוב הלקוח</h4>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={expenseBilledToCustomer}
                          onChange={(e) => {
                            setExpenseBilledToCustomer(e.target.checked);
                            if (!e.target.checked) setExpenseBillToCustomerAmount("");
                          }}
                        />
                        <span>{HEBREW.billedToCustomer}</span>
                      </label>
                      {expenseBilledToCustomer ? (
                        <label className="space-y-2 text-sm block">
                          <span>סכום לחיוב לקוח</span>
                          <CurrencyInput
                            value={expenseBillToCustomerAmount}
                            onChange={(e) => setExpenseBillToCustomerAmount(e.target.value)}
                            placeholder="למשל 650"
                          />
                        </label>
                      ) : null}
                    </section>
                  ) : null}

                  {canManageWorkerSessions ? (
                    <section className="space-y-3 rounded-xl border bg-muted/30 p-4">
                      <h4 className="text-sm font-semibold">תשלום לעובד</h4>
                      <label className="space-y-2 text-sm block">
                        <span>סטטוס תשלום לעובד</span>
                        <select
                          className={fieldClass}
                          value={expenseWorkerPaymentChoice}
                          onChange={(e) => setExpenseWorkerPaymentChoice(e.target.value as PaymentChoice)}
                        >
                          <option value="none">לא שולם</option>
                          <option value="paid">שולם במלואו</option>
                          <option value="partial">שולם חלקית</option>
                        </select>
                      </label>
                      {expenseWorkerPaymentChoice !== "none" ? (
                        <>
                          <label className="space-y-2 text-sm block">
                            <span>כמה שולם</span>
                            <CurrencyInput
                              value={expenseWorkerPaidAmount}
                              onChange={(e) => setExpenseWorkerPaidAmount(e.target.value)}
                              placeholder="אם ריק, יירשם מלוא סכום המשמרת"
                            />
                          </label>
                          <AccountSelect
                            required
                            value={expenseWorkerAccountId}
                            onChange={setExpenseWorkerAccountId}
                            onLoaded={setAccountsList}
                          />
                        </>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : expenseBusinessDomain ? (
                <>
                  <AdaptiveGrid variant="formTwoLoose">
                    <label className="space-y-2 text-sm">
                      <span>{HEBREW.amount} *</span>
                      <CurrencyInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={expenseAmount}
                        onChange={(e) => setExpenseAmount(e.target.value)}
                      />
                    </label>

                    <label className="space-y-2 text-sm">
                      <span>סטטוס תשלום *</span>
                      <select
                        className={fieldClass}
                        value={expensePaymentStatus}
                        onChange={(e) => setExpensePaymentStatus(e.target.value as "paid" | "partial" | "not_paid")}
                      >
                        <option value="not_paid">לא שולם</option>
                        <option value="partial">חלקי</option>
                        <option value="paid">שולם</option>
                      </select>
                    </label>
                  </AdaptiveGrid>

                  {expensePaymentStatus === "paid" || expensePaymentStatus === "partial" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-2 text-sm">
                        <span>{HEBREW.paymentMethod} *</span>
                        <select
                          className={fieldClass}
                          value={expensePaymentMethod}
                          onChange={(e) => {
                            const m = e.target.value;
                            setExpensePaymentMethod(m);
                            setExpenseAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
                          }}
                        >
                          <option value=""></option>
                          {PAYMENT_METHOD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <AccountSelect
                        required
                        value={expenseAccountId}
                        onChange={setExpenseAccountId}
                        onLoaded={(list) => {
                          setAccountsList(list);
                          setExpenseAccountId((prev) => prev || defaultAccountForMethod(list, expensePaymentMethod));
                        }}
                      />
                    </div>
                  ) : null}

                  <label className="space-y-2 text-sm">
                    <span>{HEBREW.date} *</span>
                    <DateInput
                      value={expenseDate}
                      onChange={(e) => setExpenseDate(e.target.value)}
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span>{HEBREW.description}</span>
                    <Input
                      value={expenseDescription}
                      onChange={(e) => setExpenseDescription(e.target.value)}
                    />
                  </label>

                  {expenseBusinessDomain === "logistics_projects" ? (
                    <section className="space-y-3 rounded-xl border bg-muted/30 p-4">
                      <h4 className="text-sm font-semibold">חיוב הלקוח</h4>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={expenseBilledToCustomer}
                          onChange={(e) => {
                            setExpenseBilledToCustomer(e.target.checked);
                            if (!e.target.checked) setExpenseBillToCustomerAmount("");
                          }}
                        />
                        <span>{HEBREW.billedToCustomer}</span>
                      </label>
                      <div className="text-xs text-muted-foreground">
                        {expenseBilledToCustomer
                          ? "ההוצאה תופיע ברשימת חיובי הלקוח ולא בתזרים."
                          : "אם לא מסומן, ההוצאה נכללת בבסיס כברירת מחדל."}
                      </div>
                      {expenseBilledToCustomer ? (
                        <div className="space-y-1">
                          <span className="block text-sm font-medium">סכום לחיוב לקוח *</span>
                          <CurrencyInput
                            inputMode="numeric"
                            value={expenseBillToCustomerAmount}
                            onChange={(e) => setExpenseBillToCustomerAmount(e.target.value)}
                            placeholder="למשל 650"
                          />
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : null}

              {expenseBusinessDomain ? (
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.notes}</span>
                  <Textarea value={expenseNotes} onChange={(e) => setExpenseNotes(e.target.value)} />
                </label>
              ) : null}

              {expenseBusinessDomain ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">קבצים מצורפים (אופציונלי)</div>
                  <div className="flex items-center gap-2">
                    <FileUploadActions
                      files={expenseAttachmentFiles}
                      multiple
                      onFilesSelected={setExpenseAttachmentFiles}
                      chooseLabel={expenseAttachmentFiles.length > 0 || expenseExistingAttachments.length > 0 ? "הוסף קבצים" : "העלה קבצים"}
                      chooseVariant="outline"
                      size="sm"
                    />
                    {expenseAttachmentFiles.length > 0 ? (
                      <Button type="button" variant="secondary" size="sm" onClick={() => setExpenseAttachmentFiles([])}>
                        נקה בחירה
                      </Button>
                    ) : null}
                  </div>
                  {expenseExistingAttachments.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">קבצים קיימים</div>
                      <div className="flex flex-wrap gap-2">
                        {expenseExistingAttachments.map((attachment) => (
                          <a
                            key={attachment.document_id}
                            href={attachment.url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent"
                          >
                            {attachment.file_name ?? "קובץ"}
                          </a>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {expenseExistingAttachments
                          .filter((attachment) => attachment.url && isImageAttachment(attachment))
                          .map((attachment) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={`${attachment.document_id}-preview`}
                              src={attachment.url ?? ""}
                              alt={attachment.file_name ?? "קובץ"}
                              className="h-20 w-20 rounded-lg border object-cover"
                            />
                          ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </fieldset>

          {expenseError ? <p className="text-sm text-destructive">{expenseError}</p> : null}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setExpenseOpen(false)} disabled={expenseSubmitting}>
              {HEBREW.cancel}
            </Button>
            <Button type="button" onClick={() => void createExpense()} disabled={expenseSubmitting}>
              {expenseSubmitting ? HEBREW.saving : HEBREW.saveExpense}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={incomeOpen}
        onOpenChange={(open) => {
          if (!open && incomeSubmitting) return;
          setIncomeOpen(open);
          if (!open) resetIncomeForm();
        }}
      >
        <AdaptiveDialog size="formXl">
          <DialogHeader>
            <DialogTitle>{HEBREW.incomeNew}</DialogTitle>
            <DialogDescription>{HEBREW.incomeDialogDescription}</DialogDescription>
          </DialogHeader>

          <fieldset disabled={incomeSubmitting} className="contents">
            <div className="grid gap-4">
              <label className="space-y-2 text-sm">
                <span>{HEBREW.domain} *</span>
                <DomainSelect
                  value={incomeBusinessDomain}
                  onChange={(next) => {
                    const nextDomain = next as ExpenseBusinessDomain | "";
                    setIncomeBusinessDomain(nextDomain);
                    if (nextDomain !== "logistics_projects") {
                      setIncomeProjectId("");
                      setIncomeProjectQuery("");
                    }
                    if (nextDomain !== "sales") setIncomeOrderId("");
                    if (nextDomain !== "property_management") setIncomePropertyId("");
                    if (nextDomain !== "general_business") setIncomeTagIds([]);
                  }}
                />
              </label>

              {incomeBusinessDomain === "logistics_projects" ? (
                <div className="space-y-2 text-sm">
                  <span>{HEBREW.project} *</span>
                  <Input
                    value={incomeProjectQuery}
                    onChange={(e) => setIncomeProjectQuery(e.target.value)}
                    placeholder="חיפוש..."
                  />
                  <div className="max-h-56 space-y-1 overflow-auto rounded-md border p-1">
                    {filteredIncomeProjects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => {
                          setIncomeProjectId(project.id);
                          setIncomeProjectQuery(project.name);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-right text-sm transition-all duration-200 ${
                          project.id === incomeProjectId
                            ? "border-primary/20 bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                            : "border-border bg-accent/40 text-accent-foreground hover:bg-accent"
                        }`}
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium">{project.name}</span>
                          {project.customerName ? (
                            <span
                              className={`text-xs ${
                                project.id === incomeProjectId
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              }`}
                            >
                              · {project.customerName}
                            </span>
                          ) : null}
                          {normalizeDateOnly(project.startDate) ? (
                            <span
                              className={`text-xs ${
                                project.id === incomeProjectId
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              }`}
                            >
                              · {normalizeDateOnly(project.startDate)}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    ))}
                    {filteredIncomeProjects.length === 0 ? (
                      <div className="p-2 text-sm text-muted-foreground">לא נמצאו פרויקטים לחיפוש הזה.</div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {incomeBusinessDomain === "sales" ? (
                <label className="space-y-2 text-sm">
                  <span>הזמנה</span>
                  <select
                    className={fieldClass}
                    value={incomeOrderId}
                    onChange={(e) => setIncomeOrderId(e.target.value)}
                  >
                    <option value="">ללא הזמנה</option>
                    {orders.map((order) => (
                      <option key={order.id} value={order.id}>
                        {order.name}
                        {order.subtitle ? ` | ${order.subtitle}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {incomeBusinessDomain === "property_management" ? (
                <label className="space-y-2 text-sm">
                  <span>נכס *</span>
                  <select
                    className={fieldClass}
                    value={incomePropertyId}
                    onChange={(e) => setIncomePropertyId(e.target.value)}
                  >
                    <option value="">בחרו נכס</option>
                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.name}
                        {property.subtitle ? ` | ${property.subtitle}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {incomeBusinessDomain ? (
                <>
                  <AdaptiveGrid variant="formTwoLoose">
                    <label className="space-y-2 text-sm">
                      <span>{HEBREW.amount} *</span>
                      <CurrencyInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={incomeAmount}
                        onChange={(e) => setIncomeAmount(e.target.value)}
                      />
                    </label>

                    <label className="space-y-2 text-sm">
                      <span>{HEBREW.paymentMethod} *</span>
                      <select
                        className={fieldClass}
                        value={incomeMethod}
                        onChange={(e) => {
                          const m = e.target.value;
                          setIncomeMethod(m);
                          setIncomeAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
                        }}
                      >
                        <option value=""></option>
                        <option value="bank_transfer">{HEBREW.bankTransfer}</option>
                        <option value="cash">{HEBREW.cash}</option>
                        <option value="check">{HEBREW.check}</option>
                        <option value="credit_card">{HEBREW.creditCard}</option>
                        <option value="other">{HEBREW.other}</option>
                      </select>
                      {incomeMethod === "check" ? (
                        <span className="block text-xs text-muted-foreground">
                          {"צ'ק יירשם כממתין לפירעון עד תאריך הפירעון."}
                        </span>
                      ) : null}
                    </label>
                    <AccountSelect
                      required
                      value={incomeAccountId}
                      onChange={setIncomeAccountId}
                      onLoaded={(list) => {
                        setAccountsList(list);
                        setIncomeAccountId((prev) => prev || defaultAccountForMethod(list, incomeMethod));
                      }}
                    />
                  </AdaptiveGrid>

                  <label className="space-y-2 text-sm">
                    <span>{HEBREW.date} *</span>
                    <DateInput
                      value={incomeDate}
                      onChange={(e) => setIncomeDate(e.target.value)}
                    />
                  </label>

                  {incomeMethod ? (
                    <AdaptiveGrid variant="formTwoLoose">
                      <label className="space-y-2 text-sm">
                        <span>
                          {incomeMethod === "check"
                            ? `${HEBREW.paymentDueDate} *`
                            : "תאריך פירעון צפוי (אופציונלי)"}
                        </span>
                        <DateInput
                          value={incomeDueDate}
                          onChange={(e) => setIncomeDueDate(e.target.value)}
                        />
                        {incomeMethod !== "check" ? (
                          <span className="block text-[11px] text-muted-foreground">
                            לתשלומים עתידיים (למשל שוטף+30) — נרשמים כממתינים עד התאריך הזה.
                          </span>
                        ) : null}
                      </label>

                      <label className="space-y-2 text-sm">
                        <span>{HEBREW.reference}</span>
                        <Input
                          value={incomeReference}
                          onChange={(e) => setIncomeReference(e.target.value)}
                        />
                      </label>
                    </AdaptiveGrid>
                  ) : null}

                  {incomeMethod === "check" ? (
                    <CheckDetailsFields
                      checkNumber={incomeCheckNumber}
                      onCheckNumberChange={setIncomeCheckNumber}
                      photoFiles={incomeCheckPhotoFiles}
                      onPhotoFilesChange={setIncomeCheckPhotoFiles}
                      disabled={incomeSubmitting}
                    />
                  ) : null}

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={incomeRequiresSplit}
                      onChange={(e) => setIncomeRequiresSplit(e.target.checked)}
                    />
                    <span>{HEBREW.includesVat}</span>
                  </label>

                  <label className="space-y-2 text-sm">
                    <span>{HEBREW.notes}</span>
                    <Textarea value={incomeNotes} onChange={(e) => setIncomeNotes(e.target.value)} />
                  </label>

                  {incomeBusinessDomain === "general_business" ? (
                    <TagPicker value={incomeTagIds} onChange={setIncomeTagIds} />
                  ) : null}

                  <div className="space-y-2">
                    <div className="text-sm font-medium">קבצים מצורפים (אופציונלי)</div>
                    <div className="flex items-center gap-2">
                      <FileUploadActions
                        files={incomeAttachmentFiles}
                        multiple
                        onFilesSelected={setIncomeAttachmentFiles}
                        chooseLabel={incomeAttachmentFiles.length > 0 || incomeExistingAttachments.length > 0 ? "הוסף קבצים" : "העלה קבצים"}
                        chooseVariant="outline"
                        size="sm"
                      />
                      {incomeAttachmentFiles.length > 0 ? (
                        <Button type="button" variant="secondary" size="sm" onClick={() => setIncomeAttachmentFiles([])}>
                          נקה בחירה
                        </Button>
                      ) : null}
                    </div>
                    {incomeExistingAttachments.length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">קבצים קיימים</div>
                        <div className="flex flex-wrap gap-2">
                          {incomeExistingAttachments.map((attachment) => (
                            <a
                              key={attachment.document_id}
                              href={attachment.url ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent"
                            >
                              {attachment.file_name ?? "קובץ"}
                            </a>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {incomeExistingAttachments
                            .filter((attachment) => attachment.url && isImageAttachment(attachment))
                            .map((attachment) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={`${attachment.document_id}-preview`}
                                src={attachment.url ?? ""}
                                alt={attachment.file_name ?? "קובץ"}
                                className="h-20 w-20 rounded-lg border object-cover"
                              />
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </fieldset>

          {incomeError ? <p className="text-sm text-destructive">{incomeError}</p> : null}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setIncomeOpen(false)} disabled={incomeSubmitting}>
              {HEBREW.cancel}
            </Button>
            <Button type="button" onClick={() => void createIncome()} disabled={incomeSubmitting}>
              {incomeSubmitting ? HEBREW.saving : HEBREW.saveIncome}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>
    </>
  );
}

