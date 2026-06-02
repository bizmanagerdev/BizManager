"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AlertTriangle, LockKeyhole, Pencil, Plus, Trash2 } from "lucide-react";
import SalaryProtected from "@/components/payroll/SalaryProtected";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { UserRole } from "@/lib/auth/requireProfile";
import { shouldIgnoreRowNavigation } from "@/lib/ui/row-navigation";
import { EXPENSE_BUSINESS_DOMAINS, getBusinessDomainLabel, isExpenseBusinessDomain, type ExpenseBusinessDomain } from "@/lib/expenses";
import {
  getPayrollWorkerTypeLabel,
  normalizePayrollWorkerType,
  payrollWorkerTypeAllowsSessions,
  payrollWorkerTypeRequiresAgreement,
  shouldShowSessionHours,
  shouldShowSessionPrice,
  type PayrollWorkerType,
} from "@/lib/payroll-worker-type";
import { getPaymentStatusLabel as getSharedPaymentStatusLabel } from "@/lib/ui/status-colors";
import {
  getActiveSalaryAgreementForDate,
  calculateSessionLaborCost,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMinutes,
  getCurrentSalaryAgreement,
  getSalaryTypeLabel,
  monthKeyFromDate,
  monthLabelFromKey,
  sessionWorkedMinutes,
  toNumber,
  type PayrollPeriodRow,
  type PayslipRow,
  type SalaryAgreementRow,
} from "@/lib/payroll";
import {
  getCurrentMonthKey,
  getCurrentPayrollPeriod,
  getLatestHourlyOverride,
  isSalaryTrackedWorker,
  getSessionLinkLabel,
  getWorkerAccessLabel,
  isPayrollPeriodEditable,
  normalizePayrollStatus,
  type SalaryCenterProjectOption,
  type SalaryCenterProtectedPayload,
  type SalaryCenterUserRow,
  type SessionPublicRow,
  type WorkerPaymentAllocationRow,
  type WorkerDebtItemRow,
  type WorkerPaymentRow,
} from "@/lib/payroll-center";
import { toHebrewError } from "@/lib/error-messages";

type Props = {
  viewerRole: UserRole;
  publicUsers: SalaryCenterUserRow[];
  publicSessions: SessionPublicRow[];
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
  publicPeriods: PayrollPeriodRow[];
  initiallyUnlocked: boolean;
  hasPasswordConfigured: boolean;
  defaultWorkerId?: string;
  /**
   * "list" (default): renders the full payroll center — top tabs, worker
   * tables, and a worker-detail dialog that opens when a row is selected.
   * "worker-detail": renders only the worker-detail view inline (no top tabs,
   * no worker tables, no dialog wrapper) for the `defaultWorkerId` worker.
   * Used by /payroll/workers/[id].
   */
  mode?: "list" | "worker-detail";
};

type SessionFormState = {
  session_id: string;
  user_id: string;
  business_domain: string;
  project_id: string;
  property_id: string;
  notes: string;
  clock_in: string;
  clock_out: string;
  labor_cost: string;
  original_user_id: string;
  original_clock_in: string;
  original_clock_out: string;
  original_labor_cost: string;
  is_billable_to_customer: boolean;
  bill_to_customer_amount: string;
  billing_status: string;
  mark_paid_now: boolean;
  paid_amount_now: string;
};

type WorkerFormState = {
  full_name: string;
  email: string;
  phone: string;
  role: "admin" | "office" | "worker" | "worker_no_access";
  active: boolean;
  system_access: boolean;
  payroll_worker_type: PayrollWorkerType;
};

type CreateUserFormState = {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  role: "admin" | "office" | "worker" | "worker_no_access";
  active: boolean;
  system_access: boolean;
  payroll_worker_type: PayrollWorkerType;
};

type AgreementFormState = {
  agreement_id: string;
  user_id: string;
  salary_type: "hourly" | "monthly";
  hourly_rate: string;
  monthly_salary: string;
  overtime_rate: string;
  standard_daily_hours: string;
  due_day_of_next_month: string;
  valid_from: string;
  notes: string;
};

type OverrideFormState = {
  override_hourly_rate: string;
  start_time: string;
  end_time: string;
  reason: string;
  notes: string;
};

type PayslipItemFormState = {
  payslip_id: string;
  item_type: string;
  amount: string;
  notes: string;
};

type WorkerPaymentAllocationFormState = {
  source_type: "session" | "payslip";
  source_id: string;
  amount: string;
  max_amount: number;
  title: string;
  subtitle: string;
};

type WorkerPaymentFormState = {
  payment_id: string;
  user_id: string;
  payment_date: string;
  amount: string;
  payment_method: string;
  reference_number: string;
  notes: string;
  allocations: WorkerPaymentAllocationFormState[];
};

type SplitPartDraft = {
  id: string;
  minutes: string;
  domain: ExpenseBusinessDomain;
  projectId: string;
  propertyId: string;
};

type PendingSalaryDeletion =
  | { kind: "session"; sessionId: string; workerLabel: string }
  | { kind: "worker"; userId: string; workerLabel: string }
  | { kind: "agreement"; agreementId: string; userId: string; workerLabel: string }
  | { kind: "payment"; paymentId: string; userId: string; amountLabel: string };

type WorkerPrintFilters = {
  projectId: string;
  month: string;
  year: string;
};

const DEFAULT_SESSION_FORM: SessionFormState = {
  session_id: "",
  user_id: "",
  business_domain: "general_business",
  project_id: "",
  property_id: "",
  notes: "",
  clock_in: toDateTimeLocalValue(new Date(Date.now() - 60 * 60 * 1000)),
  clock_out: toDateTimeLocalValue(new Date()),
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
};

const DEFAULT_AGREEMENT_FORM: AgreementFormState = {
  agreement_id: "",
  user_id: "",
  salary_type: "hourly",
  hourly_rate: "",
  monthly_salary: "",
  overtime_rate: "",
  standard_daily_hours: "0",
  due_day_of_next_month: "10",
  valid_from: new Date().toISOString().slice(0, 10),
  notes: "",
};

const DEFAULT_OVERRIDE_FORM: OverrideFormState = {
  override_hourly_rate: "",
  start_time: new Date().toISOString().slice(0, 10),
  end_time: "",
  reason: "",
  notes: "",
};

const DEFAULT_PAYSLIP_ITEM_FORM: PayslipItemFormState = {
  payslip_id: "",
  item_type: "bonus",
  amount: "",
  notes: "",
};

const PAYSLIP_ITEM_TYPES = [
  { value: "bonus", label: "בונוס" },
  { value: "overtime_extra", label: "תוספת שעות נוספות" },
  { value: "travel_allowance", label: "דמי נסיעה" },
  { value: "meal_allowance", label: "דמי אוכל" },
  { value: "advance", label: "מקדמה" },
  { value: "deduction", label: "ניכוי" },
  { value: "exception_absence", label: "היעדרות" },
  { value: "exception_partial_month", label: "חודש חלקי" },
  { value: "manual_adjustment", label: "התאמה ידנית" },
] as const;

function getPayslipItemTypeLabel(value: string | null | undefined) {
  return PAYSLIP_ITEM_TYPES.find((t) => t.value === value)?.label ?? value ?? "פריט";
}

function isExceptionItemType(value: string | null | undefined) {
  return value === "exception_absence" || value === "exception_partial_month";
}

const DEFAULT_CREATE_USER_FORM: CreateUserFormState = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
  role: "worker",
  active: true,
  system_access: true,
  payroll_worker_type: "session_only",
};

const DEFAULT_WORKER_PAYMENT_FORM: WorkerPaymentFormState = {
  payment_id: "",
  user_id: "",
  payment_date: new Date().toISOString().slice(0, 10),
  amount: "",
  payment_method: "",
  reference_number: "",
  notes: "",
  allocations: [],
};

const DEFAULT_WORKER_PRINT_FILTERS: WorkerPrintFilters = {
  projectId: "",
  // Empty = "all months / all years" (no filter applied).
  month: "",
  year: "",
};

function createSessionSplitPart(
  domain: ExpenseBusinessDomain,
  overrides?: Partial<Omit<SplitPartDraft, "id" | "domain">>
): SplitPartDraft {
  return {
    id: `split-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    minutes: overrides?.minutes ?? "",
    domain,
    projectId: overrides?.projectId ?? "",
    propertyId: overrides?.propertyId ?? "",
  };
}

const SOLID_EDIT_BUTTON_CLASS =
  "border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary/90 hover:text-primary-foreground";

export default function SalaryCenterClient({
  viewerRole,
  publicUsers,
  publicSessions,
  projectOptions,
  propertyOptions,
  publicPeriods,
  initiallyUnlocked,
  hasPasswordConfigured,
  defaultWorkerId,
  mode = "list",
}: Props) {
  const isWorkerDetailMode = mode === "worker-detail";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState("employees");
  const [search, setSearch] = useState("");
  const [attendanceFilters, setAttendanceFilters] = useState({
    workerId: "",
    businessDomain: "",
    projectId: "",
    status: "",
    dateFrom: "",
    dateTo: "",
  });
  const [selectedWorkerId, setSelectedWorkerId] = useState(defaultWorkerId ?? "");
  const [workerAccessDialogOpen, setWorkerAccessDialogOpen] = useState(false);
  const [agreementDialogOpen, setAgreementDialogOpen] = useState(false);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createUserForm, setCreateUserForm] = useState<CreateUserFormState>(DEFAULT_CREATE_USER_FORM);
  const [createUserError, setCreateUserError] = useState("");
  const [workerPrintFilters, setWorkerPrintFilters] = useState<WorkerPrintFilters>(DEFAULT_WORKER_PRINT_FILTERS);
  // Sessions tab has its own project filter (independent of print tab).
  const [sessionsProjectId, setSessionsProjectId] = useState("");
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionForm, setSessionForm] = useState<SessionFormState>(DEFAULT_SESSION_FORM);
  const [sessionSplitParts, setSessionSplitParts] = useState<SplitPartDraft[]>([]);
  const [sessionMode, setSessionMode] = useState<"create" | "edit">("create");
  const [workerPaymentDialogOpen, setWorkerPaymentDialogOpen] = useState(false);
  const [workerPaymentForm, setWorkerPaymentForm] = useState<WorkerPaymentFormState>(DEFAULT_WORKER_PAYMENT_FORM);
  const [workerPaymentError, setWorkerPaymentError] = useState("");
  const [pendingDeletion, setPendingDeletion] = useState<PendingSalaryDeletion | null>(null);
  const [locallyDeletedSessionIds, setLocallyDeletedSessionIds] = useState<string[]>([]);
  const [sessionError, setSessionError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [protectedData, setProtectedData] = useState<SalaryCenterProtectedPayload | null>(null);
  const [protectedError, setProtectedError] = useState("");
  const [, setLoadingProtected] = useState(false);
  const [salaryUnlocked, setSalaryUnlocked] = useState(initiallyUnlocked);
  const [workerForm, setWorkerForm] = useState<WorkerFormState>({
    full_name: "",
    email: "",
    phone: "",
    role: "worker",
    active: true,
    system_access: true,
    payroll_worker_type: "session_only",
  });
  const [agreementForm, setAgreementForm] = useState<AgreementFormState>(DEFAULT_AGREEMENT_FORM);
  const [overrideForm, setOverrideForm] = useState<OverrideFormState>(DEFAULT_OVERRIDE_FORM);
  const [periodMonth, setPeriodMonth] = useState(getCurrentMonthKey());
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [periodManagementDialogOpen, setPeriodManagementDialogOpen] = useState(false);
  const [selectedSummaryMonth, setSelectedSummaryMonth] = useState(getCurrentMonthKey());
  const [payslipItemForm, setPayslipItemForm] = useState<PayslipItemFormState>(DEFAULT_PAYSLIP_ITEM_FORM);
  const [payslipAdjustmentDrafts, setPayslipAdjustmentDrafts] = useState<Record<string, string>>({});

  const canManageSalary = viewerRole === "admin";
  const agreementStandardDailyHoursValid = toNumber(agreementForm.standard_daily_hours) > 0;
  const agreementDueDayValid =
    Number.isInteger(Number(agreementForm.due_day_of_next_month)) &&
    toNumber(agreementForm.due_day_of_next_month) >= 1 &&
    toNumber(agreementForm.due_day_of_next_month) <= 31;
  const allAgreementEligibleUsers = useMemo(
    () =>
      publicUsers.filter(
        (user) =>
          user.active !== false &&
          (user.role === "admin" ||
            user.role === "office" ||
            user.role === "worker" ||
            user.role === "worker_no_access")
      ),
    [publicUsers]
  );
  const canManageAttendance = viewerRole === "admin" || viewerRole === "office";
  const canCreateUsers = viewerRole === "admin";
  // Office may VIEW salaries of lower-status users (the protected endpoint scopes the
  // returned data to worker & worker_no_access). Managing salary stays admin-only.
  const canViewSalary = viewerRole === "admin" || viewerRole === "office";

  const loadProtectedData = useCallback(async () => {
    if (!canViewSalary) return;

    setLoadingProtected(true);
    setProtectedError("");
    try {
      const response = await fetch("/api/payroll/center/protected", { cache: "no-store" });
      const json = (await response.json().catch(() => ({}))) as SalaryCenterProtectedPayload & { error?: string };
      if (!response.ok) {
        setProtectedError(json.error ?? "Protected salary data could not be loaded.");
        setProtectedData(null);
        return;
      }
      setProtectedData(json);
      setSelectedPeriodId((current) => current || getCurrentPayrollPeriod(json.periods)?.id || "");
    } catch (loadError: unknown) {
      setProtectedError(loadError instanceof Error ? loadError.message : "Unknown error");
      setProtectedData(null);
    } finally {
      setLoadingProtected(false);
    }
  }, [canViewSalary]);

  useEffect(() => {
    if (initiallyUnlocked && canViewSalary) {
      void loadProtectedData();
    }
  }, [initiallyUnlocked, canViewSalary, loadProtectedData]);

  const currentMonthKey = getCurrentMonthKey();
  const usersById = useMemo(() => new Map(publicUsers.map((user) => [user.id, user])), [publicUsers]);
  const projectLabelsById = useMemo(() => new Map(projectOptions.map((option) => [option.id, option.label])), [projectOptions]);
  const propertyLabelsById = useMemo(() => new Map(propertyOptions.map((option) => [option.id, option.label])), [propertyOptions]);
  const protectedPeriods = protectedData?.periods ?? [];
  const periodsForUi = protectedPeriods.length > 0 ? protectedPeriods : publicPeriods;
  const periodsById = useMemo(() => new Map(periodsForUi.map((period) => [period.id, period])), [periodsForUi]);
  const selectedPayslipPeriod = selectedPeriodId ? periodsById.get(selectedPeriodId) ?? null : null;
  const selectedPeriodForExport =
    selectedPayslipPeriod ??
    getCurrentPayrollPeriod(periodsForUi);
  const selectedSalariedExportHref = `/api/payroll/salaried-hours-export?period_month=${encodeURIComponent(
    selectedPeriodForExport?.period_month ?? currentMonthKey
  )}`;
  const agreements = useMemo(() => protectedData?.agreements ?? [], [protectedData]);
  const payslips = useMemo(() => protectedData?.payslips ?? [], [protectedData]);
  const payslipItems = useMemo(() => protectedData?.payslipItems ?? [], [protectedData]);
  const visibleSessions = useMemo(
    () => publicSessions.filter((session) => !locallyDeletedSessionIds.includes(session.id)),
    [locallyDeletedSessionIds, publicSessions]
  );
  const selectedSummaryMonthOptions = useMemo(() => {
    const months = new Set<string>();
    months.add(currentMonthKey);
    periodsForUi.forEach((period) => {
      if (period.period_month) months.add(period.period_month);
    });
    visibleSessions.forEach((session) => {
      if (session.clock_in) months.add(monthKeyFromDate(session.clock_in));
    });
    payslips.forEach((payslip) => {
      const periodMonth = periodsById.get(payslip.payroll_period_id)?.period_month;
      if (periodMonth) months.add(periodMonth);
    });
    return [...months].sort((a, b) => b.localeCompare(a));
  }, [currentMonthKey, periodsById, periodsForUi, payslips, visibleSessions]);
  useEffect(() => {
    if (selectedSummaryMonthOptions.includes(selectedSummaryMonth)) return;
    setSelectedSummaryMonth(selectedSummaryMonthOptions[0] ?? currentMonthKey);
  }, [currentMonthKey, selectedSummaryMonth, selectedSummaryMonthOptions]);
  const selectedPayrollMonthKey = selectedSummaryMonth;
  const selectedPayslipPeriodReferenceDate = useMemo(
    () =>
      selectedPayslipPeriod
        ? new Date(`${selectedPayslipPeriod.period_month}-15T12:00:00`)
        : null,
    [selectedPayslipPeriod]
  );
  const sessionCostsById = useMemo(
    () => new Map((protectedData?.sessionCosts ?? []).map((row) => [row.id, toNumber(row.labor_cost)])),
    [protectedData]
  );

  const agreementsByUserId = useMemo(() => {
    const next = new Map<string, SalaryAgreementRow[]>();
    agreements.forEach((agreement) => {
      const list = next.get(agreement.user_id) ?? [];
      list.push(agreement);
      next.set(agreement.user_id, list);
    });
    return next;
  }, [agreements]);
  const payslipsByUserId = useMemo(() => {
    const next = new Map<string, PayslipRow[]>();
    payslips.forEach((payslip) => {
      const list = next.get(payslip.user_id) ?? [];
      list.push(payslip);
      next.set(payslip.user_id, list);
    });
    return next;
  }, [payslips]);
  const workerBalancesByUserId = useMemo(
    () => new Map((protectedData?.workerBalances ?? []).map((row) => [row.user_id, row])),
    [protectedData]
  );
  const workerDebtItemsByUserId = useMemo(() => {
    const next = new Map<string, WorkerDebtItemRow[]>();
    (protectedData?.workerDebtItems ?? []).forEach((item) => {
      const list = next.get(item.user_id) ?? [];
      list.push(item);
      next.set(item.user_id, list);
    });
    return next;
  }, [protectedData]);
  const workerDebtItemsBySourceKey = useMemo(() => {
    const next = new Map<string, WorkerDebtItemRow>();
    (protectedData?.workerDebtItems ?? []).forEach((item) => {
      next.set(`${item.source_type}:${item.source_id}`, item);
    });
    return next;
  }, [protectedData]);
  const effectiveWorkerBalancesByUserId = useMemo(() => {
    const next = new Map(workerBalancesByUserId);

    publicUsers.forEach((user) => {
      const workerType = normalizePayrollWorkerType(user.payroll_worker_type, user.pay_tracking_mode);
      if (workerType !== "hourly_payslip") return;

      const existingBalance = next.get(user.id) ?? null;
      const existingDebtItems = workerDebtItemsByUserId.get(user.id) ?? [];
      if (existingDebtItems.length > 0) return;

      const userSessions = visibleSessions.filter((session) => session.user_id === user.id);
      if (userSessions.length === 0) return;

      const earnedAmount = userSessions.reduce((sum, session) => sum + (sessionCostsById.get(session.id) ?? 0), 0);
      if (earnedAmount <= 0.009) return;

      const existingEarned = toNumber(existingBalance?.earned_amount);
      const existingPaid = toNumber(existingBalance?.paid_amount);
      const existingOwed = toNumber(existingBalance?.owed_amount);
      if (existingEarned > 0.009 || existingPaid > 0.009 || existingOwed > 0.009) return;

      next.set(user.id, {
        user_id: user.id,
        item_count: userSessions.length,
        open_item_count: userSessions.length,
        earned_amount: earnedAmount,
        paid_amount: 0,
        owed_amount: earnedAmount,
        payment_status: "unpaid",
        last_payment_date: null,
      });
    });

    return next;
  }, [
    publicUsers,
    sessionCostsById,
    visibleSessions,
    workerBalancesByUserId,
    workerDebtItemsByUserId,
  ]);
  useEffect(() => {
    setLocallyDeletedSessionIds((current) =>
      current.filter((sessionId) => publicSessions.some((session) => session.id === sessionId))
    );
  }, [publicSessions]);
  const workerPaymentsByUserId = useMemo(() => {
    const next = new Map<string, WorkerPaymentRow[]>();
    (protectedData?.workerPayments ?? []).forEach((payment) => {
      const list = next.get(payment.user_id) ?? [];
      list.push(payment);
      next.set(payment.user_id, list);
    });
    return next;
  }, [protectedData]);
  const workerPaymentRecordedByNameById = protectedData?.workerPaymentRecordedByNameById ?? {};
  const sessionRecordedByNameById = protectedData?.sessionRecordedByNameById ?? {};
  const workerPaymentsById = useMemo(
    () => new Map((protectedData?.workerPayments ?? []).map((payment) => [payment.id, payment])),
    [protectedData]
  );
  const workerPaymentAllocationsBySessionId = useMemo(() => {
    const next = new Map<string, WorkerPaymentAllocationRow[]>();
    (protectedData?.workerPaymentAllocations ?? []).forEach((allocation) => {
      if (!allocation.attendance_session_id) return;
      const list = next.get(allocation.attendance_session_id) ?? [];
      list.push(allocation);
      next.set(allocation.attendance_session_id, list);
    });
    return next;
  }, [protectedData]);
  const workerPaymentAllocationsByPaymentId = useMemo(() => {
    const next = new Map<string, WorkerPaymentAllocationRow[]>();
    (protectedData?.workerPaymentAllocations ?? []).forEach((allocation) => {
      const list = next.get(allocation.worker_payment_id) ?? [];
      list.push(allocation);
      next.set(allocation.worker_payment_id, list);
    });
    return next;
  }, [protectedData]);
  const currentMonthPayrollStatsByUserId = useMemo(() => {
    const next = new Map<string, { totalMinutes: number; totalAmount: number }>();

    publicUsers.forEach((user) => {
      const workerType = normalizePayrollWorkerType(user.payroll_worker_type, user.pay_tracking_mode);
      const currentMonthPayslip =
        (payslipsByUserId.get(user.id) ?? []).find(
          (payslip) => periodsById.get(payslip.payroll_period_id)?.period_month === selectedPayrollMonthKey
        ) ?? null;

      if (workerType === "monthly_payslip") {
        const currentAgreement = getActiveSalaryAgreementForDate(
          agreementsByUserId.get(user.id) ?? [],
          new Date(`${selectedPayrollMonthKey}-01T12:00:00`)
        );
        next.set(user.id, {
          totalMinutes: toNumber(currentMonthPayslip?.total_work_minutes),
          totalAmount:
            currentMonthPayslip
              ? toNumber(currentMonthPayslip.gross_salary) || toNumber(currentMonthPayslip.calculated_base_salary)
              : currentAgreement?.salary_type === "monthly"
                ? toNumber(currentAgreement.monthly_salary)
                : 0,
        });
        return;
      }

      if (workerType === "hourly_payslip" && currentMonthPayslip) {
        next.set(user.id, {
          totalMinutes: toNumber(currentMonthPayslip.total_work_minutes),
          totalAmount: toNumber(currentMonthPayslip.gross_salary) || toNumber(currentMonthPayslip.calculated_base_salary),
        });
        return;
      }

      const currentMonthSessions = visibleSessions.filter(
        (session) => session.user_id === user.id && monthKeyFromDate(session.clock_in) === selectedPayrollMonthKey
      );

      next.set(user.id, {
        totalMinutes: currentMonthSessions.reduce((sum, session) => sum + sessionWorkedMinutes(session), 0),
        totalAmount: currentMonthSessions.reduce(
          (sum, session) => sum + (workerDebtItemsBySourceKey.get(`session:${session.id}`)?.earned_amount != null
            ? toNumber(workerDebtItemsBySourceKey.get(`session:${session.id}`)?.earned_amount)
            : sessionCostsById.get(session.id) ?? 0),
          0
        ),
      });
    });

    return next;
  }, [
    agreementsByUserId,
    payslipsByUserId,
    periodsById,
    publicUsers,
    sessionCostsById,
    selectedPayrollMonthKey,
    visibleSessions,
    workerDebtItemsBySourceKey,
  ]);

  const selectedWorker = selectedWorkerId ? usersById.get(selectedWorkerId) ?? null : null;
  const selectedWorkerType = selectedWorker
    ? normalizePayrollWorkerType(selectedWorker.payroll_worker_type, selectedWorker.pay_tracking_mode)
    : null;
  const isSelectedWorkerSalaryTracked = selectedWorker ? isSalaryTrackedWorker(selectedWorker) : false;
  const canSelectedWorkerHaveAgreement = Boolean(
    selectedWorker &&
      selectedWorkerType &&
      payrollWorkerTypeRequiresAgreement(selectedWorkerType) &&
      (selectedWorker.role === "admin" ||
        selectedWorker.role === "office" ||
        selectedWorker.role === "worker" ||
        selectedWorker.role === "worker_no_access")
  );

  useEffect(() => {
    if (!selectedWorker) return;
    setWorkerForm({
      full_name: selectedWorker.full_name ?? "",
      email: selectedWorker.email ?? "",
      phone: selectedWorker.phone ?? "",
      role:
        selectedWorker.role === "admin" ||
        selectedWorker.role === "office" ||
        selectedWorker.role === "worker_no_access"
          ? selectedWorker.role
          : "worker",
      active: selectedWorker.active !== false,
      system_access: selectedWorker.system_access !== false && selectedWorker.role !== "worker_no_access",
      payroll_worker_type: normalizePayrollWorkerType(
        selectedWorker.payroll_worker_type,
        selectedWorker.pay_tracking_mode
      ),
    });
  }, [selectedWorker]);

  const filteredWorkers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return publicUsers.filter((user) => {
      const isWorker =
        user.role === "admin" ||
        user.role === "office" ||
        user.role === "worker" ||
        user.role === "worker_no_access";
      if (!isWorker) return false;
      if (user.active === false) return false;
      if (!query) return true;
      const haystack = [user.full_name ?? "", user.email ?? "", user.phone ?? ""].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [publicUsers, search]);

  const employeeWorkers = useMemo(
    () => filteredWorkers.filter((user) => user.role === "admin" || user.role === "office" || user.role === "worker"),
    [filteredWorkers]
  );

  const laborWorkers = useMemo(
    () => filteredWorkers.filter((user) => user.role === "worker_no_access"),
    [filteredWorkers]
  );
  const agreementUsersWithAgreements = useMemo(
    () =>
      filteredWorkers.filter(
        (user) =>
          (user.role === "admin" ||
            user.role === "office" ||
            user.role === "worker" ||
            user.role === "worker_no_access") &&
          (agreementsByUserId.get(user.id) ?? []).length > 0
      ),
    [agreementsByUserId, filteredWorkers]
  );
  const monthlyPayslipWorkersMissingAgreement = useMemo(
    () =>
      !selectedPayslipPeriodReferenceDate
        ? []
        :
      publicUsers
        .filter((user) => user.active !== false)
        .filter(
          (user) =>
            normalizePayrollWorkerType(user.payroll_worker_type, user.pay_tracking_mode) === "monthly_payslip"
        )
        .filter((user) => {
          const activeAgreement = getActiveSalaryAgreementForDate(
            agreementsByUserId.get(user.id) ?? [],
            selectedPayslipPeriodReferenceDate
          );
          return !activeAgreement || activeAgreement.salary_type !== "monthly";
        }),
    [agreementsByUserId, publicUsers, selectedPayslipPeriodReferenceDate]
  );
  const selectedPeriodPayslips = useMemo(
    () => (selectedPeriodId ? payslips.filter((payslip) => payslip.payroll_period_id === selectedPeriodId) : []),
    [payslips, selectedPeriodId]
  );

  const filteredSessions = useMemo(() => {
    return visibleSessions.filter((session) => {
      if (attendanceFilters.workerId && session.user_id !== attendanceFilters.workerId) return false;
      if (attendanceFilters.businessDomain && session.business_domain !== attendanceFilters.businessDomain) return false;
      if (attendanceFilters.projectId && session.project_id !== attendanceFilters.projectId) return false;
      if (attendanceFilters.status === "open" && session.clock_out) return false;
      if (attendanceFilters.status === "closed" && !session.clock_out) return false;
      if (attendanceFilters.status === "locked" && !session.locked) return false;
      if (attendanceFilters.status === "editable" && session.locked) return false;
      if (attendanceFilters.dateFrom) {
        const from = new Date(`${attendanceFilters.dateFrom}T00:00:00`).getTime();
        if (new Date(session.clock_in).getTime() < from) return false;
      }
      if (attendanceFilters.dateTo) {
        const to = new Date(`${attendanceFilters.dateTo}T23:59:59.999`).getTime();
        if (new Date(session.clock_in).getTime() > to) return false;
      }
      return true;
    });
  }, [attendanceFilters, visibleSessions]);

  const summary = useMemo(() => {
    const payrollUsers = publicUsers.filter(
      (user) =>
        user.active !== false &&
        (user.role === "admin" ||
          user.role === "office" ||
          user.role === "worker" ||
          user.role === "worker_no_access")
    );
    const workerIds = new Set(
      publicUsers
        .filter((user) => user.active !== false && (user.role === "worker" || user.role === "worker_no_access"))
        .map((user) => user.id)
    );
    const breakdown = payrollUsers.reduce(
      (totals, user) => {
        const workerType = normalizePayrollWorkerType(user.payroll_worker_type, user.pay_tracking_mode);
        const stats = currentMonthPayrollStatsByUserId.get(user.id) ?? { totalMinutes: 0, totalAmount: 0 };

        if (workerType === "monthly_payslip") {
          totals.monthlyPayslipWorkers += 1;
          totals.monthlyPayslipAmount += stats.totalAmount;
          return totals;
        }

        if (workerType === "hourly_payslip") {
          totals.hourlyPayslipMinutes += stats.totalMinutes;
          totals.hourlyPayslipAmount += stats.totalAmount;
          return totals;
        }

        totals.sessionOnlyMinutes += stats.totalMinutes;
        totals.sessionOnlyAmount += stats.totalAmount;
        return totals;
      },
      {
        sessionOnlyMinutes: 0,
        sessionOnlyAmount: 0,
        hourlyPayslipMinutes: 0,
        hourlyPayslipAmount: 0,
        monthlyPayslipWorkers: 0,
        monthlyPayslipAmount: 0,
      }
    );
    const totalWorkMinutes = [...currentMonthPayrollStatsByUserId.values()].reduce(
      (sum, stats) => sum + stats.totalMinutes,
      0
    );
    const totalLaborCost = [...currentMonthPayrollStatsByUserId.values()].reduce(
      (sum, stats) => sum + stats.totalAmount,
      0
    );
    return {
      currentPayrollMonth: selectedPayrollMonthKey,
      activeWorkers: workerIds.size,
      openSessions: visibleSessions.filter((session) => !session.clock_out).length,
      totalWorkMinutes,
      totalLaborCost,
      sessionOnlyMinutes: breakdown.sessionOnlyMinutes,
      sessionOnlyAmount: breakdown.sessionOnlyAmount,
      hourlyPayslipMinutes: breakdown.hourlyPayslipMinutes,
      hourlyPayslipAmount: breakdown.hourlyPayslipAmount,
      monthlyPayslipWorkers: breakdown.monthlyPayslipWorkers,
      monthlyPayslipAmount: breakdown.monthlyPayslipAmount,
      unpaidPayslips: protectedData?.summary.unpaidOrUnfinishedPayslips ?? 0,
      totalWorkerOwed: [...effectiveWorkerBalancesByUserId.values()].reduce(
        (sum, balance) => sum + toNumber(balance.owed_amount),
        0
      ),
    };
  }, [
    currentMonthPayrollStatsByUserId,
    effectiveWorkerBalancesByUserId,
    protectedData,
    publicUsers,
    selectedPayrollMonthKey,
    visibleSessions,
  ]);

  function openCreateSession(userId = "") {
    setSessionMode("create");
    setSessionError("");
    setSessionSplitParts([]);
    setSessionForm({
      ...DEFAULT_SESSION_FORM,
      user_id: userId,
      clock_in: toDateTimeLocalValue(new Date(Date.now() - 60 * 60 * 1000)),
      clock_out: toDateTimeLocalValue(new Date()),
    });
    setSessionDialogOpen(true);
  }

  function openEditSession(session: SessionPublicRow) {
    setSessionMode("edit");
    setSessionError("");
    const currentLaborCost = session.labor_cost ? String(session.labor_cost) : "";
    const currentDomain = isExpenseBusinessDomain(session.business_domain) ? session.business_domain : "general_business";
    const totalMinutes = sessionWorkedMinutes(session);
    setSessionSplitParts(
      session.clock_out
        ? [
            createSessionSplitPart(currentDomain, {
              minutes: String(Math.max(1, Math.floor(totalMinutes / 2))),
              projectId: session.project_id ?? "",
              propertyId: session.property_id ?? "",
            }),
            createSessionSplitPart(currentDomain, {
              projectId: session.project_id ?? "",
              propertyId: session.property_id ?? "",
            }),
          ]
        : []
    );
    setSessionForm({
      session_id: session.id,
      user_id: session.user_id,
      business_domain: session.business_domain ?? "general_business",
      project_id: session.project_id ?? "",
      property_id: session.property_id ?? "",
      notes: session.notes ?? "",
      clock_in: toDateTimeLocalValue(new Date(session.clock_in)),
      clock_out: session.clock_out ? toDateTimeLocalValue(new Date(session.clock_out)) : "",
      labor_cost: currentLaborCost,
      original_user_id: session.user_id,
      original_clock_in: session.clock_in,
      original_clock_out: session.clock_out ?? "",
      original_labor_cost: currentLaborCost,
      is_billable_to_customer: session.is_billable_to_customer === true,
      bill_to_customer_amount: session.bill_to_customer_amount ? String(session.bill_to_customer_amount) : "",
      billing_status: session.billing_status ?? "not_billable",
      mark_paid_now: false,
      paid_amount_now: "",
    });
    setSessionDialogOpen(true);
  }

  async function refreshAll({ reloadProtected = true }: { reloadProtected?: boolean } = {}) {
    router.refresh();
    if (reloadProtected && salaryUnlocked && canViewSalary) {
      await loadProtectedData();
    }
  }

  async function postJson(path: string, payload: Record<string, unknown>) {
    let response: Response;
    try {
      response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error("אין חיבור לשרת. נסו שוב.");
    }
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(toHebrewError(json.error ?? response.statusText));
    }
    return json;
  }

  function runAction(action: () => Promise<void>, options?: { onError?: (message: string) => void }) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await action();
      } catch (actionError: unknown) {
        const message = toHebrewError(actionError);
        if (options?.onError) {
          options.onError(message);
        } else {
          setError(message);
        }
      }
    });
  }

  function saveSession() {
    setSessionError("");
    runAction(async () => {
      const path =
        sessionMode === "create" ? "/api/payroll/sessions/create" : "/api/payroll/sessions/update";
      const clockInIso = new Date(sessionForm.clock_in).toISOString();
      const clockOutIso = sessionForm.clock_out ? new Date(sessionForm.clock_out).toISOString() : null;
      const laborCostInput = sessionForm.labor_cost.trim();
      const originalLaborCost = sessionForm.original_labor_cost.trim();
      const sessionTimingChanged =
        sessionMode === "edit" &&
        (sessionForm.user_id !== sessionForm.original_user_id ||
          clockInIso !== sessionForm.original_clock_in ||
          (clockOutIso ?? "") !== sessionForm.original_clock_out);
      const shouldRecalculateLaborCost =
        clockOutIso !== null &&
        (
          (sessionMode === "create" && !laborCostInput) ||
          (sessionMode === "edit" &&
            ((!laborCostInput && !originalLaborCost) ||
              !laborCostInput ||
              (sessionTimingChanged && laborCostInput === originalLaborCost)))
        );

      const response = await postJson(path, {
        session_id: sessionForm.session_id || undefined,
        user_id: sessionForm.user_id,
        business_domain: sessionForm.business_domain,
        project_id: sessionForm.project_id || null,
        property_id: sessionForm.property_id || null,
        notes: sessionForm.notes || null,
        clock_in: clockInIso,
        clock_out: clockOutIso,
        labor_cost: shouldRecalculateLaborCost ? null : laborCostInput || null,
        recalculate_labor_cost: shouldRecalculateLaborCost,
        is_billable_to_customer: sessionForm.is_billable_to_customer,
        bill_to_customer_amount: sessionForm.is_billable_to_customer ? sessionForm.bill_to_customer_amount : null,
        billing_status: sessionForm.billing_status,
      });

      const savedSession =
        response && typeof response === "object" && "session" in response
          ? (response.session as SessionPublicRow | null | undefined)
          : null;

      const shouldCreatePayment =
        sessionForm.mark_paid_now &&
        savedSession?.id &&
        savedSession.user_id &&
        normalizePayrollWorkerType(
          usersById.get(savedSession.user_id)?.payroll_worker_type ?? null,
          usersById.get(savedSession.user_id)?.pay_tracking_mode ?? "session"
        ) === "session_only";

      if (shouldCreatePayment) {
        const derivedEarnedAmount =
          typeof savedSession?.labor_cost === "number" || typeof savedSession?.labor_cost === "string"
            ? toNumber(savedSession.labor_cost)
            : laborCostInput
              ? Number(laborCostInput)
              : null;
        const requestedPaidAmountRaw = sessionForm.paid_amount_now.trim()
          ? Number(sessionForm.paid_amount_now)
          : derivedEarnedAmount;

        if (!Number.isFinite(requestedPaidAmountRaw) || requestedPaidAmountRaw === null || requestedPaidAmountRaw <= 0) {
          throw new Error("יש להזין סכום ששולם עבור המשמרת.");
        }
        const requestedPaidAmount = requestedPaidAmountRaw;

        const paymentDateSource = savedSession.clock_out || savedSession.clock_in || new Date().toISOString();
        await postJson("/api/payroll/worker-payments", {
          user_id: savedSession.user_id,
          payment_date: paymentDateSource.slice(0, 10),
          amount: requestedPaidAmount,
          payment_method: null,
          reference_number: null,
          notes: `תשלום שסומן מתוך משמרת ${formatDate(paymentDateSource)}`,
          allocations: [
            {
              source_type: "session",
              source_id: savedSession.id,
              amount: requestedPaidAmount,
            },
          ],
        });
      }

      setSessionDialogOpen(false);
      setMessage(
        sessionMode === "create"
          ? sessionForm.mark_paid_now
            ? "המשמרת נוספה והתשלום נרשם."
            : "המשמרת נוספה."
          : sessionForm.mark_paid_now
            ? "המשמרת עודכנה והתשלום נרשם."
            : "המשמרת עודכנה."
      );
      await refreshAll();
    }, { onError: (message) => setSessionError(message) });
  }

  function updateSessionSplitPart(partId: string, changes: Partial<Omit<SplitPartDraft, "id">>) {
    setSessionSplitParts((current) =>
      current.map((part) => {
        if (part.id !== partId) return part;
        const next = { ...part, ...changes };
        if (changes.domain && changes.domain !== "logistics_projects") next.projectId = "";
        if (changes.domain && changes.domain !== "property_management") next.propertyId = "";
        return next;
      })
    );
  }

  function updateSessionSplitMinutes(partId: string, rawMinutes: string, totalMinutes: number) {
    setSessionSplitParts((current) => {
      const index = current.findIndex((part) => part.id === partId);
      if (index < 0) return current;
      const maxForPart = Math.max(1, totalMinutes - (current.length - index - 1));
      const trimmed = rawMinutes.trim();
      if (trimmed === "") {
        return current.map((part) => (part.id === partId ? { ...part, minutes: "" } : part));
      }
      const parsed = Math.floor(Number(trimmed));
      const clamped = Number.isFinite(parsed) ? Math.max(1, Math.min(maxForPart, parsed)) : 1;
      return current.map((part) => (part.id === partId ? { ...part, minutes: String(clamped) } : part));
    });
  }

  function addSessionSplitPart(defaultDomain: ExpenseBusinessDomain, totalMinutes: number) {
    setSessionSplitParts((current) =>
      current.length >= Math.min(5, totalMinutes) ? current : [...current, createSessionSplitPart(defaultDomain)]
    );
  }

  function removeSessionSplitPart(partId: string) {
    setSessionSplitParts((current) => (current.length <= 2 ? current : current.filter((part) => part.id !== partId)));
  }

  function splitSession() {
    if (!sessionDialogSourceSession?.id || !sessionDialogSourceSession.clock_out) return;
    if (sessionDialogSplitError) {
      setSessionError(sessionDialogSplitError);
      return;
    }
    setSessionError("");
    runAction(async () => {
      await postJson("/api/payroll/sessions/split", {
        session_id: sessionDialogSourceSession.id,
        parts: sessionSplitParts.map((part) => ({
          minutes: part.minutes,
          business_domain: part.domain,
          project_id: part.projectId || null,
          property_id: part.propertyId || null,
        })),
      });
      setSessionDialogOpen(false);
      setSessionSplitParts([]);
      setMessage("המשמרת פוצלה.");
      await refreshAll();
    }, { onError: (message) => setSessionError(message) });
  }

  function renderCompactSessionLinkField(
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: SalaryCenterProjectOption[]
  ) {
    return (
      <label className="space-y-1 text-right">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <select
          className="h-9 w-44 rounded-md border border-input bg-background px-3 text-right text-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{"בחירה"}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function resetCreateUserForm() {
    setCreateUserForm(DEFAULT_CREATE_USER_FORM);
    setCreateUserError("");
  }

  function createUser() {
    setCreateUserError("");
    const requiresCredentials =
      createUserForm.role !== "worker_no_access" && createUserForm.system_access;
    if (!createUserForm.full_name.trim()) {
      setCreateUserError("יש להזין שם מלא.");
      return;
    }
    if (requiresCredentials && !createUserForm.email.trim()) {
      setCreateUserError("יש להזין אימייל.");
      return;
    }
    if (requiresCredentials && !createUserForm.password.trim()) {
      setCreateUserError("יש להזין סיסמה למשתמש עם גישה.");
      return;
    }

    runAction(async () => {
      const password =
        createUserForm.password.trim() ||
        (createUserForm.role === "worker_no_access" ? "" : createUserForm.password.trim());

      await postJson("/api/users/create", {
        full_name: createUserForm.full_name,
        email: requiresCredentials ? createUserForm.email : createUserForm.email.trim() || null,
        phone: createUserForm.phone || null,
        password: requiresCredentials ? password : "",
        role: createUserForm.role,
        active: createUserForm.active,
        system_access: createUserForm.role === "worker_no_access" ? false : createUserForm.system_access,
        payroll_worker_type: createUserForm.payroll_worker_type,
      });
      setCreateUserOpen(false);
      resetCreateUserForm();
      setMessage("המשתמש נוצר.");
      await refreshAll({ reloadProtected: false });
    });
  }

  function closeOpenSession(sessionId: string) {
    runAction(async () => {
      await postJson("/api/payroll/sessions/close", { session_id: sessionId });
      setMessage("המשמרת נסגרה.");
      await refreshAll();
    });
  }

  function deleteSession(sessionId: string) {
    const session = visibleSessions.find((item) => item.id === sessionId) ?? null;
    const worker = session ? usersById.get(session.user_id) ?? null : null;
    const workerLabel = worker?.full_name ?? worker?.email ?? "העובד";
    setPendingDeletion({ kind: "session", sessionId, workerLabel });
  }

  function saveWorkerAccess() {
    if (!selectedWorker) return;
    runAction(async () => {
      await postJson("/api/payroll/workers/update", {
        user_id: selectedWorker.id,
        full_name: workerForm.full_name,
        email: workerForm.email || null,
        phone: workerForm.phone || null,
        role: workerForm.role,
        active: workerForm.active,
        system_access: workerForm.role === "worker_no_access" ? false : workerForm.system_access,
        payroll_worker_type: workerForm.payroll_worker_type,
      });
      setMessage("פרטי הגישה עודכנו.");
      await refreshAll({ reloadProtected: false });
      setWorkerAccessDialogOpen(false);
    });
  }

  function deleteSelectedWorker() {
    if (!selectedWorker) return;
    setPendingDeletion({
      kind: "worker",
      userId: selectedWorker.id,
      workerLabel: selectedWorker.full_name ?? selectedWorker.email ?? "העובד",
    });
  }

  function saveAgreement() {
    const targetUserId = agreementForm.user_id || selectedWorker?.id || "";
    if (!targetUserId) {
      setError("יש לבחור עובד לפני שמירה.");
      return;
    }
    if (!agreementStandardDailyHoursValid) {
      setError("יש להזין שעות יומיות תקניות גדולות מ-0.");
      return;
    }
    if (!agreementDueDayValid) {
      setError("יש להזין יום תשלום תקין בין 1 ל-31.");
      return;
    }
    runAction(async () => {
      await postJson("/api/payroll/salary-agreements", {
        ...agreementForm,
        agreement_id: agreementForm.agreement_id || undefined,
        user_id: targetUserId,
      });
      setAgreementForm(DEFAULT_AGREEMENT_FORM);
      setAgreementDialogOpen(false);
      setMessage("הסכם השכר נשמר.");
      await refreshAll();
    });
  }

  function openNewAgreementDialog(userId = "", currentAgreement?: SalaryAgreementRow | null) {
    const targetWorker = userId ? usersById.get(userId) ?? null : selectedWorker;
    const targetWorkerType = targetWorker
      ? normalizePayrollWorkerType(targetWorker.payroll_worker_type, targetWorker.pay_tracking_mode)
      : null;
    setAgreementForm({
      agreement_id: "",
      user_id: userId,
      salary_type:
        currentAgreement?.salary_type === "monthly" || currentAgreement?.salary_type === "hourly"
          ? currentAgreement.salary_type
          : targetWorkerType === "monthly_payslip"
            ? "monthly"
            : targetWorkerType === "hourly_payslip"
              ? "hourly"
          : "hourly",
      hourly_rate: currentAgreement?.hourly_rate ? String(currentAgreement.hourly_rate) : "",
      monthly_salary: currentAgreement?.monthly_salary ? String(currentAgreement.monthly_salary) : "",
      overtime_rate: currentAgreement?.overtime_rate ? String(currentAgreement.overtime_rate) : "",
      standard_daily_hours: currentAgreement?.standard_daily_hours ? String(currentAgreement.standard_daily_hours) : "0",
      due_day_of_next_month: currentAgreement?.due_day_of_next_month ? String(currentAgreement.due_day_of_next_month) : "10",
      valid_from: new Date().toISOString().slice(0, 10),
      notes: currentAgreement?.notes ?? "",
    });
    setAgreementDialogOpen(true);
  }

  function openEditAgreementDialog(agreement: SalaryAgreementRow) {
    setAgreementForm({
      agreement_id: agreement.id,
      user_id: agreement.user_id,
      salary_type: agreement.salary_type === "monthly" ? "monthly" : "hourly",
      hourly_rate: agreement.hourly_rate ? String(agreement.hourly_rate) : "",
      monthly_salary: agreement.monthly_salary ? String(agreement.monthly_salary) : "",
      overtime_rate: agreement.overtime_rate ? String(agreement.overtime_rate) : "",
      standard_daily_hours: agreement.standard_daily_hours ? String(agreement.standard_daily_hours) : "0",
      due_day_of_next_month: agreement.due_day_of_next_month ? String(agreement.due_day_of_next_month) : "10",
      valid_from: agreement.valid_from,
      notes: agreement.notes ?? "",
    });
    setAgreementDialogOpen(true);
  }

  function deleteAgreement(agreement: SalaryAgreementRow) {
    const worker = publicUsers.find((user) => user.id === agreement.user_id);
    const workerLabel = worker?.full_name ?? worker?.email ?? "העובד";
    setPendingDeletion({
      kind: "agreement",
      agreementId: agreement.id,
      userId: agreement.user_id,
      workerLabel,
    });
  }

  function saveOverride() {
    if (!selectedWorker) return;
    runAction(async () => {
      await postJson("/api/payroll/hourly-overrides", {
        user_id: selectedWorker.id,
        override_hourly_rate: overrideForm.override_hourly_rate,
        start_time: overrideForm.start_time || null,
        end_time: overrideForm.end_time || null,
        reason: overrideForm.reason || null,
        notes: overrideForm.notes || null,
      });
      setOverrideForm(DEFAULT_OVERRIDE_FORM);
      setMessage("החרגת השכר נוספה.");
      await refreshAll();
      setOverrideDialogOpen(false);
    });
  }

  function createOrOpenPeriod() {
    runAction(async () => {
      await postJson("/api/payroll/periods", { action: "create", period_month: periodMonth });
      setMessage("תקופת השכר נשמרה.");
      await refreshAll();
    });
  }

  function runPeriodAction(action: "generate" | "lock" | "mark_paid", periodId = selectedPeriodId) {
    if (!periodId) return;
    if (action === "mark_paid") {
      setError("תשלומי שכר נרשמים עכשיו דרך כרטיס העובד, לא דרך סימון תקופה כשולמה.");
      return;
    }
    runAction(async () => {
      await postJson("/api/payroll/periods", { action, period_id: periodId });
      setMessage(
        action === "generate"
          ? "התלושים נוצרו."
          : action === "lock"
            ? "תקופת השכר ננעלה."
            : ""
      );
      await refreshAll();
    });
  }

  function generateWorkerPayslip(userId: string) {
    if (!selectedPeriodId) return;
    runAction(async () => {
      await postJson("/api/payroll/payslips", {
        action: "generate",
        payroll_period_id: selectedPeriodId,
        user_id: userId,
      });
      setMessage("התלוש חושב מחדש.");
      await refreshAll();
    });
  }

  function updatePayslip(payslipId: string) {
    runAction(async () => {
      await postJson("/api/payroll/payslips", {
        action: "update",
        payslip_id: payslipId,
        manual_adjustments: payslipAdjustmentDrafts[payslipId] ?? "0",
      });
      setMessage("התלוש עודכן.");
      await refreshAll();
    });
  }

  function addPayslipItem() {
    runAction(async () => {
      await postJson("/api/payroll/payslip-items", payslipItemForm);
      setPayslipItemForm(DEFAULT_PAYSLIP_ITEM_FORM);
      setMessage("פריט התלוש נוסף.");
      await refreshAll();
    });
  }

  function deletePayslipItem(itemId: string, payslipId: string) {
    runAction(async () => {
      const response = await fetch("/api/payroll/payslip-items", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: itemId, payslip_id: payslipId }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Request failed.");
      setMessage("פריט התלוש נמחק.");
      await refreshAll();
    });
  }

  function lockSalaryData() {
    runAction(async () => {
      await fetch("/api/payroll/admin/lock", { method: "POST" });
      setProtectedData(null);
      setSalaryUnlocked(false);
      setProtectedError("");
      setMessage("נתוני השכר ננעלו.");
      router.refresh();
    });
  }

  function openWorkerPaymentDialogForItems(userId: string, items: WorkerDebtItemRow[], defaultAmount?: number | null) {
    const allocations = items.map((item) => ({
      source_type: item.source_type,
      source_id: item.source_id,
      amount: "",
      max_amount: toNumber(item.owed_amount) ?? 0,
      title: buildDebtItemTitle(item),
      subtitle: buildDebtItemSubtitle(item),
    }));
    const normalizedDefaultAmount = defaultAmount && defaultAmount > 0 ? String(defaultAmount) : "";
    setWorkerPaymentError("");
    setWorkerPaymentForm({
      ...DEFAULT_WORKER_PAYMENT_FORM,
      user_id: userId,
      amount: normalizedDefaultAmount,
      allocations: normalizedDefaultAmount ? distributePaymentAmount(normalizedDefaultAmount, allocations) : allocations,
    });
    setWorkerPaymentDialogOpen(true);
  }

  function openWorkerPaymentDialog() {
    if (!selectedWorker) return;
    openWorkerPaymentDialogForItems(selectedWorker.id, selectedWorkerOpenDebtItems);
  }

  function openPayslipPaymentDialog(payslip: PayslipRow) {
    const debtItem = workerDebtItemsBySourceKey.get(`payslip:${payslip.id}`) ?? null;
    if (!debtItem) {
      setError("לא נמצא פריט חוב פתוח עבור התלוש הזה.");
      return;
    }
    setSelectedWorkerId(payslip.user_id);
    openWorkerPaymentDialogForItems(payslip.user_id, [debtItem], toNumber(debtItem.owed_amount));
  }

  function openEditWorkerPaymentDialog(payment: WorkerPaymentRow) {
    const allocations = (workerPaymentAllocationsByPaymentId.get(payment.id) ?? [])
      .map((allocation) => {
        const sourceId =
          allocation.source_type === "session" ? allocation.attendance_session_id : allocation.payslip_id;
        if (!sourceId) return null;
        const debtItem =
          (protectedData?.workerDebtItems ?? []).find(
            (item) => item.source_type === allocation.source_type && item.source_id === sourceId
          ) ?? null;
        return {
          source_type: allocation.source_type,
          source_id: sourceId,
          amount:
            typeof allocation.amount === "number" || typeof allocation.amount === "string"
              ? String(allocation.amount)
              : "",
          max_amount: (toNumber(debtItem?.owed_amount) ?? 0) + (toNumber(allocation.amount) ?? 0),
          title: debtItem ? buildDebtItemTitle(debtItem) : sourceId,
          subtitle: debtItem ? buildDebtItemSubtitle(debtItem) : "",
        };
      })
      .filter((allocation): allocation is WorkerPaymentAllocationFormState => Boolean(allocation));

    setWorkerPaymentError("");
    setWorkerPaymentForm({
      payment_id: payment.id,
      user_id: payment.user_id,
      payment_date: payment.payment_date ?? new Date().toISOString().slice(0, 10),
      amount:
        typeof payment.amount === "number" || typeof payment.amount === "string" ? String(payment.amount) : "",
      payment_method: payment.payment_method ?? "",
      reference_number: payment.reference_number ?? "",
      notes: payment.notes ?? "",
      allocations,
    });
    setWorkerPaymentDialogOpen(true);
  }

  function openSessionPaymentDialog() {
    if (!sessionDialogWorker || !sessionDialogDebtItem) return;
    openWorkerPaymentDialogForItems(
      sessionDialogWorker.id,
      [sessionDialogDebtItem],
      toNumber(sessionDialogDebtItem.owed_amount)
    );
  }

  function setWorkerPaymentAmount(value: string) {
    setWorkerPaymentForm((current) => ({
      ...current,
      amount: value,
      allocations: distributePaymentAmount(value, current.allocations),
    }));
  }

  function updateWorkerPaymentAllocation(sourceId: string, value: string) {
    setWorkerPaymentForm((current) => ({
      ...current,
      allocations: current.allocations.map((allocation) => {
        if (allocation.source_id !== sourceId) return allocation;
        const parsed = Number(value);
        const bounded = Number.isFinite(parsed)
          ? Math.max(0, Math.min(allocation.max_amount, parsed))
          : 0;
        return {
          ...allocation,
          amount: bounded > 0 ? String(Math.round(bounded * 100) / 100) : "",
        };
      }),
    }));
  }

  function autoDistributeWorkerPayment() {
    setWorkerPaymentForm((current) => ({
      ...current,
      allocations: distributePaymentAmount(current.amount, current.allocations),
    }));
  }

  function saveWorkerPayment() {
    const amount = Number(workerPaymentForm.amount);
    const activeAllocations = workerPaymentForm.allocations
      .map((allocation) => ({
        ...allocation,
        parsedAmount: Number(allocation.amount),
      }))
      .filter((allocation) => Number.isFinite(allocation.parsedAmount) && allocation.parsedAmount > 0);

    const allocationTotal = activeAllocations.reduce((sum, allocation) => sum + allocation.parsedAmount, 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      setWorkerPaymentError("יש להזין סכום תשלום תקין.");
      return;
    }
    if (!workerPaymentForm.payment_date) {
      setWorkerPaymentError("יש לבחור תאריך תשלום.");
      return;
    }
    if (activeAllocations.length === 0) {
      setWorkerPaymentError("יש להקצות את התשלום לפחות לפריט חוב אחד.");
      return;
    }
    if (Math.abs(allocationTotal - amount) > 0.01) {
      setWorkerPaymentError("סכום ההקצאות חייב להיות שווה לסכום התשלום.");
      return;
    }

    runAction(async () => {
      const path = "/api/payroll/worker-payments";
      const response = await fetch(path, {
        method: workerPaymentForm.payment_id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payment_id: workerPaymentForm.payment_id || undefined,
          user_id: workerPaymentForm.user_id,
          payment_date: workerPaymentForm.payment_date,
          amount,
          payment_method: workerPaymentForm.payment_method.trim() || null,
          reference_number: workerPaymentForm.reference_number.trim() || null,
          notes: workerPaymentForm.notes.trim() || null,
          allocations: activeAllocations.map((allocation) => ({
            source_type: allocation.source_type,
            source_id: allocation.source_id,
            amount: allocation.parsedAmount,
          })),
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Request failed.");
      }
      setWorkerPaymentDialogOpen(false);
      setWorkerPaymentForm(DEFAULT_WORKER_PAYMENT_FORM);
      setWorkerPaymentError("");
      setMessage(workerPaymentForm.payment_id ? "תשלום לעובד עודכן." : "תשלום לעובד נשמר.");
      await refreshAll();
    });
  }

  function deleteWorkerPayment(payment: WorkerPaymentRow) {
    setPendingDeletion({
      kind: "payment",
      paymentId: payment.id,
      userId: payment.user_id,
      amountLabel: formatCurrency(toNumber(payment.amount) ?? 0),
    });
  }

  function confirmPendingDeletion() {
    const pending = pendingDeletion;
    if (!pending) return;

    runAction(async () => {
      if (pending.kind === "session") {
        await postJson("/api/payroll/sessions/delete", { session_id: pending.sessionId });
        setLocallyDeletedSessionIds((current) =>
          current.includes(pending.sessionId) ? current : [...current, pending.sessionId]
        );
        if (sessionForm.session_id === pending.sessionId) {
          setSessionDialogOpen(false);
        }
        setMessage("המשמרת נמחקה.");
        setPendingDeletion(null);
        await refreshAll();
        return;
      }

      if (pending.kind === "worker") {
        await postJson("/api/payroll/workers/delete", {
          user_id: pending.userId,
        });
        setWorkerAccessDialogOpen(false);
        setSelectedWorkerId("");
        setMessage("העובד הוסר מהרשימה הפעילה.");
        setPendingDeletion(null);
        if (isWorkerDetailMode) {
          router.push("/payroll");
          return;
        }
        await refreshAll();
        return;
      }

      if (pending.kind === "agreement") {
        await postJson("/api/payroll/salary-agreements", {
          action: "delete",
          agreement_id: pending.agreementId,
          user_id: pending.userId,
        });
        setMessage("המשכורת נמחקה.");
        setPendingDeletion(null);
        await refreshAll();
        return;
      }

      const response = await fetch("/api/payroll/worker-payments", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payment_id: pending.paymentId,
          user_id: pending.userId,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Request failed.");
      }

      if (workerPaymentForm.payment_id === pending.paymentId) {
        setWorkerPaymentDialogOpen(false);
        setWorkerPaymentForm(DEFAULT_WORKER_PAYMENT_FORM);
        setWorkerPaymentError("");
      }

      setMessage("תשלום לעובד נמחק.");
      setPendingDeletion(null);
      await refreshAll();
    });
  }

  const pendingDeletionDetails = useMemo(() => {
    if (!pendingDeletion) return null;
    if (pendingDeletion.kind === "session") {
      return {
        title: "מחיקת משמרת",
        description: "הפעולה תמחק את המשמרת ואת הקישור שלה לחובות העובד.",
        label: pendingDeletion.workerLabel,
      };
    }
    if (pendingDeletion.kind === "worker") {
      return {
        title: "מחיקת עובד",
        description: "הפעולה תשבית את העובד, תבטל גישה למערכת ותשמור את ההיסטוריה.",
        label: pendingDeletion.workerLabel,
      };
    }
    if (pendingDeletion.kind === "agreement") {
      return {
        title: "מחיקת משכורת",
        description: "הפעולה תמחק את הסכם השכר של העובד.",
        label: pendingDeletion.workerLabel,
      };
    }
    return {
      title: "מחיקת תשלום",
      description: "הפעולה תמחק את התשלום ואת ההקצאות שלו לחובות העובד.",
      label: pendingDeletion.amountLabel,
    };
  }, [pendingDeletion]);

  const selectedWorkerSessions = useMemo(
    () => visibleSessions.filter((session) => session.user_id === selectedWorkerId),
    [selectedWorkerId, visibleSessions]
  );
  const selectedWorkerSessionsSorted = useMemo(
    () =>
      [...selectedWorkerSessions].sort(
        (a, b) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime()
      ),
    [selectedWorkerSessions]
  );
  useEffect(() => {
    // Reset to "all months / all years" whenever a different worker is selected.
    setWorkerPrintFilters({ projectId: "", month: "", year: "" });
  }, [selectedWorkerId]);
  const selectedWorkerBalance = selectedWorker ? effectiveWorkerBalancesByUserId.get(selectedWorker.id) ?? null : null;
  const selectedWorkerDebtItems = useMemo(() => {
    if (!selectedWorker) return [];
    const items = workerDebtItemsByUserId.get(selectedWorker.id) ?? [];
    return [...items].sort((a, b) => {
      const aTime = a.source_date ? new Date(a.source_date).getTime() : 0;
      const bTime = b.source_date ? new Date(b.source_date).getTime() : 0;
      return bTime - aTime;
    });
  }, [selectedWorker, workerDebtItemsByUserId]);
  const selectedWorkerOpenDebtItems = useMemo(
    () => selectedWorkerDebtItems.filter((item) => toNumber(item.owed_amount) > 0.009),
    [selectedWorkerDebtItems]
  );
  const selectedWorkerPayments = useMemo(() => {
    if (!selectedWorker) return [];
    return [...(workerPaymentsByUserId.get(selectedWorker.id) ?? [])].sort((a, b) =>
      (b.payment_date ?? "").localeCompare(a.payment_date ?? "")
    );
  }, [selectedWorker, workerPaymentsByUserId]);
  const selectedWorkerOverrides = useMemo(
    () => (selectedWorker ? (protectedData?.hourlyOverrides ?? []).filter((override) => override.user_id === selectedWorker.id) : []),
    [protectedData, selectedWorker]
  );
  const selectedWorkerProjectOptions = useMemo(() => {
    const next = new Map<string, string>();
    selectedWorkerSessionsSorted.forEach((session) => {
      if (!session.project_id || next.has(session.project_id)) return;
      next.set(session.project_id, projectLabelsById.get(session.project_id) ?? "פרויקט");
    });
    return [...next.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "he"));
  }, [projectLabelsById, selectedWorkerSessionsSorted]);
  const selectedWorkerPrintYearOptions = useMemo(() => {
    const years = new Set<string>();
    selectedWorkerSessionsSorted.forEach((session) => {
      const date = new Date(session.clock_in);
      if (!Number.isNaN(date.getTime())) {
        years.add(String(date.getFullYear()));
      }
    });
    years.add(String(new Date().getFullYear()));
    return [...years].sort((a, b) => Number(b) - Number(a));
  }, [selectedWorkerSessionsSorted]);
  // Sessions filtered by outer month/year AND the sessions tab's own project filter.
  // Empty month/year means "all" (no filter for that dimension).
  const selectedWorkerSessionsByFilter = useMemo(
    () =>
      selectedWorkerSessionsSorted.filter((session) => {
        if (sessionsProjectId && session.project_id !== sessionsProjectId) return false;
        if (!workerPrintFilters.month && !workerPrintFilters.year) return true;
        const sessionDate = new Date(session.clock_in);
        if (Number.isNaN(sessionDate.getTime())) return false;
        const sessionMonth = String(sessionDate.getMonth() + 1).padStart(2, "0");
        const sessionYear = String(sessionDate.getFullYear());
        if (workerPrintFilters.month && sessionMonth !== workerPrintFilters.month) return false;
        if (workerPrintFilters.year && sessionYear !== workerPrintFilters.year) return false;
        return true;
      }),
    [selectedWorkerSessionsSorted, sessionsProjectId, workerPrintFilters.month, workerPrintFilters.year]
  );
  // Payments filtered by outer month/year only (no project — payments aren't project-scoped).
  // Empty month/year means "all".
  const selectedWorkerPaymentsByPeriod = useMemo(
    () =>
      selectedWorkerPayments.filter((payment) => {
        if (!workerPrintFilters.month && !workerPrintFilters.year) return true;
        if (!payment.payment_date) return false;
        const paymentDate = new Date(payment.payment_date);
        if (Number.isNaN(paymentDate.getTime())) return false;
        const month = String(paymentDate.getMonth() + 1).padStart(2, "0");
        const year = String(paymentDate.getFullYear());
        if (workerPrintFilters.month && month !== workerPrintFilters.month) return false;
        if (workerPrintFilters.year && year !== workerPrintFilters.year) return false;
        return true;
      }),
    [selectedWorkerPayments, workerPrintFilters.month, workerPrintFilters.year]
  );
  // Stats computed from the filtered sessions (uses sessions-tab project filter
  // + outer month/year) — reflects exactly what's shown in the נוכחות list.
  const selectedWorkerFilteredStats = useMemo(() => {
    let totalMinutes = 0;
    let totalAmount = 0;
    for (const session of selectedWorkerSessionsByFilter) {
      totalMinutes += sessionWorkedMinutes(session);
      totalAmount += sessionCostsById.get(session.id) ?? 0;
    }
    return {
      totalMinutes,
      totalAmount,
      sessionCount: selectedWorkerSessionsByFilter.length,
    };
  }, [selectedWorkerSessionsByFilter, sessionCostsById]);
  const selectedWorkerPrintSessions = useMemo(
    () =>
      selectedWorkerSessionsSorted.filter((session) => {
        if (workerPrintFilters.projectId && session.project_id !== workerPrintFilters.projectId) return false;
        if (!workerPrintFilters.month && !workerPrintFilters.year) return true;
        const sessionDate = new Date(session.clock_in);
        if (Number.isNaN(sessionDate.getTime())) return false;
        const sessionMonth = String(sessionDate.getMonth() + 1).padStart(2, "0");
        const sessionYear = String(sessionDate.getFullYear());
        if (workerPrintFilters.month && sessionMonth !== workerPrintFilters.month) return false;
        if (workerPrintFilters.year && sessionYear !== workerPrintFilters.year) return false;
        return true;
      }),
    [selectedWorkerSessionsSorted, workerPrintFilters]
  );
  const selectedWorkerPrintSessionIds = useMemo(
    () => new Set(selectedWorkerPrintSessions.map((session) => session.id)),
    [selectedWorkerPrintSessions]
  );
  const selectedWorkerPrintPayments = useMemo(() => {
    return selectedWorkerPayments
      .map((payment) => {
        const matchingAllocations = (workerPaymentAllocationsByPaymentId.get(payment.id) ?? []).filter(
          (allocation) =>
            allocation.source_type === "session" &&
            allocation.attendance_session_id &&
            selectedWorkerPrintSessionIds.has(allocation.attendance_session_id)
        );
        const scopedAmount = matchingAllocations.reduce((sum, allocation) => sum + toNumber(allocation.amount), 0);
        if (scopedAmount <= 0.009) return null;
        return {
          payment,
          scopedAmount,
        };
      })
      .filter(
        (item): item is { payment: WorkerPaymentRow; scopedAmount: number } =>
          Boolean(item)
      );
  }, [selectedWorkerPayments, workerPaymentAllocationsByPaymentId, selectedWorkerPrintSessionIds]);
  const selectedWorkerPrintSummary = useMemo(() => {
    return selectedWorkerPrintSessions.reduce(
      (totals, session) => {
        const debtItem = workerDebtItemsBySourceKey.get(`session:${session.id}`) ?? null;
        totals.earned += debtItem ? toNumber(debtItem.earned_amount) : sessionCostsById.get(session.id) ?? 0;
        totals.paid += debtItem ? toNumber(debtItem.paid_amount) : 0;
        totals.owed += debtItem
          ? toNumber(debtItem.owed_amount)
          : Math.max(0, (sessionCostsById.get(session.id) ?? 0) - 0);
        return totals;
      },
      { earned: 0, paid: 0, owed: 0 }
    );
  }, [selectedWorkerPrintSessions, workerDebtItemsBySourceKey, sessionCostsById]);
  function printSelectedWorkerSummary() {
    if (!selectedWorker) return;

    const workerName = selectedWorker.full_name ?? selectedWorker.email ?? "עובד";
    const workerAgreements = agreementsByUserId.get(selectedWorker.id) ?? [];
    const latestHourlyOverride = getLatestHourlyOverride(selectedWorkerOverrides, selectedWorker.id);
    const selectedProjectLabel = workerPrintFilters.projectId
      ? projectLabelsById.get(workerPrintFilters.projectId) ?? "פרויקט"
      : "כל הפרויקטים";
    const selectedMonthLabel =
      workerPrintFilters.month && workerPrintFilters.year
        ? formatMonthYearLabel(workerPrintFilters.year, workerPrintFilters.month)
        : !workerPrintFilters.month && !workerPrintFilters.year
          ? "כל החודשים"
          : workerPrintFilters.year
            ? `כל השנה ${workerPrintFilters.year}`
            : `כל ${workerPrintFilters.month}/*`;
    const generatedAt = new Date();
    const generatedLabel = `${formatDate(generatedAt.toISOString())} ${generatedAt.toLocaleTimeString("he-IL", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    const workRowData = selectedWorkerPrintSessions.map((session) => {
      const workedAt = getSessionLinkLabel(session, projectLabelsById, propertyLabelsById);
      const startDateValue = new Date(session.clock_in);
      const endDateValue = session.clock_out ? new Date(session.clock_out) : null;
      const workDate = Number.isNaN(startDateValue.getTime())
        ? formatDate(session.clock_in)
        : formatLocalDate(startDateValue);
      const agreement = getActiveSalaryAgreementForDate(workerAgreements, startDateValue);
      const isHourly = agreement?.salary_type === "hourly";
      const hourlyRateValue =
        isHourly && toNumber(latestHourlyOverride?.override_hourly_rate) > 0
          ? toNumber(latestHourlyOverride?.override_hourly_rate)
          : isHourly
            ? toNumber(agreement?.hourly_rate)
            : 0;

      return {
        workDate,
        workedAt,
        isHourly,
        startTime:
          Number.isNaN(startDateValue.getTime())
            ? formatDateTime(session.clock_in)
            : formatLocalTime(startDateValue),
        endTime:
          endDateValue && !Number.isNaN(endDateValue.getTime())
            ? formatLocalTime(endDateValue)
            : "פתוח",
        hours: formatMinutes(sessionWorkedMinutes(session)),
        hourlyRate: hourlyRateValue > 0 ? `${formatCurrency(hourlyRateValue)} / שעה` : "—",
        amount: formatCurrency(sessionCostsById.get(session.id) ?? 0),
        notes: session.notes ?? "",
      };
    });
    const showHourlyColumns = workRowData.some((row) => row.isHourly);
    const showNotesColumn = workRowData.some((row) => row.notes && row.notes.trim().length > 0);
    const workRows = workRowData
      .map((row) => {
        const hourlyCells = showHourlyColumns
          ? `
            <td>${escapePrintHtml(row.isHourly ? row.startTime : "—")}</td>
            <td>${escapePrintHtml(row.isHourly ? row.endTime : "—")}</td>
            <td>${escapePrintHtml(row.isHourly ? row.hours : "—")}</td>
            <td>${escapePrintHtml(row.isHourly ? row.hourlyRate : "—")}</td>
          `
          : "";
        const notesCell = showNotesColumn
          ? `<td>${escapePrintHtml(row.notes || "—")}</td>`
          : "";

        return `
          <tr>
            <td>${escapePrintHtml(row.workDate)}</td>
            ${hourlyCells}
            <td>${escapePrintHtml(row.workedAt)}</td>
            <td>${escapePrintHtml(row.amount)}</td>
            ${notesCell}
          </tr>
        `;
      })
      .join("");
    const notesHeader = showNotesColumn ? "<th>הערות</th>" : "";
    const workTableHeaders = showHourlyColumns
      ? `
        <th>תאריך</th>
        <th>שעת התחלה</th>
        <th>שעת סיום</th>
        <th>סה"כ שעות</th>
        <th>תעריף שעתי</th>
        <th>פרויקט / נכס</th>
        <th>עלות עבודה</th>
        ${notesHeader}
      `
      : `
        <th>תאריך</th>
        <th>פרויקט / נכס</th>
        <th>עלות עבודה</th>
        ${notesHeader}
      `;
    const paymentRows = selectedWorkerPrintPayments
      .map(({ payment, scopedAmount }) => {
        const details = [formatWorkerPaymentMethodLabel(payment.payment_method), payment.reference_number]
          .filter(Boolean)
          .join(" • ");
        return `
          <tr>
            <td>${escapePrintHtml(formatDate(payment.payment_date))}</td>
            <td>${escapePrintHtml(formatCurrency(scopedAmount))}</td>
            <td>${escapePrintHtml(details || "ללא פירוט")}</td>
            <td>${escapePrintHtml(payment.notes || "-")}</td>
          </tr>
        `;
      })
      .join("");

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const printHtml = `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>${escapePrintHtml(`סיכום עובד - ${workerName}`)}</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 24px;
        color: #1D2848;
        direction: rtl;
      }
      h1, h2, h3, p { margin: 0; }
      .hero-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
      }
      .hero-table th,
      .hero-table td {
        border: 1px solid #BAE6FD;
        padding: 14px 16px;
        text-align: right;
      }
      .hero-table th {
        background: #E0F2FE;
        font-size: 24px;
        font-weight: 800;
      }
      .hero-table td {
        background: #ffffff;
      }
      .worker-name {
        font-size: 26px;
        font-weight: 800;
      }
      .worker-phone {
        margin-top: 6px;
        font-size: 20px;
        font-weight: 700;
      }
      .subtle {
        color: #0369A1;
        font-size: 12px;
        margin-top: 6px;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin: 18px 0 24px;
      }
      .card {
        border: 1px solid #BAE6FD;
        border-radius: 12px;
        padding: 12px;
      }
      .label {
        color: #0369A1;
        font-size: 12px;
        margin-bottom: 8px;
      }
      .value {
        font-size: 18px;
        font-weight: 700;
      }
      .section {
        margin-top: 24px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 12px;
        font-size: 13px;
      }
      th, td {
        border: 1px solid #BAE6FD;
        padding: 8px 10px;
        text-align: right;
        vertical-align: top;
      }
      th {
        background: #E0F2FE;
      }
      .empty {
        margin-top: 12px;
        border: 1px dashed #BAE6FD;
        border-radius: 12px;
        padding: 12px;
        color: #0369A1;
      }
      @media print {
        body { margin: 12px; }
      }
    </style>
  </head>
  <body>
    <table class="hero-table">
      <thead>
        <tr>
          <th>סיכום עבודה ותשלומים לעובד</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div class="worker-name">${escapePrintHtml(workerName)}</div>
            <div class="worker-phone">טלפון: ${escapePrintHtml(selectedWorker.phone ?? "-")}</div>
            <p class="subtle">פרויקט: ${escapePrintHtml(selectedProjectLabel)} • חודש: ${escapePrintHtml(selectedMonthLabel)}</p>
            <p class="subtle">הופק בתאריך ${escapePrintHtml(generatedLabel)}</p>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="summary">
      <div class="card">
        <div class="label">סה"כ שנצבר לתקופה</div>
        <div class="value">${escapePrintHtml(formatCurrency(selectedWorkerPrintSummary.earned))}</div>
      </div>
      <div class="card">
        <div class="label">סה"כ שולם לתקופה</div>
        <div class="value">${escapePrintHtml(formatCurrency(selectedWorkerPrintSummary.paid))}</div>
      </div>
      <div class="card">
        <div class="label">יתרה לתשלום לתקופה</div>
        <div class="value">${escapePrintHtml(formatCurrency(selectedWorkerPrintSummary.owed))}</div>
      </div>
    </div>

    <div class="section">
      <h2>פירוט עבודה</h2>
      ${
        workRows
          ? `<table>
              <thead>
                <tr>${workTableHeaders}</tr>
              </thead>
              <tbody>${workRows}</tbody>
            </table>`
          : '<div class="empty">אין משמרות להצגה למסננים שנבחרו.</div>'
      }
    </div>

    <div class="section">
      <h2>פירוט תשלומים</h2>
      ${
        paymentRows
          ? `<table>
              <thead>
                <tr>
                  <th>תאריך תשלום</th>
                  <th>סכום</th>
                  <th>איך שולם</th>
                  <th>הערות</th>
                </tr>
              </thead>
              <tbody>${paymentRows}</tbody>
            </table>`
          : '<div class="empty">אין תשלומים שמורים למסננים שנבחרו.</div>'
      }
    </div>
  </body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => {
      printWindow.setTimeout(() => {
        printWindow.print();
      }, 150);
    };
  }
  const sessionDialogWorker = useMemo(
    () => (sessionForm.user_id ? usersById.get(sessionForm.user_id) ?? null : null),
    [sessionForm.user_id, usersById]
  );
  const sessionDialogWorkerType = useMemo(
    () =>
      sessionDialogWorker
        ? normalizePayrollWorkerType(sessionDialogWorker.payroll_worker_type, sessionDialogWorker.pay_tracking_mode)
        : null,
    [sessionDialogWorker]
  );
  const sessionDialogSourceSession = useMemo(
    () => (sessionMode === "edit" && sessionForm.session_id ? visibleSessions.find((session) => session.id === sessionForm.session_id) ?? null : null),
    [sessionForm.session_id, sessionMode, visibleSessions]
  );
  const sessionDialogDebtItem = useMemo(() => {
    if (sessionMode !== "edit" || !sessionForm.session_id) return null;
    return (
      (protectedData?.workerDebtItems ?? []).find(
        (item) => item.source_type === "session" && item.source_id === sessionForm.session_id
      ) ?? null
    );
  }, [protectedData, sessionForm.session_id, sessionMode]);
  const sessionDialogPaymentAllocations = useMemo(() => {
    if (!sessionForm.session_id) return [];
    return [...(workerPaymentAllocationsBySessionId.get(sessionForm.session_id) ?? [])].sort((a, b) =>
      (workerPaymentsById.get(b.worker_payment_id)?.payment_date ?? "").localeCompare(
        workerPaymentsById.get(a.worker_payment_id)?.payment_date ?? ""
      )
    );
  }, [sessionForm.session_id, workerPaymentAllocationsBySessionId, workerPaymentsById]);
  const sessionDialogWorkedMinutes = useMemo(() => {
    const start = new Date(sessionForm.clock_in).getTime();
    const end = new Date(sessionForm.clock_out).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.round((end - start) / 60000);
  }, [sessionForm.clock_in, sessionForm.clock_out]);
  const sessionDialogDurationHours = useMemo(() => {
    if (sessionDialogWorkedMinutes <= 0) return "";
    const hours = sessionDialogWorkedMinutes / 60;
    return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
  }, [sessionDialogWorkedMinutes]);
  const sessionDialogAgreement = useMemo(() => {
    if (!sessionForm.user_id || !sessionForm.clock_in) return null;
    return getCurrentSalaryAgreement(
      agreementsByUserId.get(sessionForm.user_id) ?? [],
      new Date(sessionForm.clock_in)
    );
  }, [agreementsByUserId, sessionForm.clock_in, sessionForm.user_id]);
  const sessionDialogSuggestedAmount = useMemo(() => {
    if (sessionForm.labor_cost.trim()) {
      const parsed = Number(sessionForm.labor_cost);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (sessionDialogWorkedMinutes <= 0) return null;
    return calculateSessionLaborCost(sessionDialogAgreement, sessionDialogWorkedMinutes);
  }, [sessionDialogAgreement, sessionDialogWorkedMinutes, sessionForm.labor_cost]);
  const sessionDialogSplitPreview = useMemo(() => {
    if (!sessionDialogSourceSession?.clock_out) return [];
    const totalMinutes = sessionWorkedMinutes(sessionDialogSourceSession);
    let consumed = 0;
    return sessionSplitParts.map((part, index) => {
      const isLast = index === sessionSplitParts.length - 1;
      const requested = Math.max(0, Number(part.minutes) || 0);
      const minutes = isLast ? Math.max(0, totalMinutes - consumed) : Math.max(0, Math.min(totalMinutes - consumed, requested));
      consumed += minutes;
      return { ...part, minutes };
    });
  }, [sessionDialogSourceSession, sessionSplitParts]);
  const sessionDialogSplitError = useMemo(() => {
    if (!sessionDialogSourceSession?.clock_out) return "";
    const totalMinutes = sessionWorkedMinutes(sessionDialogSourceSession);
    if (sessionSplitParts.length < 2) return "צריך לפחות שני חלקים.";
    if (sessionSplitParts.length > Math.min(5, totalMinutes)) return "אי אפשר לפצל ליותר חלקים ממספר הדקות במשמרת.";
    let consumed = 0;
    for (let index = 0; index < sessionSplitParts.length; index += 1) {
      const part = sessionSplitParts[index];
      const isLast = index === sessionSplitParts.length - 1;
      const remainingParts = sessionSplitParts.length - index - 1;
      if (!isLast) {
        const minutes = Math.floor(Number(part.minutes));
        if (!Number.isFinite(minutes) || minutes <= 0) return `יש להזין מספר דקות תקין בחלק ${index + 1}.`;
        if (consumed + minutes > totalMinutes - remainingParts) return "סכום הדקות גדול ממשך המשמרת.";
        consumed += minutes;
      } else if (totalMinutes - consumed <= 0) {
        return "לא נשאר זמן לחלק האחרון.";
      }
      if (part.domain === "logistics_projects" && !part.projectId) return `יש לבחור פרויקט בחלק ${index + 1}.`;
      if (part.domain === "property_management" && !part.propertyId) return `יש לבחור נכס בחלק ${index + 1}.`;
    }
    return "";
  }, [sessionDialogSourceSession, sessionSplitParts]);

  useEffect(() => {
    if (!sessionForm.mark_paid_now || sessionDialogSuggestedAmount === null) return;
    setSessionForm((current) => {
      if (current.paid_amount_now.trim()) return current;
      return {
        ...current,
        paid_amount_now: String(Number(sessionDialogSuggestedAmount.toFixed(2))),
      };
    });
  }, [sessionDialogSuggestedAmount, sessionForm.mark_paid_now]);

  function buildDebtItemTitle(item: WorkerDebtItemRow) {
    if (item.source_type === "payslip") {
      return item.period_month ? `תלוש ${monthLabelFromKey(item.period_month)}` : "תלוש";
    }
    const projectLabel = item.project_id ? projectLabelsById.get(item.project_id) ?? "פרויקט" : "ללא פרויקט";
    return item.source_date ? `${formatDate(item.source_date)} • ${projectLabel}` : projectLabel;
  }

  function buildDebtItemSubtitle(item: WorkerDebtItemRow) {
    if (item.source_type === "payslip") {
      const dueText = item.due_date ? ` • לתשלום עד ${formatDate(item.due_date)}` : "";
      return `ברוטו ${formatCurrency(item.earned_amount)}${dueText}`;
    }
    return `${formatMinutes(item.worked_minutes)} • עלות ${formatCurrency(item.earned_amount)}`;
  }

  function distributePaymentAmount(totalAmountText: string, allocations: WorkerPaymentAllocationFormState[]) {
    let remaining = Math.max(0, Number(totalAmountText) || 0);
    return allocations.map((allocation) => {
      const nextAmount = Math.min(allocation.max_amount, remaining);
      remaining -= nextAmount;
      return {
        ...allocation,
        amount: nextAmount > 0 ? String(Math.round(nextAmount * 100) / 100) : "",
      };
    });
  }

  function getSessionPayrollPeriod(session: SessionPublicRow) {
    return periodsForUi.find((period) => {
      const time = new Date(session.clock_in).getTime();
      const start = new Date(`${period.start_date}T00:00:00`).getTime();
      const end = new Date(`${period.end_date}T23:59:59.999`).getTime();
      return Number.isFinite(time) && Number.isFinite(start) && Number.isFinite(end) && time >= start && time <= end;
    }) ?? null;
  }

  return (
    <div className="space-y-4 text-right" dir="rtl" style={{ direction: "rtl" }}>
      {(message || error || protectedError) ? (
        <Card>
          <CardContent className="space-y-2 py-4 text-sm">
            {message ? <div className="text-success">{message}</div> : null}
            {error ? <div className="text-destructive">{error}</div> : null}
            {protectedError ? <div className="text-destructive">{protectedError}</div> : null}
          </CardContent>
        </Card>
      ) : null}

      {!isWorkerDetailMode ? <>
      <div className="space-y-2 py-1 text-center">
        <div className="flex justify-center">
          <select
            value={selectedSummaryMonth}
            onChange={(event) => setSelectedSummaryMonth(event.target.value)}
            className="min-w-[220px] border-0 bg-transparent px-2 text-center text-lg font-semibold shadow-none focus-visible:ring-0"
          >
            {selectedSummaryMonthOptions.map((monthKey) => (
              <option key={monthKey} value={monthKey}>
                {monthLabelFromKey(monthKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="חודש שכר" value={monthLabelFromKey(summary.currentPayrollMonth)} />
        <SummaryCard title="שעות משמרות החודש" value={formatMinutes(summary.totalWorkMinutes)} />
        <SalaryProtected
          unlocked={salaryUnlocked}
          hasPasswordConfigured={hasPasswordConfigured}
          canUnlock={canViewSalary}
          onUnlockSuccess={loadProtectedData}
          fallback={<SummaryCard title="עלות עבודה החודש" value="מוגן" protectedValue />}
        >
          <SummaryCard title="עלות עבודה החודש" value={formatCurrency(summary.totalLaborCost)} protectedValue />
        </SalaryProtected>
        <SalaryProtected
          unlocked={salaryUnlocked}
          hasPasswordConfigured={hasPasswordConfigured}
          canUnlock={canViewSalary}
          onUnlockSuccess={loadProtectedData}
          fallback={<SummaryCard title="יתרה לעובדים" value="מוגן" protectedValue />}
        >
          <SummaryCard title="יתרה לעובדים" value={formatCurrency(summary.totalWorkerOwed)} protectedValue />
        </SalaryProtected>
      </div>

      <SalaryProtected
        unlocked={salaryUnlocked}
        hasPasswordConfigured={hasPasswordConfigured}
        canUnlock={canViewSalary}
        onUnlockSuccess={loadProtectedData}
        fallback={
          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">{"פירוט לפי סוג עובד: מוגן"}</CardContent>
          </Card>
        }
      >
        <Card>
          <CardContent className="grid gap-3 py-4 sm:grid-cols-3">
            <MiniStat
              label="קבלנות"
              value={`${formatMinutes(summary.sessionOnlyMinutes)} • ${formatCurrency(summary.sessionOnlyAmount)}`}
            />
            <MiniStat
              label="שעתי עם תלוש"
              value={`${formatMinutes(summary.hourlyPayslipMinutes)} • ${formatCurrency(summary.hourlyPayslipAmount)}`}
            />
            <MiniStat
              label="חודשי גלובלי"
              value={`${summary.monthlyPayslipWorkers} עובדים • ${formatCurrency(summary.monthlyPayslipAmount)}`}
            />
          </CardContent>
        </Card>
      </SalaryProtected>

      <div className="flex flex-wrap-reverse items-center justify-between gap-3">
        <div className="flex flex-wrap justify-end gap-2">
          {canCreateUsers ? (
            <Button variant="outline" onClick={() => setCreateUserOpen(true)}>
              <Plus className="ms-2 h-4 w-4" />
              {"הוספת משתמש"}
            </Button>
          ) : null}
          {canManageAttendance ? (
            <Button onClick={() => openCreateSession()}>
              <Plus className="h-4 w-4" />
              {"הוספת משמרת"}
            </Button>
          ) : null}
          {false ? (
            <Button variant="outline" onClick={() => lockSalaryData()}>
              <LockKeyhole className="h-4 w-4" />
              {"נעילת נתוני שכר"}
            </Button>
          ) : null}
        </div>

        <Input
          name="payroll_worker_search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="חיפוש עובד לפי שם, אימייל או טלפון"
          autoComplete="off"
          spellCheck={false}
          data-lpignore="true"
          className="max-w-sm text-right"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="employees">{"עובדים"}</TabsTrigger>
          <TabsTrigger value="labor">{"פועלים"}</TabsTrigger>
          <TabsTrigger value="attendance">{"נוכחות"}</TabsTrigger>
          {canManageSalary ? <TabsTrigger value="agreements">{"משכורות"}</TabsTrigger> : null}
          {canManageSalary ? <TabsTrigger value="payslips">{"תקופות ותלושים"}</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="employees" className="space-y-3">
          <Card>
            <CardContent className="py-4">
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-right text-xs">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr className="border-b text-muted-foreground">
                      <th className="px-2 py-2 font-medium">פעולות</th>
                      <th className="px-2 py-2 font-medium">יתרה כוללת</th>
                      <th className="px-2 py-2 font-medium">שולם כולל</th>
                      <th className="px-2 py-2 font-medium">סטטוס תשלום</th>
                      <th className="px-2 py-2 font-medium">תלוש אחרון</th>
                      <th className="px-2 py-2 font-medium">עלות עבודה החודש</th>
                      <th className="px-2 py-2 font-medium">משכורת נוכחית</th>
                      <th className="px-2 py-2 font-medium">שעות החודש</th>
                      <th className="px-2 py-2 font-medium">סוג עובד</th>
                      <th className="px-2 py-2 font-medium">סטטוס</th>
                      <th className="px-2 py-2 font-medium">עובד</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeWorkers.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-2 py-6 text-center text-muted-foreground">
                          {"אין עובדים להצגה."}
                        </td>
                      </tr>
                    ) : (
                      employeeWorkers.map((worker, index) => {
                        const workerType = normalizePayrollWorkerType(worker.payroll_worker_type, worker.pay_tracking_mode);
                        const monthStats = currentMonthPayrollStatsByUserId.get(worker.id) ?? {
                          totalMinutes: 0,
                          totalAmount: 0,
                        };
                        const currentAgreement = getCurrentSalaryAgreement(agreementsByUserId.get(worker.id) ?? []);
                        const latestPayslip = [...(payslipsByUserId.get(worker.id) ?? [])].sort((a, b) =>
                          (periodsById.get(b.payroll_period_id)?.period_month ?? "").localeCompare(
                            periodsById.get(a.payroll_period_id)?.period_month ?? ""
                          )
                        )[0] ?? null;
                        const balance = effectiveWorkerBalancesByUserId.get(worker.id) ?? null;
                        const rowClass = index % 2 === 0 ? "bg-muted/20" : "bg-background";
                        const monthlyLaborCost = monthStats.totalAmount;

                        return (
                          <tr
                            key={worker.id}
                            className={`cursor-pointer border-b align-top hover:bg-muted/40 focus-visible:bg-muted/40 ${rowClass}`}
                            tabIndex={0}
                            role="button"
                            onClick={(event) => {
                              if (shouldIgnoreRowNavigation(event.target)) return;
                              emitNavigationStart();
                              router.push(`/payroll/workers/${worker.id}`);
                            }}
                            onKeyDown={(event) => {
                              if (shouldIgnoreRowNavigation(event.target)) return;
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              emitNavigationStart();
                              router.push(`/payroll/workers/${worker.id}`);
                            }}
                          >
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => { emitNavigationStart(); router.push(`/payroll/workers/${worker.id}`); }}>
                                  {"פרטים"}
                                </Button>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                {formatCurrency(balance?.owed_amount ?? 0)}
                              </SalaryProtected>
                            </td>
                            <td className="px-3 py-3">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                {formatCurrency(balance?.paid_amount ?? 0)}
                              </SalaryProtected>
                            </td>
                            <td className="px-2 py-2">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                <PaymentStatusBadge status={balance?.payment_status} owedAmount={balance?.owed_amount} />
                              </SalaryProtected>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">{latestPayslip ? formatCurrency(latestPayslip.gross_salary) : "-"}</td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                {formatCurrency(monthlyLaborCost)}
                              </SalaryProtected>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                {currentAgreement
                                  ? currentAgreement.salary_type === "hourly"
                                    ? `${formatCurrency(currentAgreement.hourly_rate)} / שעה`
                                    : formatCurrency(currentAgreement.monthly_salary)
                                  : "-"}
                              </SalaryProtected>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">{formatMinutes(monthStats.totalMinutes)}</td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <WorkerTypeBadge workerType={workerType} />
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex flex-col items-end gap-1">
                                <RoleBadge role={worker.role} />
                                <AccessBadge hasAccess={getWorkerAccessLabel(worker) === "עם גישה"} />
                                <StatusPill tone={worker.active === false ? "muted" : "success"}>
                                  {worker.active === false ? "לא פעיל" : "פעיל"}
                                </StatusPill>
                              </div>
                            </td>
                            <td className="px-2 py-2 font-medium w-[180px]">
                              <div className="flex flex-col items-end gap-1">
                                <div>{worker.full_name ?? worker.email ?? "עובד"}</div>
                                <div className="flex flex-col items-end text-muted-foreground break-all">
                                  {worker.email ? <div>{worker.email}</div> : null}
                                  {worker.phone ? <div>{worker.phone}</div> : null}
                                  {!worker.email && !worker.phone ? <div>ללא פרטי קשר</div> : null}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="labor" className="space-y-3">
          <Card>
            <CardContent className="py-4">
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-right text-xs">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr className="border-b text-muted-foreground">
                      <th className="px-2 py-2 font-medium">פעולות</th>
                      <th className="px-2 py-2 font-medium">יתרה כוללת</th>
                      <th className="px-2 py-2 font-medium">שולם כולל</th>
                      <th className="px-2 py-2 font-medium">סטטוס תשלום</th>
                      <th className="px-2 py-2 font-medium">שעות החודש</th>
                      <th className="px-2 py-2 font-medium">סוג עובד</th>
                      <th className="px-2 py-2 font-medium">סטטוס</th>
                      <th className="px-2 py-2 font-medium">פועל</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laborWorkers.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">
                          {"אין פועלים להצגה."}
                        </td>
                      </tr>
                    ) : (
                      laborWorkers.map((worker, index) => {
                        const workerType = normalizePayrollWorkerType(worker.payroll_worker_type, worker.pay_tracking_mode);
                        const monthStats = currentMonthPayrollStatsByUserId.get(worker.id) ?? {
                          totalMinutes: 0,
                          totalAmount: 0,
                        };
                        const balance = effectiveWorkerBalancesByUserId.get(worker.id) ?? null;
                        const rowClass = index % 2 === 0 ? "bg-muted/20" : "bg-background";

                        return (
                          <tr
                            key={worker.id}
                            className={`cursor-pointer border-b align-top hover:bg-muted/40 focus-visible:bg-muted/40 ${rowClass}`}
                            tabIndex={0}
                            role="button"
                            onClick={(event) => {
                              if (shouldIgnoreRowNavigation(event.target)) return;
                              emitNavigationStart();
                              router.push(`/payroll/workers/${worker.id}`);
                            }}
                            onKeyDown={(event) => {
                              if (shouldIgnoreRowNavigation(event.target)) return;
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              emitNavigationStart();
                              router.push(`/payroll/workers/${worker.id}`);
                            }}
                          >
                            <td className="px-2 py-2">
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => { emitNavigationStart(); router.push(`/payroll/workers/${worker.id}`); }}>
                                  {"פרטים"}
                                </Button>
                              </div>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                {formatCurrency(balance?.owed_amount ?? 0)}
                              </SalaryProtected>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                {formatCurrency(balance?.paid_amount ?? 0)}
                              </SalaryProtected>
                            </td>
                            <td className="px-2 py-2">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                <PaymentStatusBadge status={balance?.payment_status} owedAmount={balance?.owed_amount} />
                              </SalaryProtected>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">{formatMinutes(monthStats.totalMinutes)}</td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <WorkerTypeBadge workerType={workerType} />
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex flex-col items-end gap-1">
                                <StatusPill tone="warning">{"פועל"}</StatusPill>
                                <AccessBadge hasAccess={false} />
                                <StatusPill tone={worker.active === false ? "muted" : "success"}>
                                  {worker.active === false ? "לא פעיל" : "פעיל"}
                                </StatusPill>
                              </div>
                            </td>
                            <td className="px-2 py-2 font-medium w-[180px]">
                              <div className="flex flex-col items-end gap-1">
                                <div>{worker.full_name ?? worker.email ?? "פועל"}</div>
                                <div className="flex flex-col items-end text-muted-foreground break-all">
                                  {worker.email ? <div>{worker.email}</div> : null}
                                  {worker.phone ? <div>{worker.phone}</div> : null}
                                  {!worker.email && !worker.phone ? <div>ללא פרטי קשר</div> : null}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="space-y-3">
          <Card>
            <CardContent
              className="grid gap-3 py-5 md:grid-cols-3 xl:grid-cols-6"
              dir="rtl"
            >
              <Field label="עובד">
                <select
                  value={attendanceFilters.workerId}
                  onChange={(event) =>
                    setAttendanceFilters((current) => ({ ...current, workerId: event.target.value }))
                  }
                  className={selectClassName}
                >
                  <option value="">{"הכול"}</option>
                  {publicUsers
                    .filter((user) => user.role === "worker" || user.role === "worker_no_access")
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name ?? user.email ?? "עובד"}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="תחום">
                <select
                  value={attendanceFilters.businessDomain}
                  onChange={(event) =>
                    setAttendanceFilters((current) => ({ ...current, businessDomain: event.target.value }))
                  }
                  className={selectClassName}
                >
                  <option value="">{"הכול"}</option>
                  <option value="general_business">{"שוטף"}</option>
                  <option value="logistics_projects">{"פרויקטים"}</option>
                  <option value="property_management">{"נכסים"}</option>
                  <option value="sales">{"מכירות"}</option>
                  <option value="home">{"בית"}</option>
                  <option value="charity">{"צדקה"}</option>
                </select>
              </Field>
              <Field label="פרויקט">
                <select
                  value={attendanceFilters.projectId}
                  onChange={(event) =>
                    setAttendanceFilters((current) => ({ ...current, projectId: event.target.value }))
                  }
                  className={selectClassName}
                >
                  <option value="">{"הכול"}</option>
                  {projectOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="סטטוס">
                <select
                  value={attendanceFilters.status}
                  onChange={(event) =>
                    setAttendanceFilters((current) => ({ ...current, status: event.target.value }))
                  }
                  className={selectClassName}
                >
                  <option value="">{"הכול"}</option>
                  <option value="open">{"פתוח"}</option>
                  <option value="closed">{"סגור"}</option>
                  <option value="locked">{"נעול"}</option>
                  <option value="editable">{"ניתן לעריכה"}</option>
                </select>
              </Field>
            <Field label="מתאריך">
                <DateInput
                  name="attendance_date_from"
                  value={attendanceFilters.dateFrom}
                  onChange={(event) =>
                    setAttendanceFilters((current) => ({ ...current, dateFrom: event.target.value }))
                  }
                  autoComplete="off"
                />
              </Field>
            <Field label="עד תאריך">
                <DateInput
                  name="attendance_date_to"
                  value={attendanceFilters.dateTo}
                  onChange={(event) =>
                    setAttendanceFilters((current) => ({ ...current, dateTo: event.target.value }))
                  }
                  autoComplete="off"
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full text-right text-sm">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr className="border-b text-muted-foreground">
                      <th className="px-3 py-2 font-medium">פעולות</th>
                      <th className="px-3 py-2 font-medium">עלות עבודה</th>
                      <th className="px-3 py-2 font-medium">חיוב לקוח</th>
                      <th className="px-3 py-2 font-medium">משך</th>
                      <th className="px-3 py-2 font-medium">טווח</th>
                      <th className="px-3 py-2 font-medium">קישור</th>
                      <th className="px-3 py-2 font-medium">תחום</th>
                      <th className="px-3 py-2 font-medium">סטטוס</th>
                      <th className="px-3 py-2 font-medium">עובד</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSessions.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                          {"אין משמרות להצגה."}
                        </td>
                      </tr>
                    ) : (
                      filteredSessions.map((session, index) => {
                        const worker = usersById.get(session.user_id);
                        const linkLabel = getSessionLinkLabel(session, projectLabelsById, propertyLabelsById);
                        const rowClass = index % 2 === 0 ? "bg-muted/20" : "bg-background";
                        const rowWorkerType = worker
                          ? normalizePayrollWorkerType(worker.payroll_worker_type, worker.pay_tracking_mode)
                          : null;
                        const rowShowHours = shouldShowSessionHours(rowWorkerType);
                        const rowShowPrice = shouldShowSessionPrice(rowWorkerType);

                        return (
                          <tr key={session.id} className={`border-b align-top ${rowClass}`}>
                            <td className="px-3 py-3">
                              {canManageAttendance ? (
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => openEditSession(session)}
                                    aria-label="עריכה"
                                    className={SOLID_EDIT_BUTTON_CLASS}
                                    disabled={session.locked || isPending}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  {!session.clock_out ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => closeOpenSession(session.id)}
                                      disabled={session.locked || isPending}
                                    >
                                      {"סגירה"}
                                    </Button>
                                  ) : null}
                                  <Button
                                    variant="destructive"
                                    size="icon"
                                    onClick={() => deleteSession(session.id)}
                                    aria-label="מחיקה"
                                    disabled={session.locked || isPending}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {rowShowPrice ? (
                                <SalaryProtected
                                  unlocked={salaryUnlocked}
                                  hasPasswordConfigured={hasPasswordConfigured}
                                  canUnlock={canViewSalary}
                                  onUnlockSuccess={loadProtectedData}
                                  fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                                >
                                  <span className="font-medium">{formatCurrency(sessionCostsById.get(session.id) ?? 0)}</span>
                                </SalaryProtected>
                              ) : (
                                <span className="text-muted-foreground">אוטומטי</span>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {session.is_billable_to_customer
                                ? formatCurrency(session.bill_to_customer_amount)
                                : "לא לחיוב"}
                            </td>
                            <td className="px-3 py-3">
                              {rowShowHours ? formatMinutes(sessionWorkedMinutes(session)) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              <div>{rowShowHours ? formatSessionRange(session.clock_in, session.clock_out) : formatDate(session.clock_in)}</div>
                              {session.notes ? <div className="mt-1 text-xs">{session.notes}</div> : null}
                            </td>
                            <td className="px-3 py-3">{linkLabel}</td>
                            <td className="px-3 py-3">{getBusinessDomainLabel(session.business_domain)}</td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap justify-end gap-2">
                                <StatusPill tone={session.clock_out ? "success" : "warning"}>
                                  {session.clock_out ? "סגור" : "פתוח"}
                                </StatusPill>
                                <StatusPill tone={session.locked ? "danger" : "muted"}>
                                  {session.locked ? "נעול" : "ניתן לעריכה"}
                                </StatusPill>
                                {session.billing_status && session.is_billable_to_customer ? (
                                  <StatusPill tone={session.billing_status === "paid" ? "success" : "muted"}>
                                    {getBillingStatusLabel(session.billing_status)}
                                  </StatusPill>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-3 font-medium">
                              {worker?.full_name ?? worker?.email ?? "עובד"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agreements">
          <SalaryProtected
            unlocked={salaryUnlocked}
            hasPasswordConfigured={hasPasswordConfigured}
            canUnlock={canViewSalary}
            onUnlockSuccess={loadProtectedData}
          >
            <Card>
              <CardContent className="space-y-4 py-4">
                <div className="flex justify-end">
                  <Button onClick={() => openNewAgreementDialog()} disabled={isPending}>
                    <Plus className="ms-2 h-4 w-4" />
                    {"הוספת משכורת"}
                  </Button>
                </div>
                <div className="max-h-[70vh] overflow-auto">
                  <table className="w-full text-right text-sm">
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr className="border-b text-muted-foreground">
                        <th className="px-3 py-2 font-medium">פעולות</th>
                        <th className="px-3 py-2 font-medium">מצב</th>
                        <th className="px-3 py-2 font-medium">עד תאריך</th>
                        <th className="px-3 py-2 font-medium">מתאריך</th>
                        <th className="px-3 py-2 font-medium">סכום</th>
                        <th className="px-3 py-2 font-medium">סוג</th>
                        <th className="px-3 py-2 font-medium">עובד</th>
                      </tr>
                    </thead>
                    {agreementUsersWithAgreements.map((worker, workerIndex) => {
                      const workerAgreements = agreementsByUserId.get(worker.id) ?? [];
                      const current = getCurrentSalaryAgreement(workerAgreements);
                      const workerRowClass = workerIndex % 2 === 0 ? "bg-muted/20" : "bg-background";
                      const separatorClass = workerIndex > 0 ? "border-t-4 border-border/80" : "border-t-4 border-background";

                      return (
                        <tbody key={worker.id} className={separatorClass}>
                          {workerAgreements.map((agreement, index) => (
                            <tr
                              key={agreement.id}
                              className={
                                index === 0
                                  ? `border-b ${workerRowClass} align-top`
                                  : `border-b ${workerRowClass} align-top`
                              }
                            >
                              <td className="px-3 py-3">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => openEditAgreementDialog(agreement)}
                                    aria-label="עריכה"
                                    className={SOLID_EDIT_BUTTON_CLASS}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="icon"
                                    onClick={() => deleteAgreement(agreement)}
                                    aria-label="מחיקה"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                {current?.id === agreement.id ? <Tag>{"נוכחי"}</Tag> : <span className="text-muted-foreground">-</span>}
                              </td>
                              <td className="px-3 py-3 text-muted-foreground">{formatDate(agreement.valid_to)}</td>
                              <td className="px-3 py-3 text-muted-foreground">{formatDate(agreement.valid_from)}</td>
                              <td className="px-3 py-3 font-semibold">
                                {agreement.salary_type === "hourly"
                                  ? `${formatCurrency(agreement.hourly_rate)} / שעה`
                                  : formatCurrency(agreement.monthly_salary)}
                              </td>
                              <td className="px-3 py-3">{getSalaryTypeLabel(agreement.salary_type)}</td>
                              {index === 0 ? (
                                <td rowSpan={workerAgreements.length} className="px-3 py-3 align-top font-medium">
                                  {worker.full_name ?? worker.email ?? "עובד"}
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      );
                    })}
                  </table>
                </div>
              </CardContent>
            </Card>
          </SalaryProtected>
        </TabsContent>

        <TabsContent value="payslips">
          <SalaryProtected
            unlocked={salaryUnlocked}
            hasPasswordConfigured={hasPasswordConfigured}
            canUnlock={canViewSalary}
            onUnlockSuccess={loadProtectedData}
          >
            <div className="space-y-3">
              {/* Compact period header */}
              <Card>
                <CardContent className="py-4">
                  <div className="flex flex-wrap-reverse items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPeriodManagementDialogOpen(true)}>
                        {"ניהול תקופות"}
                      </Button>
                      {selectedPeriodId && (
                        <>
                          <Button size="sm" onClick={() => runPeriodAction("generate")} disabled={isPending}>
                            {"יצירת / רענון תלושים"}
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link href={selectedSalariedExportHref}>{"יצוא לאקסל"}</Link>
                          </Button>
                          {selectedPayslipPeriod && isPayrollPeriodEditable(selectedPayslipPeriod.status) && (
                            <Button size="sm" variant="outline" onClick={() => runPeriodAction("lock")} disabled={isPending}>
                              {"נעילה"}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                    <div className="text-right">
                      {selectedPayslipPeriod ? (
                        <div className="flex items-center gap-2 justify-end">
                          <Tag>{getPayrollPeriodLabel(selectedPayslipPeriod.status)}</Tag>
                          <div className="text-lg font-semibold">{monthLabelFromKey(selectedPayslipPeriod.period_month)}</div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">{"לא נבחרה תקופה — לחץ ניהול תקופות"}</div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Issues — only shown when there are actual problems */}
              {selectedPayslipPeriod && monthlyPayslipWorkersMissingAgreement.length > 0 && (
                <Card>
                  <CardContent className="py-4">
                    <div className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-4">
                      <div className="font-medium text-destructive">
                        {`עובדים חודשי גלובלי ללא הסכם שכר פעיל עבור ${monthLabelFromKey(selectedPayslipPeriod.period_month)}`}
                      </div>
                      <div className="flex flex-wrap justify-end gap-2 text-sm">
                        {monthlyPayslipWorkersMissingAgreement.map((worker) => (
                          <button
                            key={worker.id}
                            type="button"
                            onClick={() => { emitNavigationStart(); router.push(`/payroll/workers/${worker.id}`); }}
                            className="rounded-full border border-destructive/30 bg-background px-3 py-1 text-destructive transition hover:bg-destructive/10"
                          >
                            {worker.full_name ?? worker.email ?? "עובד"}
                          </button>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {"העובדים האלה מוגדרים כחודשי גלובלי, אבל אין להם הסכם חודשי פעיל לתקופה שנבחרה."}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Empty states */}
              {!selectedPayslipPeriod ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    {"לחץ ניהול תקופות כדי לבחור תקופת שכר."}
                  </CardContent>
                </Card>
              ) : selectedPeriodPayslips.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    {"עדיין לא נוצרו תלושים לתקופה הזאת. לחץ יצירת / רענון תלושים."}
                  </CardContent>
                </Card>
              ) : null}

              {selectedPeriodPayslips.map((payslip) => {
                const worker = usersById.get(payslip.user_id);
                const workerType = worker
                  ? normalizePayrollWorkerType(worker.payroll_worker_type, worker.pay_tracking_mode)
                  : null;
                const period = periodsById.get(payslip.payroll_period_id) ?? null;
                const isEditable = period ? isPayrollPeriodEditable(period.status) : false;
                const payslipDebtItem = workerDebtItemsBySourceKey.get(`payslip:${payslip.id}`) ?? null;
                const payslipOwedAmount = toNumber(payslipDebtItem?.owed_amount);
                const canRecordPayslipPayment = Boolean(payslipDebtItem) && payslipOwedAmount > 0;
                return (
                  <Card key={payslip.id}>
                    <CardContent className="space-y-3 py-5">
                      <div className="flex flex-wrap-reverse items-start justify-between gap-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          {workerType ? <WorkerTypeBadge workerType={workerType} /> : null}
                          <Tag>{getSalaryTypeLabel(payslip.calculated_salary_type)}</Tag>
                          <Tag>{period ? getPayrollPeriodLabel(period.status) : "-"}</Tag>
                        </div>
                        <div className="font-semibold">{worker?.full_name ?? worker?.email ?? "עובד"}</div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <MiniStat label="דקות עבודה" value={formatMinutes(payslip.total_work_minutes)} />
                        <MiniStat label="ברוטו" value={formatCurrency(payslip.gross_salary)} />
                      </div>

                      <div className="rounded-2xl border p-3 space-y-1 text-sm">
                        <div className="flex justify-between text-muted-foreground">
                          <span className="font-medium text-foreground">{formatCurrency(payslip.calculated_base_salary)}</span>
                          <span>שכר בסיס</span>
                        </div>
                        {payslipItems
                          .filter((item) => item.payslip_id === payslip.id)
                          .map((item) => {
                            const isException = isExceptionItemType(item.item_type);
                            const isNegative = toNumber(item.amount) < 0;
                            return (
                              <div key={item.id} className="flex items-center justify-between gap-2 py-0.5">
                                <div className="flex items-center gap-1.5">
                                  {isEditable && (
                                    <button
                                      type="button"
                                      onClick={() => deletePayslipItem(item.id, payslip.id)}
                                      disabled={isPending}
                                      className="text-muted-foreground hover:text-destructive transition-colors"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  <span className={isNegative || isException ? "text-destructive font-medium" : "font-medium"}>
                                    {formatCurrency(item.amount)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-right">
                                  {isException && <AlertTriangle className="h-3.5 w-3.5 text-warning-soft-foreground shrink-0" />}
                                  <span className="text-muted-foreground">{item.notes || getPayslipItemTypeLabel(item.item_type)}</span>
                                  <Badge variant="outline" className="text-xs px-1.5 py-0">{getPayslipItemTypeLabel(item.item_type)}</Badge>
                                </div>
                              </div>
                            );
                          })}
                        {toNumber(payslip.manual_adjustments) !== 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span className={toNumber(payslip.manual_adjustments) < 0 ? "text-destructive" : ""}>{formatCurrency(payslip.manual_adjustments)}</span>
                            <span>התאמה ידנית</span>
                          </div>
                        )}
                        <div className="flex justify-between font-semibold border-t pt-2 mt-1">
                          <span>{formatCurrency(payslip.gross_salary)}</span>
                          <span>ברוטו</span>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-[auto_1fr]">
                        <div className="flex items-end justify-end gap-2 md:order-1">
                          <Button
                            variant="secondary"
                            onClick={() => openPayslipPaymentDialog(payslip)}
                            disabled={!canRecordPayslipPayment || isPending}
                          >
                            {"רישום תשלום לתלוש"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => updatePayslip(payslip.id)}
                            disabled={!isEditable || isPending}
                          >
                            {"שמירת התאמה"}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setPayslipItemForm((current) => ({ ...current, payslip_id: payslip.id }))
                            }
                            disabled={!isEditable}
                          >
                            {"+ רכיב שכר"}
                          </Button>
                        </div>
                        <Field label="התאמה ידנית">
                          <Input
                            inputMode="decimal"
                            value={payslipAdjustmentDrafts[payslip.id] ?? String(payslip.manual_adjustments ?? 0)}
                            onChange={(event) =>
                              setPayslipAdjustmentDrafts((current) => ({
                                ...current,
                                [payslip.id]: event.target.value,
                              }))
                            }
                            disabled={!isEditable}
                          />
                        </Field>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

            </div>

            {/* Period Management Dialog */}
            <Dialog open={periodManagementDialogOpen} onOpenChange={setPeriodManagementDialogOpen}>
              <DialogContent className="max-h-[85vh] w-full overflow-y-auto text-right sm:max-w-lg" dir="rtl">
                <DialogHeader>
                  <DialogTitle>{"ניהול תקופות שכר"}</DialogTitle>
                  <DialogDescription>{"יצירת תקופה חדשה ובחירת תקופה לעבודה"}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <Field label="חודש לתקופה חדשה">
                      <Input
                        type="month"
                        value={periodMonth}
                        onChange={(event) => setPeriodMonth(event.target.value)}
                      />
                    </Field>
                    <div className="flex items-end">
                      <Button
                        onClick={() => {
                          createOrOpenPeriod();
                          setPeriodManagementDialogOpen(false);
                        }}
                        disabled={isPending}
                      >
                        {"יצירה / פתיחה מחדש"}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {protectedPeriods.length === 0 ? (
                      <div className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                        {"עדיין לא נוצרו תקופות שכר."}
                      </div>
                    ) : (
                      protectedPeriods.map((period) => {
                        const isSelected = period.id === selectedPeriodId;
                        return (
                          <div
                            key={period.id}
                            className={`flex flex-wrap-reverse items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                              isSelected ? "border-primary bg-primary/5" : "bg-background"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <Tag>{getPayrollPeriodLabel(period.status)}</Tag>
                              <Button
                                size="sm"
                                variant={isSelected ? "default" : "outline"}
                                onClick={() => {
                                  setSelectedPeriodId(period.id);
                                  setPeriodManagementDialogOpen(false);
                                }}
                              >
                                {isSelected ? "נבחרה" : "בחירה"}
                              </Button>
                            </div>
                            <div className="text-right">
                              <div className="font-semibold">{monthLabelFromKey(period.period_month)}</div>
                              <div className="text-sm text-muted-foreground">
                                {`${formatDate(period.start_date)} - ${formatDate(period.end_date)}`}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Add Payslip Item Dialog */}
            <Dialog
              open={!!payslipItemForm.payslip_id}
              onOpenChange={(open) => {
                if (!open) setPayslipItemForm(DEFAULT_PAYSLIP_ITEM_FORM);
              }}
            >
              <DialogContent className="w-full text-right sm:max-w-lg" dir="rtl">
                <DialogHeader>
                  <DialogTitle>{"הוספת רכיב שכר"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="סוג רכיב">
                      <select
                        value={payslipItemForm.item_type}
                        onChange={(event) =>
                          setPayslipItemForm((current) => ({ ...current, item_type: event.target.value }))
                        }
                        className={selectClassName}
                      >
                        {PAYSLIP_ITEM_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="סכום (שלילי = ניכוי)">
                      <Input
                        inputMode="decimal"
                        placeholder="לדוגמה: 500 או -200"
                        value={payslipItemForm.amount}
                        onChange={(event) =>
                          setPayslipItemForm((current) => ({ ...current, amount: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="תיאור">
                      <Input
                        placeholder="תיאור אופציונלי"
                        value={payslipItemForm.notes}
                        onChange={(event) =>
                          setPayslipItemForm((current) => ({ ...current, notes: event.target.value }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button onClick={() => addPayslipItem()} disabled={isPending}>
                      {"הוספת רכיב"}
                    </Button>
                    <Button variant="outline" onClick={() => setPayslipItemForm(DEFAULT_PAYSLIP_ITEM_FORM)}>
                      {"ביטול"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </SalaryProtected>
        </TabsContent>
      </Tabs>
      </> : null}

      {isWorkerDetailMode && !selectedWorker ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {"העובד לא נמצא או שאין הרשאה לצפות בו."}
          </CardContent>
        </Card>
      ) : null}

      {isWorkerDetailMode && selectedWorker ? (
        <section className="text-right" dir="rtl">
          <div className="mt-2 space-y-5">
                <Card>
                  <CardContent className="space-y-3 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2 text-sm">
                        <div className="flex items-center gap-2 rounded-lg border bg-muted/10 px-3 py-1.5">
                          <span className="text-muted-foreground">שם מלא</span>
                          <span className="font-medium">{selectedWorker.full_name ?? "—"}</span>
                        </div>
                        {selectedWorker.system_access !== false ? (
                          <div className="flex items-center gap-2 rounded-lg border bg-muted/10 px-3 py-1.5">
                            <span className="text-muted-foreground">אימייל</span>
                            <span className="font-medium">{selectedWorker.email ?? "—"}</span>
                          </div>
                        ) : null}
                        <div className="flex items-center gap-2 rounded-lg border bg-muted/10 px-3 py-1.5">
                          <span className="text-muted-foreground">טלפון</span>
                          <span className="font-medium">{selectedWorker.phone ?? "—"}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg border bg-muted/10 px-3 py-1.5">
                          <span className="text-muted-foreground">תפקיד</span>
                          <span className="font-medium">{getRoleLabel(selectedWorker.role)}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg border bg-muted/10 px-3 py-1.5">
                          <span className="text-muted-foreground">סטטוס</span>
                          <span className="font-medium">{selectedWorker.active === false ? "לא פעיל" : "פעיל"}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg border bg-muted/10 px-3 py-1.5">
                          <span className="text-muted-foreground">סוג עובד</span>
                          <span className="font-medium">
                            {selectedWorkerType ? getPayrollWorkerTypeLabel(selectedWorkerType) : "—"}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {canManageAttendance && selectedWorkerType && payrollWorkerTypeAllowsSessions(selectedWorkerType) ? (
                          <Button variant="outline" onClick={() => openCreateSession(selectedWorkerId)} disabled={isPending}>
                            {"הוסף משמרת"}
                          </Button>
                        ) : null}
                        {canCreateUsers ? (
                          <Button onClick={() => setWorkerAccessDialogOpen(true)} disabled={isPending}>
                            {"עדכון פרטי עובד"}
                          </Button>
                        ) : null}
                        {canCreateUsers ? (
                          <Button variant="destructive" onClick={() => deleteSelectedWorker()} disabled={isPending}>
                            {"מחק עובד"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <SalaryProtected
                  unlocked={salaryUnlocked}
                  hasPasswordConfigured={hasPasswordConfigured}
                  canUnlock={canViewSalary}
                  onUnlockSuccess={loadProtectedData}
                >
                  <Card>
                    <CardContent className="py-4">
                      <div className="grid gap-3 sm:grid-cols-4">
                        <MiniStat label="סה״כ נצבר" value={formatCurrency(selectedWorkerBalance?.earned_amount ?? 0)} />
                        <MiniStat label="שולם כולל" value={formatCurrency(selectedWorkerBalance?.paid_amount ?? 0)} />
                        <MiniStat label="יתרה כוללת" value={formatCurrency(selectedWorkerBalance?.owed_amount ?? 0)} />
                        <MiniStat
                          label="סטטוס"
                          value={sharedPaymentStatusLabel(selectedWorkerBalance?.payment_status)}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </SalaryProtected>

                <Card>
                  <CardContent className="py-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="חודש">
                        <select
                          value={workerPrintFilters.month}
                          onChange={(event) =>
                            setWorkerPrintFilters((current) => ({ ...current, month: event.target.value }))
                          }
                          className={selectClassName}
                        >
                          <option value="">כל החודשים</option>
                          {Array.from({ length: 12 }, (_, index) => {
                            const monthValue = String(index + 1).padStart(2, "0");
                            return (
                              <option key={monthValue} value={monthValue}>
                                {formatMonthYearLabel(workerPrintFilters.year || String(new Date().getFullYear()), monthValue, false)}
                              </option>
                            );
                          })}
                        </select>
                      </Field>
                      <Field label="שנה">
                        <select
                          value={workerPrintFilters.year}
                          onChange={(event) =>
                            setWorkerPrintFilters((current) => ({ ...current, year: event.target.value }))
                          }
                          className={selectClassName}
                        >
                          <option value="">כל השנים</option>
                          {selectedWorkerPrintYearOptions.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  </CardContent>
                </Card>

                <Tabs defaultValue={canManageSalary ? "finances" : "attendance"} dir="rtl">
                  <TabsList>
                    {canManageSalary ? <TabsTrigger value="finances">{"כספים"}</TabsTrigger> : null}
                    <TabsTrigger value="attendance">{"נוכחות"}</TabsTrigger>
                    {canSelectedWorkerHaveAgreement && canManageSalary ? (
                      <TabsTrigger value="salary">{"שכר"}</TabsTrigger>
                    ) : null}
                    <TabsTrigger value="print">{"הדפסה"}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="finances" className="space-y-5">
                <SalaryProtected
                  unlocked={salaryUnlocked}
                  hasPasswordConfigured={hasPasswordConfigured}
                  canUnlock={canViewSalary}
                  onUnlockSuccess={loadProtectedData}
                >
                  <Card>
                    <CardContent className="space-y-4 py-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-lg font-semibold">כספים</div>
                        <Button onClick={() => openWorkerPaymentDialog()} disabled={isPending || selectedWorkerOpenDebtItems.length === 0}>
                          הוספת תשלום
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <div className="font-medium">היסטוריית תשלומים</div>
                        {selectedWorkerPaymentsByPeriod.length === 0 ? (
                          <div className="text-sm text-muted-foreground">אין תשלומים בתקופה שנבחרה.</div>
                        ) : (
                          selectedWorkerPaymentsByPeriod.map((payment) => (
                            <div key={payment.id} className="rounded-xl border px-3 py-2 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                <div className="font-medium">{formatCurrency(payment.amount)}</div>
                                <div className="text-muted-foreground">{formatDate(payment.payment_date)}</div>
                                <div className="text-muted-foreground">
                                  {[payment.payment_method, payment.reference_number].filter(Boolean).join(" • ") || "ללא פירוט"}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button variant="outline" size="sm" onClick={() => openEditWorkerPaymentDialog(payment)}>
                                    {"ערוך"}
                                  </Button>
                                  <Button variant="destructive" size="sm" onClick={() => deleteWorkerPayment(payment)}>
                                    {"מחק"}
                                  </Button>
                                </div>
                              </div>
                              {payment.notes ? <div className="mt-1 text-xs text-muted-foreground">{payment.notes}</div> : null}
                              {workerPaymentRecordedByNameById[payment.id] ? (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {`הוזן ע״י ${workerPaymentRecordedByNameById[payment.id]}`}
                                </div>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </SalaryProtected>
                  </TabsContent>

                  <TabsContent value="attendance" className="space-y-5">
                <Card>
                  <CardContent className="space-y-5 py-5">
                    <div className="text-lg font-semibold">{"נוכחות"}</div>
                    <Field label="פרויקט">
                      <select
                        value={sessionsProjectId}
                        onChange={(event) => setSessionsProjectId(event.target.value)}
                        className={selectClassName}
                      >
                        <option value="">כל הפרויקטים</option>
                        {selectedWorkerProjectOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className={`grid gap-3 ${shouldShowSessionHours(selectedWorkerType) ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                      {shouldShowSessionHours(selectedWorkerType) ? (
                        <MiniStat
                          label="שעות בתקופה"
                          value={formatMinutes(selectedWorkerFilteredStats.totalMinutes)}
                        />
                      ) : null}
                      <MiniStat label="משמרות בתקופה" value={String(selectedWorkerFilteredStats.sessionCount)} />
                      <MiniStat label="עלות בתקופה" value={formatCurrency(selectedWorkerFilteredStats.totalAmount)} />
                    </div>
                    <div className="space-y-2">
                      {selectedWorkerSessionsByFilter.length === 0 ? (
                        <div className="text-sm text-muted-foreground">אין משמרות בתקופה שנבחרה.</div>
                      ) : null}
                      {selectedWorkerSessionsByFilter.map((session) => (
                        <div key={session.id} className="rounded-xl border px-3 py-2 text-sm">
                          {(() => {
                            const payrollPeriod = getSessionPayrollPeriod(session);
                            const debtItem = workerDebtItemsBySourceKey.get(`session:${session.id}`) ?? null;
                            return (
                              <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Tag>{getBusinessDomainLabel(session.business_domain)}</Tag>
                              <Tag>{session.locked ? "נעול" : "פתוח לעריכה"}</Tag>
                              {payrollPeriod ? <Tag>{getPayrollPeriodLabel(payrollPeriod.status)}</Tag> : null}
                              {debtItem ? (
                                <PaymentStatusBadge
                                  status={debtItem.payment_status}
                                  owedAmount={debtItem.owed_amount}
                                />
                              ) : null}
                            </div>
                            <div className="text-right">{`${formatDateTime(session.clock_in)}${session.clock_out ? ` - ${formatDateTime(session.clock_out)}` : ""}`}</div>
                          </div>
                          <div className="mt-1 text-right text-muted-foreground">
                            {`${formatMinutes(sessionWorkedMinutes(session))} • ${getSessionLinkLabel(
                              session,
                              projectLabelsById,
                              propertyLabelsById
                            )}`}
                          </div>
                          <div className="mt-1 text-right text-muted-foreground">
                            {`עלות עבודה: ${formatCurrency(sessionCostsById.get(session.id) ?? 0)}${
                              payrollPeriod ? ` • תקופה: ${monthLabelFromKey(payrollPeriod.period_month)}` : ""
                            }`}
                          </div>
                          {session.notes ? (
                            <div className="mt-1 text-right text-muted-foreground">{`הערות: ${session.notes}`}</div>
                          ) : null}
                          {sessionRecordedByNameById[session.id] ? (
                            <div className="mt-1 text-right text-xs text-muted-foreground">
                              {`הוזן ע״י ${sessionRecordedByNameById[session.id]}`}
                            </div>
                          ) : null}
                          {debtItem ? (
                            <div className="mt-1 flex flex-wrap justify-end gap-3 text-xs text-muted-foreground">
                              <span>{`שולם: ${formatCurrency(debtItem.paid_amount)}`}</span>
                              <span>{`יתרה: ${formatCurrency(debtItem.owed_amount)}`}</span>
                            </div>
                          ) : null}
                          {!session.locked ? (
                            <div className="mt-1 flex flex-wrap justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => openEditSession(session)}>
                                {"עריכה"}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => deleteSession(session.id)}>
                                {"מחיקה"}
                              </Button>
                            </div>
                          ) : null}
                              </>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                  </TabsContent>

                  {canSelectedWorkerHaveAgreement ? (
                    <TabsContent value="salary" className="space-y-5">
                <SalaryProtected
                  unlocked={salaryUnlocked}
                  hasPasswordConfigured={hasPasswordConfigured}
                  canUnlock={canViewSalary}
                  onUnlockSuccess={loadProtectedData}
                >
                    <Card>
                      <CardContent className="space-y-3 py-4">
                        <div className="text-lg font-semibold">{"שכר"}</div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            onClick={() =>
                              openNewAgreementDialog(
                                selectedWorker.id,
                                getCurrentSalaryAgreement(agreementsByUserId.get(selectedWorker.id) ?? [])
                              )
                            }
                            disabled={isPending}
                          >
                            <Plus className="ms-2 h-4 w-4" />
                            {"הוספת משכורת חדשה"}
                          </Button>
                          <Button variant="outline" onClick={() => setOverrideDialogOpen(true)} disabled={isPending}>
                            {"הוספת החרגה"}
                          </Button>
                        </div>

                        <div className="space-y-3">
                          <div className="font-medium">{"היסטוריית משכורות"}</div>
                            {(agreementsByUserId.get(selectedWorker.id) ?? []).map((agreement) => (
                              <div
                                key={agreement.id}
                                className="grid gap-1 rounded-lg border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                              >
                                <div className="min-w-0 text-right">
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <span className="font-medium">{getSalaryTypeLabel(agreement.salary_type)}</span>
                                    {getCurrentSalaryAgreement(agreementsByUserId.get(selectedWorker.id) ?? [])?.id === agreement.id ? (
                                      <Tag>{"נוכחי"}</Tag>
                                    ) : null}
                                    <span className="text-muted-foreground">
                                      {`${formatDate(agreement.valid_from)} - ${formatDate(agreement.valid_to)}`}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {`שעות תקניות: ${agreement.standard_daily_hours ?? "0"} • נוספות: ${formatCurrency(agreement.overtime_rate)}`}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {`לתשלום עד יום ${agreement.due_day_of_next_month ?? 10} בחודש הבא`}
                                  </div>
                                  {agreement.notes ? (
                                    <div className="mt-1 text-xs text-muted-foreground">{agreement.notes}</div>
                                  ) : null}
                                </div>
                                <div className="text-right font-semibold">
                                  {agreement.salary_type === "hourly"
                                    ? `${formatCurrency(agreement.hourly_rate)} / שעה`
                                    : formatCurrency(agreement.monthly_salary)}
                                </div>
                              </div>
                            ))}

                          <div className="font-medium">{"החרגות שכר שעתי"}</div>
                          {selectedWorkerOverrides.length === 0 ? (
                            <div className="text-sm text-muted-foreground">{"אין חריגות שכר."}</div>
                          ) : (
                            selectedWorkerOverrides.map((override, index) => (
                              <div
                                key={`${override.created_at ?? "override"}-${index}`}
                                className="grid gap-1 rounded-lg border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                              >
                                <div className="min-w-0 text-right">
                                  <div className="text-muted-foreground text-xs">
                                    {override.start_time ? formatDate(override.start_time.slice(0, 10)) : ""}
                                    {override.end_time ? ` — ${formatDate(override.end_time.slice(0, 10))}` : " (פתוח)"}
                                  </div>
                                  {override.reason ? (
                                    <div className="font-medium">{override.reason}</div>
                                  ) : null}
                                  {override.notes ? (
                                    <div className="text-xs text-muted-foreground">{override.notes}</div>
                                  ) : null}
                                </div>
                                <div className="text-right font-semibold">{`${formatCurrency(override.override_hourly_rate)} / שעה`}</div>
                              </div>
                            ))
                          )}

                          <div className="font-medium">{"תלושים"}</div>
                          {isSelectedWorkerSalaryTracked ? (
                            <>
                          {(payslipsByUserId.get(selectedWorker.id) ?? []).length === 0 ? (
                            <div className="text-sm text-muted-foreground">{"אין תלושים לעובד הזה כרגע."}</div>
                          ) : (
                            (payslipsByUserId.get(selectedWorker.id) ?? []).map((payslip) => {
                              const period = periodsById.get(payslip.payroll_period_id);
                              return (
                                <div
                                  key={payslip.id}
                                  className="grid gap-1 rounded-lg border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                                >
                                  <div className="min-w-0 text-right">
                                    <div className="font-medium">{period ? monthLabelFromKey(period.period_month) : "תקופה"}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {`${formatMinutes(payslip.total_work_minutes)} • ${getSalaryTypeLabel(
                                        payslip.calculated_salary_type
                                      )}`}
                                    </div>
                                  </div>
                                  <div className="text-right font-semibold">{formatCurrency(payslip.gross_salary)}</div>
                                </div>
                              );
                            })
                          )}

                          {selectedPeriodId ? (
                            <Button onClick={() => generateWorkerPayslip(selectedWorker.id)} disabled={isPending}>
                              {"יצירת / חישוב תלוש לתקופה שנבחרה"}
                            </Button>
                          ) : null}
                            </>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                </SalaryProtected>
                    </TabsContent>
                  ) : null}

                  <TabsContent value="print" className="space-y-5">
                    <Card>
                      <CardContent className="space-y-4 py-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-lg font-semibold">הדפסה</div>
                          <Button onClick={() => printSelectedWorkerSummary()}>
                            הדפסת סיכום לעובד
                          </Button>
                        </div>
                        <Field label="פרויקט">
                          <select
                            value={workerPrintFilters.projectId}
                            onChange={(event) =>
                              setWorkerPrintFilters((current) => ({ ...current, projectId: event.target.value }))
                            }
                            className={selectClassName}
                          >
                            <option value="">כל הפרויקטים</option>
                            {selectedWorkerProjectOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="text-sm text-muted-foreground">
                          {`בהדפסה יופיעו ${selectedWorkerPrintSessions.length} משמרות ו-${selectedWorkerPrintPayments.length} תשלומים עבור ${selectedWorkerProjectOptions.find((option) => option.id === workerPrintFilters.projectId)?.label ?? "כל הפרויקטים"}, ${formatPrintPeriodLabel(workerPrintFilters.year, workerPrintFilters.month)}.`}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="space-y-4 py-5 text-right">
                        <div className="space-y-1 border-b pb-3">
                          <div className="text-base font-semibold">תצוגה מקדימה</div>
                          <div className="text-sm">
                            <span className="font-medium">{selectedWorker.full_name ?? selectedWorker.email ?? "עובד"}</span>
                            {selectedWorker.phone ? <span className="text-muted-foreground"> • {selectedWorker.phone}</span> : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {`פרויקט: ${selectedWorkerProjectOptions.find((option) => option.id === workerPrintFilters.projectId)?.label ?? "כל הפרויקטים"} • תקופה: ${formatPrintPeriodLabel(workerPrintFilters.year, workerPrintFilters.month)}`}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <MiniStat label="סה״כ נצבר לתקופה" value={formatCurrency(selectedWorkerPrintSummary.earned)} />
                          <MiniStat label="סה״כ שולם לתקופה" value={formatCurrency(selectedWorkerPrintSummary.paid)} />
                          <MiniStat label="יתרה לתשלום" value={formatCurrency(selectedWorkerPrintSummary.owed)} />
                        </div>

                        <div className="space-y-2">
                          <div className="font-medium">פירוט עבודה</div>
                          {selectedWorkerPrintSessions.length === 0 ? (
                            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                              אין משמרות להצגה במסננים שנבחרו.
                            </div>
                          ) : (
                            <div className="max-h-[70vh] overflow-auto rounded-md border">
                              <table className="w-full text-sm">
                                <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                                  <tr>
                                    <th className="px-2 py-2 text-right font-medium">תאריך</th>
                                    <th className="px-2 py-2 text-right font-medium">שעות</th>
                                    <th className="px-2 py-2 text-right font-medium">פרויקט / נכס</th>
                                    <th className="px-2 py-2 text-right font-medium">עלות</th>
                                    <th className="px-2 py-2 text-right font-medium">הערות</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {selectedWorkerPrintSessions.map((session) => (
                                    <tr key={session.id}>
                                      <td className="px-2 py-2 whitespace-nowrap">{formatDate(session.clock_in)}</td>
                                      <td className="px-2 py-2 whitespace-nowrap">{formatMinutes(sessionWorkedMinutes(session))}</td>
                                      <td className="px-2 py-2">{getSessionLinkLabel(session, projectLabelsById, propertyLabelsById)}</td>
                                      <td className="px-2 py-2 whitespace-nowrap">{formatCurrency(sessionCostsById.get(session.id) ?? 0)}</td>
                                      <td className="px-2 py-2 text-muted-foreground">{session.notes || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <div className="font-medium">פירוט תשלומים</div>
                          {selectedWorkerPrintPayments.length === 0 ? (
                            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                              אין תשלומים להצגה במסננים שנבחרו.
                            </div>
                          ) : (
                            <div className="max-h-[70vh] overflow-auto rounded-md border">
                              <table className="w-full text-sm">
                                <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                                  <tr>
                                    <th className="px-2 py-2 text-right font-medium">תאריך</th>
                                    <th className="px-2 py-2 text-right font-medium">סכום</th>
                                    <th className="px-2 py-2 text-right font-medium">איך שולם</th>
                                    <th className="px-2 py-2 text-right font-medium">הערות</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {selectedWorkerPrintPayments.map(({ payment, scopedAmount }) => (
                                    <tr key={payment.id}>
                                      <td className="px-2 py-2 whitespace-nowrap">{formatDate(payment.payment_date)}</td>
                                      <td className="px-2 py-2 whitespace-nowrap">{formatCurrency(scopedAmount)}</td>
                                      <td className="px-2 py-2">
                                        {[payment.payment_method, payment.reference_number].filter(Boolean).join(" • ") || "ללא פירוט"}
                                      </td>
                                      <td className="px-2 py-2 text-muted-foreground">{payment.notes || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
          </div>
        </section>
      ) : null}

      <Dialog
        open={workerAccessDialogOpen}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          setWorkerAccessDialogOpen(open);
        }}
      >
        <DialogContent dir="rtl" className="max-w-xl">
          <DialogHeader className="text-right">
            <DialogTitle>{"עדכון פרטי עובד"}</DialogTitle>
            <DialogDescription>{"עדכון פרטים אישיים, תפקיד, סטטוס וגישה למערכת."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="שם מלא">
              <Input
                value={workerForm.full_name}
                onChange={(event) => setWorkerForm((current) => ({ ...current, full_name: event.target.value }))}
              />
            </Field>
            <Field label="אימייל">
              <Input
                value={workerForm.email}
                onChange={(event) => setWorkerForm((current) => ({ ...current, email: event.target.value }))}
              />
            </Field>
            <Field label="טלפון">
              <Input
                value={workerForm.phone}
                onChange={(event) => setWorkerForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </Field>
            <Field label="תפקיד">
              <select
                value={workerForm.role}
                onChange={(event) =>
                  setWorkerForm((current) => ({
                    ...current,
                    role: event.target.value as WorkerFormState["role"],
                    system_access: event.target.value === "worker_no_access" ? false : current.system_access,
                  }))
                }
                className={selectClassName}
              >
                <option value="admin">{"מנהל"}</option>
                <option value="office">{"משרד"}</option>
                <option value="worker">{"עובד"}</option>
                <option value="worker_no_access">{"עובד ללא גישה"}</option>
              </select>
            </Field>
            <Field label="פעיל">
              <select
                value={workerForm.active ? "yes" : "no"}
                onChange={(event) =>
                  setWorkerForm((current) => ({ ...current, active: event.target.value === "yes" }))
                }
                className={selectClassName}
              >
                <option value="yes">{"כן"}</option>
                <option value="no">{"לא"}</option>
              </select>
            </Field>
            <Field label="סוג עובד">
              <select
                value={workerForm.payroll_worker_type}
                onChange={(event) =>
                  setWorkerForm((current) => ({
                    ...current,
                    payroll_worker_type: event.target.value as WorkerFormState["payroll_worker_type"],
                  }))
                }
                className={selectClassName}
              >
                <option value="session_only">{"קבלנות"}</option>
                <option value="monthly_payslip">{"חודשי גלובלי"}</option>
                <option value="hourly_payslip">{"שעתי עם תלוש"}</option>
              </select>
            </Field>
            <Field label="גישה למערכת">
              <select
                value={workerForm.system_access ? "yes" : "no"}
                onChange={(event) =>
                  setWorkerForm((current) => ({ ...current, system_access: event.target.value === "yes" }))
                }
                disabled={workerForm.role === "worker_no_access"}
                className={selectClassName}
              >
                <option value="yes">{"כן"}</option>
                <option value="no">{"לא"}</option>
              </select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={() => deleteSelectedWorker()} disabled={isPending}>
              {"מחק עובד"}
            </Button>
            <Button variant="outline" onClick={() => setWorkerAccessDialogOpen(false)} disabled={isPending}>
              {"ביטול"}
            </Button>
            <Button
              onClick={() => {
                saveWorkerAccess();
              }}
              disabled={isPending}
            >
              {"שמירה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={agreementDialogOpen}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          setAgreementDialogOpen(open);
        }}
      >
          <DialogContent dir="rtl" className="max-w-4xl">
          <DialogHeader className="text-right">
            <DialogTitle>{agreementForm.agreement_id ? "עריכת משכורת" : "הוספת משכורת"}</DialogTitle>
            <DialogDescription>
              {agreementForm.agreement_id ? "עדכון משכורת קיימת." : "הוספת משכורת חדשה ובחירת עובד."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="עובד">
              <select
                value={agreementForm.user_id}
                onChange={(event) =>
                  setAgreementForm((current) => ({ ...current, user_id: event.target.value }))
                }
                className={selectClassName}
                disabled={Boolean(agreementForm.agreement_id)}
              >
                <option value="">{"בחירת עובד"}</option>
                {allAgreementEligibleUsers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.full_name ?? worker.email ?? "עובד"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="סוג שכר">
              <select
                value={agreementForm.salary_type}
                onChange={(event) =>
                  setAgreementForm((current) => ({
                    ...current,
                    salary_type: event.target.value as "hourly" | "monthly",
                  }))
                }
                className={selectClassName}
              >
                <option value="hourly">{"שעתי"}</option>
                <option value="monthly">{"חודשי"}</option>
              </select>
            </Field>
            <Field label="בתוקף מתאריך">
              <DateInput
                value={agreementForm.valid_from}
                onChange={(event) =>
                  setAgreementForm((current) => ({ ...current, valid_from: event.target.value }))
                }
              />
            </Field>
            {agreementForm.salary_type === "hourly" ? (
              <Field label="תעריף שעתי">
                <Input
                  inputMode="decimal"
                  value={agreementForm.hourly_rate}
                  onChange={(event) =>
                    setAgreementForm((current) => ({ ...current, hourly_rate: event.target.value }))
                  }
                />
              </Field>
            ) : (
              <Field label="שכר חודשי">
                <Input
                  inputMode="decimal"
                  value={agreementForm.monthly_salary}
                  onChange={(event) =>
                    setAgreementForm((current) => ({ ...current, monthly_salary: event.target.value }))
                  }
                />
              </Field>
            )}
            <Field label="תעריף שעות נוספות">
              <Input
                inputMode="decimal"
                value={agreementForm.overtime_rate}
                onChange={(event) =>
                  setAgreementForm((current) => ({ ...current, overtime_rate: event.target.value }))
                }
              />
            </Field>
            <Field label="שעות יומיות תקניות">
              <Input
                type="number"
                min="0"
                step="0.25"
                inputMode="decimal"
                value={agreementForm.standard_daily_hours}
                onChange={(event) =>
                  setAgreementForm((current) => ({ ...current, standard_daily_hours: event.target.value }))
                }
              />
              {!agreementStandardDailyHoursValid ? (
                <div className="mt-1 text-xs text-destructive">יש להזין ערך גדול מ-0 לפני שמירה.</div>
              ) : null}
            </Field>
            <Field label="יום תשלום בחודש הבא">
              <Input
                type="number"
                min="1"
                max="31"
                step="1"
                inputMode="numeric"
                value={agreementForm.due_day_of_next_month}
                onChange={(event) =>
                  setAgreementForm((current) => ({ ...current, due_day_of_next_month: event.target.value }))
                }
              />
              {!agreementDueDayValid ? (
                <div className="mt-1 text-xs text-destructive">יש להזין מספר שלם בין 1 ל-31.</div>
              ) : (
                <div className="mt-1 text-xs text-muted-foreground">למשל 10 = לתשלום עד 10 בחודש הבא.</div>
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field label="הערות">
                <Textarea
                  rows={3}
                  value={agreementForm.notes}
                  onChange={(event) =>
                    setAgreementForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAgreementDialogOpen(false)} disabled={isPending}>
              {"ביטול"}
            </Button>
            <Button
              onClick={saveAgreement}
              disabled={isPending || !agreementStandardDailyHoursValid || !agreementDueDayValid}
            >
              {agreementForm.agreement_id ? "שמירת שינויים" : "שמירת משכורת"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={overrideDialogOpen}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          setOverrideDialogOpen(open);
        }}
      >
        <DialogContent dir="rtl" className="max-w-xl">
          <DialogHeader className="text-right">
            <DialogTitle>{"הוספת חריגת שכר שעתי"}</DialogTitle>
            <DialogDescription>{"תעריף שונה שיחול על העובד בטווח זמן מוגדר."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="תעריף שעתי חריג (₪)">
              <Input
                inputMode="decimal"
                placeholder="לדוגמה: 60"
                value={overrideForm.override_hourly_rate}
                onChange={(event) =>
                  setOverrideForm((current) => ({
                    ...current,
                    override_hourly_rate: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="סיבה">
              <Input
                placeholder="לדוגמה: פרויקט מיוחד"
                value={overrideForm.reason}
                onChange={(event) =>
                  setOverrideForm((current) => ({ ...current, reason: event.target.value }))
                }
              />
            </Field>
            <Field label="תאריך התחלה">
              <DateInput
                value={overrideForm.start_time}
                onChange={(event) =>
                  setOverrideForm((current) => ({ ...current, start_time: event.target.value }))
                }
              />
            </Field>
            <Field label="תאריך סיום (אופציונלי)">
              <DateInput
                value={overrideForm.end_time}
                onChange={(event) =>
                  setOverrideForm((current) => ({ ...current, end_time: event.target.value }))
                }
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="הערות">
                <Input
                  placeholder="הערות נוספות"
                  value={overrideForm.notes}
                  onChange={(event) =>
                    setOverrideForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialogOpen(false)} disabled={isPending}>
              {"ביטול"}
            </Button>
            <Button onClick={() => saveOverride()} disabled={isPending}>
              {"שמירת חריגה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createUserOpen}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          setCreateUserOpen(open);
          if (!open) resetCreateUserForm();
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader className="text-right">
            <DialogTitle>{"הוספת משתמש"}</DialogTitle>
            <DialogDescription>
              {"אפשר ליצור מכאן עובד, פועל, משרד או מנהל, עם סטטוס פעיל וגישה למערכת לפי הצורך."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="שם מלא">
              <Input
                value={createUserForm.full_name}
                onChange={(event) =>
                  setCreateUserForm((current) => ({ ...current, full_name: event.target.value }))
                }
              />
            </Field>
            <Field
              label={
                createUserForm.role === "worker_no_access" || !createUserForm.system_access
                  ? "אימייל (אופציונלי)"
                  : "אימייל"
              }
            >
              <Input
                type="email"
                value={createUserForm.email}
                onChange={(event) =>
                  setCreateUserForm((current) => ({ ...current, email: event.target.value }))
                }
                placeholder={
                  createUserForm.role === "worker_no_access" || !createUserForm.system_access
                    ? "אפשר להשאיר ריק"
                    : ""
                }
              />
            </Field>
            <Field label="טלפון">
              <Input
                value={createUserForm.phone}
                onChange={(event) =>
                  setCreateUserForm((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </Field>
            <Field label="תפקיד">
              <select
                value={createUserForm.role}
                onChange={(event) =>
                  setCreateUserForm((current) => ({
                    ...current,
                    role: event.target.value as CreateUserFormState["role"],
                    system_access: event.target.value === "worker_no_access" ? false : current.system_access,
                  }))
                }
                className={selectClassName}
              >
                <option value="worker">{"עובד"}</option>
                <option value="worker_no_access">{"פועל"}</option>
                <option value="office">{"משרד"}</option>
                <option value="admin">{"מנהל"}</option>
              </select>
            </Field>
            <Field label="פעיל">
              <select
                value={createUserForm.active ? "yes" : "no"}
                onChange={(event) =>
                  setCreateUserForm((current) => ({ ...current, active: event.target.value === "yes" }))
                }
                className={selectClassName}
              >
                <option value="yes">{"כן"}</option>
                <option value="no">{"לא"}</option>
              </select>
            </Field>
            <Field label="סוג עובד">
              <select
                value={createUserForm.payroll_worker_type}
                onChange={(event) =>
                  setCreateUserForm((current) => ({
                    ...current,
                    payroll_worker_type: event.target.value as CreateUserFormState["payroll_worker_type"],
                  }))
                }
                className={selectClassName}
              >
                <option value="session_only">{"קבלנות"}</option>
                <option value="monthly_payslip">{"חודשי גלובלי"}</option>
                <option value="hourly_payslip">{"שעתי עם תלוש"}</option>
              </select>
            </Field>
            <Field label="גישה למערכת">
              <select
                value={createUserForm.system_access ? "yes" : "no"}
                onChange={(event) =>
                  setCreateUserForm((current) => ({ ...current, system_access: event.target.value === "yes" }))
                }
                disabled={createUserForm.role === "worker_no_access"}
                className={selectClassName}
              >
                <option value="yes">{"כן"}</option>
                <option value="no">{"לא"}</option>
              </select>
            </Field>
            {createUserForm.role !== "worker_no_access" && createUserForm.system_access ? (
              <div className="md:col-span-2">
                <Field label="סיסמה">
                  <Input
                    type="password"
                    value={createUserForm.password}
                    onChange={(event) =>
                      setCreateUserForm((current) => ({ ...current, password: event.target.value }))
                    }
                    placeholder="נדרשת סיסמה למשתמש עם גישה"
                  />
                </Field>
              </div>
            ) : null}
            {createUserError ? <div className="md:col-span-2 text-sm text-destructive">{createUserError}</div> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateUserOpen(false)} disabled={isPending}>
              {"ביטול"}
            </Button>
            <Button onClick={() => createUser()} disabled={isPending}>
              {"שמירת משתמש"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={workerPaymentDialogOpen}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          setWorkerPaymentDialogOpen(open);
        }}
      >
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader className="text-right">
            <DialogTitle>{workerPaymentForm.payment_id ? "עדכון תשלום לעובד" : "הוספת תשלום לעובד"}</DialogTitle>
            <DialogDescription>
              {"רישום תשלום והקצאה שלו למשמרות או לתלושים פתוחים."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="תאריך תשלום">
              <DateInput
                value={workerPaymentForm.payment_date}
                onChange={(event) =>
                  setWorkerPaymentForm((current) => ({ ...current, payment_date: event.target.value }))
                }
              />
            </Field>
            <Field label="סכום">
              <Input
                inputMode="decimal"
                value={workerPaymentForm.amount}
                onChange={(event) => setWorkerPaymentAmount(event.target.value)}
              />
            </Field>
            <Field label="אופן תשלום">
              <Input
                value={workerPaymentForm.payment_method}
                onChange={(event) =>
                  setWorkerPaymentForm((current) => ({ ...current, payment_method: event.target.value }))
                }
                placeholder="מזומן, העברה, צ׳ק..."
              />
            </Field>
            <Field label="אסמכתא / רפרנס">
              <Input
                value={workerPaymentForm.reference_number}
                onChange={(event) =>
                  setWorkerPaymentForm((current) => ({ ...current, reference_number: event.target.value }))
                }
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="הערות">
                <Textarea
                  rows={3}
                  value={workerPaymentForm.notes}
                  onChange={(event) =>
                    setWorkerPaymentForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </Field>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-medium">{"הקצאות לפריטי חוב"}</div>
              <Button variant="outline" onClick={() => autoDistributeWorkerPayment()} disabled={isPending}>
                {"פיזור אוטומטי"}
              </Button>
            </div>
            {workerPaymentForm.allocations.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                {"אין פריטי חוב פתוחים לעובד הזה."}
              </div>
            ) : (
              <div className="space-y-2">
                {workerPaymentForm.allocations.map((allocation) => (
                  <div
                    key={allocation.source_id}
                    className="grid gap-3 rounded-2xl border p-3 md:grid-cols-[minmax(0,1fr)_180px]"
                  >
                    <div className="text-right">
                      <div className="font-medium">{allocation.title}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{allocation.subtitle}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {`יתרה להקצאה: ${formatCurrency(allocation.max_amount)}`}
                      </div>
                    </div>
                    <Field label="סכום להקצאה">
                      <Input
                        inputMode="decimal"
                        value={allocation.amount}
                        onChange={(event) =>
                          updateWorkerPaymentAllocation(allocation.source_id, event.target.value)
                        }
                      />
                    </Field>
                  </div>
                ))}
              </div>
            )}
            {workerPaymentError ? <div className="text-sm text-destructive">{workerPaymentError}</div> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkerPaymentDialogOpen(false)} disabled={isPending}>
              {"ביטול"}
            </Button>
            <Button
              onClick={() => saveWorkerPayment()}
              disabled={isPending || workerPaymentForm.allocations.length === 0}
            >
              {workerPaymentForm.payment_id ? "שמירת עדכון" : "שמירת תשלום"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={sessionDialogOpen}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          if (!open) {
            setSessionSplitParts([]);
          }
          setSessionDialogOpen(open);
        }}
      >
        <DialogContent
          dir="rtl"
          className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto overflow-x-hidden text-right"
        >
          <DialogHeader className="text-right">
            <DialogTitle>{sessionMode === "create" ? "הוספת משמרת" : "עריכת משמרת"}</DialogTitle>
            <DialogDescription>
              {"מנהלים ומשרד יכולים ליצור ולעדכן משמרות לשני סוגי העובדים, כל עוד התקופה לא נעולה."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="עובד">
              <select
                value={sessionForm.user_id}
                onChange={(event) => setSessionForm((current) => ({ ...current, user_id: event.target.value }))}
                className={selectClassName}
              >
                <option value="">{"בחירה"}</option>
                {publicUsers
                  .filter(
                    (user) =>
                      (user.role === "worker" || user.role === "worker_no_access") &&
                      payrollWorkerTypeAllowsSessions(
                        normalizePayrollWorkerType(user.payroll_worker_type, user.pay_tracking_mode)
                      )
                  )
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name ?? user.email ?? "עובד"}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="תחום">
              <select
                value={sessionForm.business_domain}
                onChange={(event) =>
                  setSessionForm((current) => ({
                    ...current,
                    business_domain: event.target.value,
                    project_id: event.target.value === "logistics_projects" ? current.project_id : "",
                    property_id: event.target.value === "property_management" ? current.property_id : "",
                  }))
                }
                className={selectClassName}
              >
                <option value="general_business">{"שוטף"}</option>
                <option value="logistics_projects">{"פרויקטים"}</option>
                <option value="property_management">{"נכסים"}</option>
                <option value="sales">{"מכירות"}</option>
                <option value="home">{"בית"}</option>
                <option value="charity">{"צדקה"}</option>
              </select>
            </Field>
            {sessionForm.business_domain === "logistics_projects" ? (
              <Field label="פרויקט">
                <select
                  value={sessionForm.project_id}
                  onChange={(event) => setSessionForm((current) => ({ ...current, project_id: event.target.value }))}
                  className={selectClassName}
                >
                  <option value="">{"בחירה"}</option>
                  {projectOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {sessionForm.business_domain === "property_management" ? (
              <Field label="נכס">
                <select
                  value={sessionForm.property_id}
                  onChange={(event) => setSessionForm((current) => ({ ...current, property_id: event.target.value }))}
                  className={selectClassName}
                >
                  <option value="">{"בחירה"}</option>
                  {propertyOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {shouldShowSessionHours(sessionDialogWorkerType) ? (
              <div className="md:col-span-2 grid gap-3 md:grid-cols-3">
                <Field label="כניסה">
                  <DateTimeInput
                    value={sessionForm.clock_in}
                    onChange={(event) => setSessionForm((current) => ({ ...current, clock_in: event.target.value }))}
                  />
                </Field>
                <Field label="סה״כ שעות">
                  <Input
                    inputMode="decimal"
                    value={sessionDialogDurationHours}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      if (!nextValue.trim()) {
                        setSessionForm((current) => ({ ...current, clock_out: "" }));
                        return;
                      }
                      const parsedHours = Number(nextValue);
                      const start = new Date(sessionForm.clock_in).getTime();
                      if (!Number.isFinite(parsedHours) || parsedHours <= 0 || !Number.isFinite(start)) return;
                      const nextClockOut = new Date(start + parsedHours * 60 * 60 * 1000);
                      if (Number.isNaN(nextClockOut.getTime())) return;
                      setSessionForm((current) => ({ ...current, clock_out: toDateTimeLocalValue(nextClockOut) }));
                    }}
                    placeholder="למשל 8"
                  />
                </Field>
                <Field label="יציאה">
                  <DateTimeInput
                    value={sessionForm.clock_out}
                    onChange={(event) => setSessionForm((current) => ({ ...current, clock_out: event.target.value }))}
                  />
                </Field>
              </div>
            ) : (
              <Field label="תאריך">
                <DateInput
                  value={(() => {
                    const m = /^(\d{4}-\d{2}-\d{2})/.exec(sessionForm.clock_in);
                    return m ? m[1] : new Date().toISOString().slice(0, 10);
                  })()}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (!next) return;
                    setSessionForm((current) => ({
                      ...current,
                      clock_in: `${next}T09:00`,
                      clock_out: `${next}T10:00`,
                    }));
                  }}
                />
              </Field>
            )}
            {shouldShowSessionPrice(sessionDialogWorkerType) ? (
              <Field label="מחיר">
                <Input
                  inputMode="decimal"
                  value={sessionForm.labor_cost}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, labor_cost: event.target.value }))
                  }
                  placeholder="אופציונלי"
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  {sessionDialogSuggestedAmount !== null
                    ? `סה״כ לתשלום עבור המשמרת: ${formatCurrency(sessionDialogSuggestedAmount)}`
                    : "הסכום שמגיע לעובד יוצג כאן אחרי הזנת שעות תקינות או עלות עבודה."}
                </div>
              </Field>
            ) : (
              <Field label="עלות חישוב אוטומטי">
                <div className="text-xs text-muted-foreground">
                  {sessionDialogSuggestedAmount !== null
                    ? `סה״כ לתשלום עבור המשמרת: ${formatCurrency(sessionDialogSuggestedAmount)}`
                    : "העלות תחושב אוטומטית לפי הסכם השכר לאחר שמירה."}
                </div>
              </Field>
            )}
            <Field label="חיוב לקוח">
              <select
                value={sessionForm.is_billable_to_customer ? "yes" : "no"}
                onChange={(event) =>
                  setSessionForm((current) => ({
                    ...current,
                    is_billable_to_customer: event.target.value === "yes",
                  }))
                }
                className={selectClassName}
              >
                <option value="no">{"לא"}</option>
                <option value="yes">{"כן"}</option>
              </select>
            </Field>
            {sessionForm.is_billable_to_customer ? (
              <Field label="סכום לחיוב">
                <Input
                  inputMode="decimal"
                  value={sessionForm.bill_to_customer_amount}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, bill_to_customer_amount: event.target.value }))
                  }
                />
              </Field>
            ) : null}
            {sessionDialogWorkerType === "session_only" ? (
              <>
                <Field label="שולם עכשיו">
                  <select
                    value={sessionForm.mark_paid_now ? "yes" : "no"}
                    onChange={(event) =>
                      setSessionForm((current) => ({
                        ...current,
                        mark_paid_now: event.target.value === "yes",
                      }))
                    }
                    className={selectClassName}
                  >
                    <option value="no">{"לא"}</option>
                    <option value="yes">{"כן"}</option>
                  </select>
                </Field>
                {sessionForm.mark_paid_now ? (
                  <Field label="כמה שולם">
                    <Input
                      inputMode="decimal"
                      value={sessionForm.paid_amount_now}
                      onChange={(event) =>
                        setSessionForm((current) => ({ ...current, paid_amount_now: event.target.value }))
                      }
                      placeholder="אם ריק, יירשם מלוא סכום המשמרת"
                    />
                  </Field>
                ) : null}
              </>
            ) : null}
            <div className="md:col-span-2">
              <Field label="הערות">
                <Textarea
                  rows={3}
                  value={sessionForm.notes}
                  onChange={(event) => setSessionForm((current) => ({ ...current, notes: event.target.value }))}
                />
              </Field>
            </div>
            {sessionError ? (
              <div
                role="alert"
                className="md:col-span-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
              >
                {sessionError}
              </div>
            ) : null}
          </div>

          {sessionMode === "edit" && sessionDialogSourceSession?.clock_out ? (
            <div className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium">{"פיצול משמרת"}</div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={sessionSplitParts.length >= Math.min(5, sessionWorkedMinutes(sessionDialogSourceSession))}
                    onClick={() =>
                      addSessionSplitPart(
                        isExpenseBusinessDomain(sessionForm.business_domain) ? sessionForm.business_domain : "general_business",
                        sessionWorkedMinutes(sessionDialogSourceSession)
                      )
                    }
                  >
                    {"הוספת חלק"}
                  </Button>
                  <Button type="button" size="sm" disabled={isPending || Boolean(sessionDialogSplitError)} onClick={() => splitSession()}>
                    {"שמירת פיצול"}
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {sessionDialogSplitPreview.map((part, index) => {
                  const isLast = index === sessionDialogSplitPreview.length - 1;
                  return (
                    <div key={part.id} className="rounded-xl border bg-background/70 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium">{`חלק ${index + 1}`}</div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatMinutes(part.minutes)}</span>
                          {!isLast && sessionSplitParts.length > 2 ? (
                            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => removeSessionSplitPart(part.id)}>
                              {"הסרה"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-end justify-end gap-2">
                        {!isLast ? (
                          <label className="space-y-1 text-right">
                            <span className="block text-xs text-muted-foreground">{"דקות"}</span>
                            <Input
                              type="number"
                              min="1"
                              className="h-9 w-24 text-right"
                              value={sessionSplitParts[index]?.minutes ?? ""}
                              onChange={(event) =>
                                updateSessionSplitMinutes(part.id, event.target.value, sessionWorkedMinutes(sessionDialogSourceSession))
                              }
                            />
                          </label>
                        ) : (
                          <div className="min-w-20 rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
                            {"יתרה"}
                          </div>
                        )}
                        <label className="space-y-1 text-right">
                          <span className="block text-xs text-muted-foreground">{"תחום"}</span>
                          <select
                            className="h-9 w-40 rounded-md border border-input bg-background px-3 text-right text-sm"
                            value={sessionSplitParts[index]?.domain ?? "general_business"}
                            onChange={(event) =>
                              updateSessionSplitPart(part.id, { domain: event.target.value as ExpenseBusinessDomain })
                            }
                          >
                            {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                              <option key={domain} value={domain}>
                                {getBusinessDomainLabel(domain)}
                              </option>
                            ))}
                          </select>
                        </label>
                        {sessionSplitParts[index]?.domain === "logistics_projects"
                          ? renderCompactSessionLinkField(
                              "פרויקט",
                              sessionSplitParts[index]?.projectId ?? "",
                              (value) => updateSessionSplitPart(part.id, { projectId: value }),
                              projectOptions
                            )
                          : null}
                        {sessionSplitParts[index]?.domain === "property_management"
                          ? renderCompactSessionLinkField(
                              "נכס",
                              sessionSplitParts[index]?.propertyId ?? "",
                              (value) => updateSessionSplitPart(part.id, { propertyId: value }),
                              propertyOptions
                            )
                          : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {sessionDialogSplitError ? <div className="text-sm text-destructive">{sessionDialogSplitError}</div> : null}
            </div>
          ) : null}

          {sessionMode === "edit" && sessionDialogWorkerType === "session_only" ? (
            <SalaryProtected
              unlocked={salaryUnlocked}
              hasPasswordConfigured={hasPasswordConfigured}
              canUnlock={canViewSalary}
              onUnlockSuccess={loadProtectedData}
            >
              <div className="space-y-3 rounded-2xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-medium">{"תשלום על המשמרת"}</div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openSessionPaymentDialog()}
                    disabled={isPending || !sessionDialogDebtItem || toNumber(sessionDialogDebtItem.owed_amount) <= 0.009}
                  >
                    {"עדכון תשלום"}
                  </Button>
                </div>
                {sessionDialogDebtItem ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <MiniStat label="עלות משמרת" value={formatCurrency(sessionDialogDebtItem.earned_amount)} />
                      <MiniStat label="שולם" value={formatCurrency(sessionDialogDebtItem.paid_amount)} />
                      <MiniStat label="יתרה" value={formatCurrency(sessionDialogDebtItem.owed_amount)} />
                      <MiniStat
                        label="סטטוס"
                        value={sharedPaymentStatusLabel(sessionDialogDebtItem.payment_status)}
                      />
                    </div>
                    {sessionDialogPaymentAllocations.length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-sm font-medium">{"תשלומים שנרשמו למשמרת"}</div>
                        {sessionDialogPaymentAllocations.map((allocation) => {
                          const payment = workerPaymentsById.get(allocation.worker_payment_id) ?? null;
                          return (
                            <div key={allocation.id} className="rounded-xl border bg-muted/10 p-3 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="font-medium">{formatCurrency(allocation.amount)}</div>
                                <div className="text-muted-foreground">
                                  {formatDate(payment?.payment_date ?? null)}
                                </div>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {[payment?.payment_method, payment?.reference_number].filter(Boolean).join(" • ") || "ללא פירוט"}
                              </div>
                              {payment?.notes ? (
                                <div className="mt-1 text-xs text-muted-foreground">{payment.notes}</div>
                              ) : null}
                              {payment ? (
                                <div className="mt-3 flex flex-wrap justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openEditWorkerPaymentDialog(payment)}
                                  >
                                    {"ערוך"}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => deleteWorkerPayment(payment)}
                                  >
                                    {"מחק"}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">{"עדיין לא נרשם תשלום על המשמרת."}</div>
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {"התשלום למשמרת יהיה זמין אחרי טעינת נתוני השכר ולפי עלות העבודה של המשמרת."}
                  </div>
                )}
              </div>
            </SalaryProtected>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSessionDialogOpen(false)} disabled={isPending}>
              {"ביטול"}
            </Button>
            <Button onClick={() => saveSession()} disabled={isPending}>
              {"שמירה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingDeletion)}
        onOpenChange={(open) => {
          if (!open && !isPending) {
            setPendingDeletion(null);
          }
        }}
      >
        <DialogContent dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle>{pendingDeletionDetails?.title ?? "אישור מחיקה"}</DialogTitle>
            <DialogDescription>
              {pendingDeletionDetails?.description ?? "הפעולה תתבצע רק לאחר אישור."}
            </DialogDescription>
          </DialogHeader>
          <div className="text-right text-sm">
            למחוק את <span className="font-medium">{pendingDeletionDetails?.label ?? "הרשומה"}</span>?
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeletion(null)} disabled={isPending}>
              {"ביטול"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmPendingDeletion()}
              disabled={isPending || !pendingDeletion}
            >
              {isPending ? "מוחק..." : "מחיקה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  protectedValue = false,
}: {
  title: string;
  value: string;
  protectedValue?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 py-5">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div className={`text-2xl font-semibold ${protectedValue ? "tracking-tight" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function WorkerTypeBadge({ workerType }: { workerType: PayrollWorkerType }) {
  return <Tag>{getPayrollWorkerTypeLabel(workerType)}</Tag>;
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-muted/10 p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-right text-sm">
      <div className="font-medium">{label}</div>
      {children}
    </label>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <Badge variant="outline">{children}</Badge>;
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "muted" | "success" | "warning" | "danger";
}) {
  const className =
    tone === "success"
      ? "bg-success text-success-foreground border-transparent"
      : tone === "warning"
        ? "bg-warning text-warning-foreground border-transparent"
        : tone === "danger"
          ? "bg-destructive text-destructive-foreground border-transparent"
          : "border-border bg-background text-muted-foreground";

  return <Badge className={className}>{children}</Badge>;
}

function PaymentStatusBadge({
  status,
  owedAmount,
}: {
  status: string | null | undefined;
  owedAmount?: number | string | null;
}) {
  if (toNumber(owedAmount) <= 0.009) {
    return <StatusBadge value="paid" type="payment" />;
  }

  const normalized =
    status === "paid" ||
    status === "partial" ||
    status === "overpaid" ||
    status === "pending" ||
    status === "not_due"
      ? status
      : "unpaid";
  return <StatusBadge value={normalized} type="payment" />;
}

function paymentStatusLabel(status: string | null | undefined) {
  if (status === "paid") return "שולם";
  if (status === "partial") return "שולם חלקית";
  if (status === "overpaid") return "שולם יתר";
  if (status === "not_due") return "טרם הגיע מועד התשלום";
  if (status === "pending") return "ממתין לתשלום";
  return "לא שולם";
}

function sharedPaymentStatusLabel(status: string | null | undefined) {
  if (status === "overpaid") return paymentStatusLabel(status);
  return getSharedPaymentStatusLabel(status ?? "unpaid");
}

function formatWorkerPaymentMethodLabel(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return "";

  const lowered = normalized.toLowerCase();
  if (lowered === "cash") return "מזומן";
  if (lowered === "transfer" || lowered === "bank transfer" || lowered === "wire") return "העברה";
  if (lowered === "check" || lowered === "cheque") return "צ׳ק";
  if (lowered === "credit" || lowered === "credit card") return "אשראי";
  if (lowered === "bit") return "ביט";
  if (lowered === "paybox") return "פייבוקס";

  return normalized;
}

function escapePrintHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function RoleBadge({ role }: { role: string | null | undefined }) {
  if (role === "worker_no_access") {
    return <StatusPill tone="warning">{"עובד ללא גישה"}</StatusPill>;
  }
  if (role === "worker") {
    return <StatusPill tone="success">{"עובד"}</StatusPill>;
  }
  return <StatusPill tone="muted">{getRoleLabel(role)}</StatusPill>;
}

function AccessBadge({ hasAccess }: { hasAccess: boolean }) {
  return <StatusPill tone={hasAccess ? "success" : "muted"}>{hasAccess ? "עם גישה" : "ללא גישה"}</StatusPill>;
}

function getRoleLabel(value: string | null | undefined) {
  if (value === "worker") return "עובד";
  if (value === "worker_no_access") return "עובד ללא גישה";
  if (value === "office") return "משרד";
  if (value === "admin") return "מנהל";
  return value || "-";
}

function getPayrollPeriodLabel(value: string | null | undefined) {
  const normalized = normalizePayrollStatus(value);
  if (normalized === "paid") return "שולם";
  if (normalized === "locked") return "נעול";
  return "פתוח";
}

function getBillingStatusLabel(value: string | null | undefined) {
  if (value === "paid") return "שולם";
  if (value === "billable") return "לחיוב";
  if (value === "not_billable") return "לא לחיוב";
  if (value === "pending") return "ממתין";
  return value || "-";
}

function formatSessionRange(clockIn: string, clockOut: string | null) {
  const start = new Date(clockIn);
  const end = clockOut ? new Date(clockOut) : null;
  if (Number.isNaN(start.getTime())) return formatDateTime(clockIn);
  if (!end || Number.isNaN(end.getTime())) {
    return `${formatLocalDate(start)} • ${formatLocalTime(start)} - פתוח`;
  }

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (sameDay) {
    return `${formatLocalDate(start)} • ${formatLocalTime(start)}-${formatLocalTime(end)}`;
  }

  return `${formatLocalDate(start)} ${formatLocalTime(start)} → ${formatLocalDate(end)} ${formatLocalTime(end)}`;
}

function formatLocalDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getFullYear()).slice(-2)}`;
}

function formatLocalTime(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatPrintPeriodLabel(year: string, month: string) {
  if (!month && !year) return "כל החודשים והשנים";
  if (year && !month) return `כל החודשים בשנת ${year}`;
  if (month && !year) return `${formatMonthYearLabel(String(new Date().getFullYear()), month, false)} בכל השנים`;
  return formatMonthYearLabel(year, month);
}

function formatMonthYearLabel(year: string, month: string, includeYear = true) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  if (!Number.isFinite(normalizedYear) || !Number.isFinite(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > 12) {
    return includeYear ? `${month}/${year}` : month;
  }
  return new Intl.DateTimeFormat("he-IL", includeYear ? { month: "long", year: "numeric" } : { month: "long" }).format(
    new Date(normalizedYear, normalizedMonth - 1, 1)
  );
}

function toDateTimeLocalValue(date: Date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

const selectClassName =
  "h-11 w-full rounded-xl border border-input bg-background/80 px-4 py-2 text-right text-sm shadow-sm";
