"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AddIcon, CalendarCheckIcon, CashIcon, CheckIcon, CoinsIcon, DeleteIcon, EditIcon, FilterIcon, LaborIcon, LockIcon, PrintIcon, ReceiptIcon, UsersIcon, WalletIcon, WarningIcon } from "@/components/ui/icons";
import { SwipeActions, type SwipeAction } from "@/components/ui/swipe-actions";
import SalaryProtected from "@/components/payroll/SalaryProtected";
import SessionEditorDialog from "./SessionEditorDialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { ViewDialog } from "@/components/ui/view-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingDots } from "@/components/ui/loading-dots";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { StatusBadge } from "@/components/ui/status-badge";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import AccountSelect from "@/components/financial/AccountSelect";
import type { Account } from "@/lib/accounts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { rowNavigateProps } from "@/lib/ui/row-navigation";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { WORK_SESSION_BUSINESS_DOMAINS, getBusinessDomainLabel } from "@/lib/expenses";
import { DomainSelect } from "@/components/financial/DomainSelect";
import {
  getPayrollWorkerTypeLabel,
  normalizePayrollWorkerType,
  payrollWorkerTypeAllowsSessions,
  payrollWorkerTypeRequiresAgreement,
  shouldShowSessionHours,
  shouldShowSessionPrice,
} from "@/lib/payroll-worker-type";
import {
  getActiveSalaryAgreementForDate,
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
  type SalaryCenterProtectedPayload,
  type SalaryCenterUserRow,
  type SessionEffectivePaymentRow,
  type SessionPublicRow,
  type WorkerPaymentAllocationRow,
  type WorkerDebtItemRow,
  type WorkerPaymentRow,
} from "@/lib/payroll-center";
import {
  BONUS_ITEM_TYPE,
  WORKER_ABSENCE_TYPES,
  getWorkerAbsenceTypeLabel,
} from "@/lib/payroll-bonuses";
import { toHebrewError } from "@/lib/error-messages";
import { createWorkerAbsences, deleteWorkerAbsence } from "@/lib/payroll/absencesClient";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import {
  scheduleDeferredDelete,
  registerReversibleAction,
  registerReversibleCreate,
} from "@/lib/undo-engine";
import type {
  Props,
  AbsenceFormState,
  BonusFormState,
  SessionFormState,
  WorkerFormState,
  CreateUserFormState,
  AgreementFormState,
  OverrideFormState,
  PayslipItemFormState,
  WorkerPaymentAllocationFormState,
  WorkerPaymentFormState,
  PendingSalaryDeletion,
  WorkerPrintFilters,
} from "./SalaryCenter.types";
import {
  PAYSLIP_ITEM_TYPES,
  AccessBadge,
  Field,
  MiniStat,
  PaymentStatusBadge,
  RoleBadge,
  StatusPill,
  Tag,
  WorkerTypeBadge,
  escapePrintHtml,
  formatLocalDate,
  formatLocalTime,
  formatMonthYearLabel,
  formatPrintPeriodLabel,
  formatSessionRange,
  formatWorkerPaymentMethodLabel,
  getBillingStatusLabel,
  getPayslipItemTypeLabel,
  getRoleLabel,
  isExceptionItemType,
  sharedPaymentStatusLabel,
  toDateTimeLocalValue,
} from "./SalaryCenterUi";
import { buildWorkerSummaryPrintDocument, openWorkerSummaryPrintWindow } from "@/lib/payroll/workerSummaryPrint";

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
  business_domain: "general_business",
  project_id: "",
  property_id: "",
  is_billable_to_customer: false,
  bill_to_customer_amount: "",
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
  item_date: "",
};

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
  account_id: "",
  reference_number: "",
  notes: "",
  allocations: [],
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_BONUS_FORM: BonusFormState = {
  user_id: "",
  bonus_date: todayIsoDate(),
  amount: "",
  notes: "",
};

const DEFAULT_ABSENCE_FORM: AbsenceFormState = {
  user_id: "",
  absence_date: todayIsoDate(),
  absence_type: "day_off",
  notes: "",
  applyToAll: false,
};

/** Same defaulting rules the worker-access form uses to hydrate from a user row —
 *  shared so an undo of a worker-access edit/deactivation can resend the exact
 *  pre-edit snapshot through the same /api/payroll/workers/update route. */
function workerFormFromUser(user: SalaryCenterUserRow): WorkerFormState {
  return {
    full_name: user.full_name ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
    role:
      user.role === "admin" || user.role === "office" || user.role === "worker_no_access"
        ? user.role
        : "worker",
    active: user.active !== false,
    system_access: user.system_access !== false && user.role !== "worker_no_access",
    payroll_worker_type: normalizePayrollWorkerType(user.payroll_worker_type, user.pay_tracking_mode),
    locale: user.locale === "ar" ? "ar" : "he",
    deliveries_access: user.deliveries_access !== false,
  };
}

const DEFAULT_WORKER_PRINT_FILTERS: WorkerPrintFilters = {
  projectId: "",
  // Empty = "all months / all years" (no filter applied).
  month: "",
  year: "",
};

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
  // Only one card may sit swiped open at a time, per mobile list.
  const [swipedSessionId, setSwipedSessionId] = useState<string | null>(null);
  const [swipedAgreementId, setSwipedAgreementId] = useState<string | null>(null);
  const [attendanceFilters, setAttendanceFilters] = useState({
    workerId: "",
    businessDomain: "",
    projectId: "",
    status: "",
    dateFrom: "",
    dateTo: "",
  });
  const [attendanceFiltersOpen, setAttendanceFiltersOpen] = useState(false);
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
  const [sessionMode, setSessionMode] = useState<"create" | "edit">("create");
  const [workerPaymentDialogOpen, setWorkerPaymentDialogOpen] = useState(false);
  const [workerPaymentForm, setWorkerPaymentForm] = useState<WorkerPaymentFormState>(DEFAULT_WORKER_PAYMENT_FORM);
  // Pre-edit snapshot of the payment being edited (null in "create" mode) — lets
  // an edit's undo resend the exact prior payment + allocations.
  const [editingWorkerPaymentSnapshot, setEditingWorkerPaymentSnapshot] = useState<{
    payment: WorkerPaymentRow;
    allocations: { source_type: "session" | "payslip"; source_id: string; amount: number }[];
  } | null>(null);
  const [workerPaymentAccountsList, setWorkerPaymentAccountsList] = useState<Account[]>([]);
  const [workerPaymentError, setWorkerPaymentError] = useState("");
  const [pendingDeletion, setPendingDeletion] = useState<PendingSalaryDeletion | null>(null);
  const [protectedData, setProtectedData] = useState<SalaryCenterProtectedPayload | null>(null);
  const [protectedError, setProtectedError] = useState("");
  const [loadingProtected, setLoadingProtected] = useState(false);
  const [salaryUnlocked, setSalaryUnlocked] = useState(initiallyUnlocked);
  const [workerForm, setWorkerForm] = useState<WorkerFormState>({
    full_name: "",
    email: "",
    phone: "",
    role: "worker",
    active: true,
    system_access: true,
    payroll_worker_type: "session_only",
    locale: "he",
    deliveries_access: true,
  });
  const [agreementForm, setAgreementForm] = useState<AgreementFormState>(DEFAULT_AGREEMENT_FORM);
  // Pre-edit snapshot of the agreement being edited (null when the dialog is in
  // "create" mode) — lets an edit's undo resend the exact prior row.
  const [editingAgreementSnapshot, setEditingAgreementSnapshot] = useState<SalaryAgreementRow | null>(null);
  const [overrideForm, setOverrideForm] = useState<OverrideFormState>(DEFAULT_OVERRIDE_FORM);
  const [periodMonth, setPeriodMonth] = useState(getCurrentMonthKey());
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [periodManagementDialogOpen, setPeriodManagementDialogOpen] = useState(false);
  const [selectedSummaryMonth, setSelectedSummaryMonth] = useState(getCurrentMonthKey());
  const [payslipItemForm, setPayslipItemForm] = useState<PayslipItemFormState>(DEFAULT_PAYSLIP_ITEM_FORM);
  const [payslipAdjustmentDrafts, setPayslipAdjustmentDrafts] = useState<Record<string, string>>({});
  const [bonusDialogOpen, setBonusDialogOpen] = useState(false);
  const [bonusForm, setBonusForm] = useState<BonusFormState>(DEFAULT_BONUS_FORM);
  const [bonusError, setBonusError] = useState("");
  const [absenceDialogOpen, setAbsenceDialogOpen] = useState(false);
  const [absenceForm, setAbsenceForm] = useState<AbsenceFormState>(DEFAULT_ABSENCE_FORM);
  const [absenceError, setAbsenceError] = useState("");

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
  // Who "כל העובדים" means when marking a day off: the same population the
  // salaried-hours export builds sheets from (active, with a payroll role), so a
  // marked day can't land on somebody the sheet never shows.
  const absenceEligibleWorkers = allAgreementEligibleUsers;
  const canManageAttendance = viewerRole === "admin" || viewerRole === "office";
  const canCreateUsers = viewerRole === "admin";
  // Office may VIEW salaries of lower-status users (the protected endpoint scopes the
  // returned data to worker & worker_no_access). Managing salary stays admin-only.
  const canViewSalary = viewerRole === "admin" || viewerRole === "office";

  const loadProtectedData = useCallback(async (options?: { fresh?: boolean }) => {
    if (!canViewSalary) return;

    setLoadingProtected(true);
    setProtectedError("");
    try {
      // Worker-detail page scopes the fetch to its one worker so the server can hit
      // user_id indexes instead of loading every worker. `fresh=1` bypasses the server
      // cache on post-mutation reloads so updated numbers are never stale.
      const params = new URLSearchParams();
      if (isWorkerDetailMode && defaultWorkerId) params.set("userId", defaultWorkerId);
      if (options?.fresh) params.set("fresh", "1");
      const queryString = params.toString();
      const response = await fetch(
        `/api/payroll/center/protected${queryString ? `?${queryString}` : ""}`,
        { cache: "no-store" }
      );
      const json = (await response.json().catch(() => ({}))) as SalaryCenterProtectedPayload & { error?: string };
      if (!response.ok) {
        setProtectedError(toHebrewError(json.error, "לא ניתן לטעון את נתוני השכר המוגנים."));
        setProtectedData(null);
        return;
      }
      setProtectedData(json);
      setSelectedPeriodId((current) => current || getCurrentPayrollPeriod(json.periods)?.id || "");
    } catch (loadError: unknown) {
      setProtectedError(toHebrewError(loadError, "Unknown error"));
      setProtectedData(null);
    } finally {
      setLoadingProtected(false);
    }
  }, [canViewSalary, isWorkerDetailMode, defaultWorkerId]);

  useEffect(() => {
    if (initiallyUnlocked && canViewSalary) {
      void loadProtectedData();
    }
  }, [initiallyUnlocked, canViewSalary, loadProtectedData]);

  // True while the protected payload (balances, payments, session costs) is being
  // fetched and nothing has arrived yet — covers both the initial render gap before
  // the effect fires and the in-flight fetch. Stat cards show LoadingDots instead of 0.
  const protectedLoading =
    loadingProtected || (canViewSalary && salaryUnlocked && !protectedData && !protectedError);

  const currentMonthKey = getCurrentMonthKey();
  const usersById = useMemo(() => new Map(publicUsers.map((user) => [user.id, user])), [publicUsers]);
  const projectLabelsById = useMemo(() => new Map(projectOptions.map((option) => [option.id, option.label])), [projectOptions]);
  const propertyLabelsById = useMemo(() => new Map(propertyOptions.map((option) => [option.id, option.label])), [propertyOptions]);
  // Where a monthly salary is booked in the financial flow — a specific project /
  // property when chosen, otherwise the domain label (e.g. "שוטף" for general).
  // Hourly agreements derive their domain per session, so there's nothing fixed to show.
  function agreementAttributionLabel(agreement: SalaryAgreementRow): string | null {
    if (agreement.salary_type !== "monthly") return null;
    const domain = agreement.business_domain ?? "general_business";
    if (domain === "logistics_projects" && agreement.project_id) {
      return projectLabelsById.get(agreement.project_id) ?? "פרויקט";
    }
    if (domain === "property_management" && agreement.property_id) {
      return propertyLabelsById.get(agreement.property_id) ?? "נכס";
    }
    return getBusinessDomainLabel(domain);
  }
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
  const rawAgreements = useMemo(() => protectedData?.agreements ?? [], [protectedData]);
  const agreements = useUndoOverlay(rawAgreements, (agreement) => agreement.id, "salary-agreement");
  const payslips = useMemo(() => protectedData?.payslips ?? [], [protectedData]);
  const rawPayslipItems = useMemo(() => protectedData?.payslipItems ?? [], [protectedData]);
  // Bonuses use the same undo scope as generic payslip items — a bonus IS a
  // payslip_items row (item_type = 'bonus'), just created/deleted via a
  // different route (see saveBonus / the "bonus" pendingDeletion branch).
  const payslipItems = useUndoOverlay(rawPayslipItems, (item) => item.id, "payslip-item");
  const visibleSessions = useUndoOverlay(publicSessions, (session) => session.id, "payroll-session");
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
  const payslipsById = useMemo(() => new Map(payslips.map((payslip) => [payslip.id, payslip])), [payslips]);
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
  // A bonus is just a רכיב שכר with a date on it — same table, same total.
  const workerBonuses = useMemo(
    () => payslipItems.filter((item) => item.item_type === BONUS_ITEM_TYPE),
    [payslipItems]
  );
  // Items no payslip has adopted. A DB trigger attaches them the moment they're
  // written (see 20260817000000), so in a normal open month this is empty — what's
  // left over is genuinely stranded: the worker it belongs to has no payslip for
  // the month, or the month is locked. Worth naming, since that money is otherwise
  // invisible on the תלוש.
  const unattachedItemsInSelectedPeriod = useMemo(() => {
    if (!selectedPayslipPeriod) return [];
    return payslipItems.filter(
      (item) =>
        !item.payslip_id &&
        item.item_date &&
        item.item_date >= selectedPayslipPeriod.start_date &&
        item.item_date <= selectedPayslipPeriod.end_date
    );
  }, [payslipItems, selectedPayslipPeriod]);
  const rawWorkerAbsences = useMemo(() => protectedData?.workerAbsences ?? [], [protectedData]);
  const workerAbsences = useUndoOverlay(rawWorkerAbsences, (absence) => absence.id, "worker-absence");
  // Effective per-session paid status (folds in payslip coverage), from the central
  // session_effective_payment_view. See db/sql/create_session_effective_payment_view.sql.
  const sessionEffectivePaymentBySessionId = useMemo(() => {
    const next = new Map<string, SessionEffectivePaymentRow>();
    (protectedData?.sessionEffectivePayments ?? []).forEach((row) => {
      if (row.session_id) next.set(row.session_id, row);
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
  const rawWorkerPayments = useMemo(() => protectedData?.workerPayments ?? [], [protectedData]);
  const workerPayments = useUndoOverlay(rawWorkerPayments, (payment) => payment.id, "worker-payment");
  const workerPaymentsByUserId = useMemo(() => {
    const next = new Map<string, WorkerPaymentRow[]>();
    workerPayments.forEach((payment) => {
      const list = next.get(payment.user_id) ?? [];
      list.push(payment);
      next.set(payment.user_id, list);
    });
    return next;
  }, [workerPayments]);
  const workerPaymentRecordedByNameById = protectedData?.workerPaymentRecordedByNameById ?? {};
  const sessionRecordedByNameById = protectedData?.sessionRecordedByNameById ?? {};
  const workerPaymentsById = useMemo(
    () => new Map(workerPayments.map((payment) => [payment.id, payment])),
    [workerPayments]
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
    const next = new Map<string, { totalMinutes: number; totalAmount: number; sessionCount: number }>();

    publicUsers.forEach((user) => {
      const workerType = normalizePayrollWorkerType(user.payroll_worker_type, user.pay_tracking_mode);
      // Session count is wanted on the card for session/contract workers regardless of
      // how their pay is tracked, so compute it for everyone.
      const monthSessionCount = visibleSessions.filter(
        (session) => session.user_id === user.id && monthKeyFromDate(session.clock_in) === selectedPayrollMonthKey
      ).length;
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
          sessionCount: monthSessionCount,
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
          sessionCount: monthSessionCount,
          totalMinutes: toNumber(currentMonthPayslip.total_work_minutes),
          totalAmount: toNumber(currentMonthPayslip.gross_salary) || toNumber(currentMonthPayslip.calculated_base_salary),
        });
        return;
      }

      const currentMonthSessions = visibleSessions.filter(
        (session) => session.user_id === user.id && monthKeyFromDate(session.clock_in) === selectedPayrollMonthKey
      );

      next.set(user.id, {
        sessionCount: currentMonthSessions.length,
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
    setWorkerForm(workerFormFromUser(selectedWorker));
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
        const stats = currentMonthPayrollStatsByUserId.get(user.id) ?? { totalMinutes: 0, totalAmount: 0, sessionCount: 0 };

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
    const currentLaborCost = session.labor_cost ? String(session.labor_cost) : "";
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
      // fresh=1 bypasses the server cache so post-mutation numbers are never stale.
      await loadProtectedData({ fresh: true });
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
    startTransition(async () => {
      try {
        await action();
      } catch (actionError: unknown) {
        const message = toHebrewError(actionError);
        if (options?.onError) {
          options.onError(message);
        } else {
          toast.error(message);
        }
      }
    });
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
      toast.success("המשתמש נוצר.");
      await refreshAll({ reloadProtected: false });
    });
  }

  function closeOpenSession(sessionId: string) {
    runAction(async () => {
      await postJson("/api/payroll/sessions/close", { session_id: sessionId });
      toast.success("המשמרת נסגרה.");
      await refreshAll();
    });
  }

  function deleteSession(sessionId: string) {
    const session = visibleSessions.find((item) => item.id === sessionId) ?? null;
    const worker = session ? usersById.get(session.user_id) ?? null : null;
    const workerLabel = worker?.full_name ?? worker?.email ?? "העובד";
    setPendingDeletion({ kind: "session", sessionId, workerLabel });
  }

  /** Resends a worker-access snapshot through the same update route — used to
   *  undo both a worker-access edit and a worker deactivation (which is really
   *  the same route with active/system_access flipped off). */
  async function applyWorkerAccessSnapshot(userId: string, snapshot: WorkerFormState) {
    try {
      await postJson("/api/payroll/workers/update", {
        user_id: userId,
        full_name: snapshot.full_name,
        email: snapshot.email || null,
        phone: snapshot.phone || null,
        role: snapshot.role,
        active: snapshot.active,
        system_access: snapshot.role === "worker_no_access" ? false : snapshot.system_access,
        payroll_worker_type: snapshot.payroll_worker_type,
        locale: snapshot.locale,
        deliveries_access: snapshot.deliveries_access,
      });
      await refreshAll({ reloadProtected: false });
      return { ok: true as const };
    } catch (undoError: unknown) {
      return { ok: false as const, error: toHebrewError(undoError, "הביטול נכשל.") };
    }
  }

  function saveWorkerAccess() {
    if (!selectedWorker) return;
    const workerId = selectedWorker.id;
    const previousSnapshot = workerFormFromUser(selectedWorker);
    runAction(async () => {
      await postJson("/api/payroll/workers/update", {
        user_id: workerId,
        full_name: workerForm.full_name,
        email: workerForm.email || null,
        phone: workerForm.phone || null,
        role: workerForm.role,
        active: workerForm.active,
        system_access: workerForm.role === "worker_no_access" ? false : workerForm.system_access,
        payroll_worker_type: workerForm.payroll_worker_type,
        locale: workerForm.locale,
        deliveries_access: workerForm.deliveries_access,
      });
      await refreshAll({ reloadProtected: false });
      setWorkerAccessDialogOpen(false);
      registerReversibleAction({
        key: `worker-access:edit:${workerId}`,
        message: "פרטי הגישה עודכנו.",
        onUndo: () => applyWorkerAccessSnapshot(workerId, previousSnapshot),
      });
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
      toast.error("יש לבחור עובד לפני שמירה.");
      return;
    }
    if (!agreementStandardDailyHoursValid) {
      toast.error("יש להזין שעות יומיות תקניות גדולות מ-0.");
      return;
    }
    if (!agreementDueDayValid) {
      toast.error("יש להזין יום תשלום תקין בין 1 ל-31.");
      return;
    }
    const editingAgreementId = agreementForm.agreement_id;
    const previousAgreement = editingAgreementId ? editingAgreementSnapshot : null;
    runAction(async () => {
      const result = (await postJson("/api/payroll/salary-agreements", {
        ...agreementForm,
        agreement_id: agreementForm.agreement_id || undefined,
        user_id: targetUserId,
      })) as { agreement?: SalaryAgreementRow };
      setAgreementForm(DEFAULT_AGREEMENT_FORM);
      setEditingAgreementSnapshot(null);
      setAgreementDialogOpen(false);
      await refreshAll();

      if (editingAgreementId && previousAgreement) {
        // EDIT — undo resends the exact pre-edit row through the same route.
        registerReversibleAction({
          key: `salary-agreement:edit:${editingAgreementId}`,
          message: "הסכם השכר נשמר.",
          onUndo: async () => {
            try {
              await postJson("/api/payroll/salary-agreements", {
                agreement_id: previousAgreement.id,
                user_id: previousAgreement.user_id,
                salary_type: previousAgreement.salary_type,
                hourly_rate: previousAgreement.hourly_rate,
                monthly_salary: previousAgreement.monthly_salary,
                overtime_rate: previousAgreement.overtime_rate,
                standard_daily_hours: previousAgreement.standard_daily_hours,
                due_day_of_next_month: previousAgreement.due_day_of_next_month,
                valid_from: previousAgreement.valid_from,
                notes: previousAgreement.notes,
                business_domain: previousAgreement.business_domain,
                project_id: previousAgreement.project_id,
                property_id: previousAgreement.property_id,
                is_billable_to_customer: previousAgreement.is_billable_to_customer,
                bill_to_customer_amount: previousAgreement.bill_to_customer_amount,
              });
            } catch (undoError: unknown) {
              return { ok: false, error: toHebrewError(undoError, "הביטול נכשל.") };
            }
            await refreshAll();
            return { ok: true };
          },
        });
        return;
      }

      // CREATE — undo deletes the newly-created agreement via the existing
      // "delete" action on this same route.
      const newAgreementId = result.agreement?.id;
      if (!newAgreementId) {
        toast.success("הסכם השכר נשמר.");
        return;
      }
      registerReversibleCreate({
        scope: "salary-agreement",
        id: newAgreementId,
        message: "הסכם השכר נשמר.",
        onUndo: async () => {
          try {
            await postJson("/api/payroll/salary-agreements", {
              action: "delete",
              agreement_id: newAgreementId,
              user_id: targetUserId,
            });
          } catch (undoError: unknown) {
            return { ok: false, error: toHebrewError(undoError, "הביטול נכשל.") };
          }
          await refreshAll();
          return { ok: true };
        },
      });
    });
  }

  function openNewAgreementDialog(userId = "", currentAgreement?: SalaryAgreementRow | null) {
    setEditingAgreementSnapshot(null);
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
      business_domain: currentAgreement?.business_domain ?? "general_business",
      project_id: currentAgreement?.project_id ?? "",
      property_id: currentAgreement?.property_id ?? "",
      is_billable_to_customer: currentAgreement?.is_billable_to_customer ?? false,
      bill_to_customer_amount: currentAgreement?.bill_to_customer_amount
        ? String(currentAgreement.bill_to_customer_amount)
        : "",
    });
    setAgreementDialogOpen(true);
  }

  function openEditAgreementDialog(agreement: SalaryAgreementRow) {
    setEditingAgreementSnapshot(agreement);
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
      business_domain: agreement.business_domain ?? "general_business",
      project_id: agreement.project_id ?? "",
      property_id: agreement.property_id ?? "",
      is_billable_to_customer: agreement.is_billable_to_customer ?? false,
      bill_to_customer_amount: agreement.bill_to_customer_amount
        ? String(agreement.bill_to_customer_amount)
        : "",
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
      toast.success("החרגת השכר נוספה.");
      await refreshAll();
      setOverrideDialogOpen(false);
    });
  }

  function createOrOpenPeriod() {
    runAction(async () => {
      await postJson("/api/payroll/periods", { action: "create", period_month: periodMonth });
      toast.success("תקופת השכר נשמרה.");
      await refreshAll();
    });
  }

  function runPeriodAction(action: "generate", periodId = selectedPeriodId) {
    if (!periodId) return;
    runAction(async () => {
      await postJson("/api/payroll/periods", { action, period_id: periodId });
      toast.success("התלושים נוצרו.");
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
      toast.success("התלוש חושב מחדש.");
      await refreshAll();
    });
  }

  function updatePayslip(payslipId: string) {
    // Full pre-edit snapshot of the one field this actually changes — lets
    // undo resend the exact prior value through the same route.
    const previousManualAdjustments = payslipsById.get(payslipId)?.manual_adjustments ?? 0;
    runAction(async () => {
      await postJson("/api/payroll/payslips", {
        action: "update",
        payslip_id: payslipId,
        manual_adjustments: payslipAdjustmentDrafts[payslipId] ?? "0",
      });
      await refreshAll();
      registerReversibleAction({
        key: `payslip:edit:${payslipId}`,
        message: "התלוש עודכן.",
        onUndo: async () => {
          try {
            await postJson("/api/payroll/payslips", {
              action: "update",
              payslip_id: payslipId,
              manual_adjustments: previousManualAdjustments,
            });
          } catch (undoError: unknown) {
            return { ok: false, error: toHebrewError(undoError, "הביטול נכשל.") };
          }
          await refreshAll();
          return { ok: true };
        },
      });
    });
  }

  function addPayslipItem() {
    const payslipId = payslipItemForm.payslip_id;
    runAction(async () => {
      const result = (await postJson("/api/payroll/payslip-items", payslipItemForm)) as unknown as {
        item?: { id?: string };
      };
      setPayslipItemForm(DEFAULT_PAYSLIP_ITEM_FORM);
      await refreshAll();
      const newItemId = result.item?.id;
      if (!newItemId) {
        toast.success("פריט התלוש נוסף.");
        return;
      }
      registerReversibleCreate({
        scope: "payslip-item",
        id: newItemId,
        message: "פריט התלוש נוסף.",
        onUndo: async () => {
          const response = await fetch("/api/payroll/payslip-items", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ item_id: newItemId, payslip_id: payslipId }),
          });
          const json = (await response.json().catch(() => ({}))) as { error?: string };
          if (!response.ok) return { ok: false, error: toHebrewError(json.error, "הביטול נכשל.") };
          await refreshAll();
          return { ok: true };
        },
      });
    });
  }

  function deletePayslipItem(itemId: string, payslipId: string) {
    scheduleDeferredDelete({
      scope: "payslip-item",
      id: itemId,
      message: "פריט התלוש נמחק.",
      onCommit: async () => {
        const response = await fetch("/api/payroll/payslip-items", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ item_id: itemId, payslip_id: payslipId }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return { ok: false, error: toHebrewError(json.error, "המחיקה נכשלה.") };
        await refreshAll();
        return { ok: true };
      },
    });
  }

  // ── בונוסים ───────────────────────────────────────────────────────────────
  // An admin's bonus is approved on the spot (he IS the approval); the pending
  // ones arrive from workers reporting their own and are settled below.

  function openNewBonusDialog(userId: string) {
    setBonusError("");
    setBonusForm({ ...DEFAULT_BONUS_FORM, user_id: userId, bonus_date: todayIsoDate() });
    setBonusDialogOpen(true);
  }

  function saveBonus() {
    const amount = toNumber(bonusForm.amount);
    if (!bonusForm.user_id) {
      setBonusError("יש לבחור עובד.");
      return;
    }
    if (!bonusForm.bonus_date) {
      setBonusError("יש לבחור תאריך.");
      return;
    }
    if (!(amount > 0)) {
      setBonusError("יש להזין סכום בונוס חיובי.");
      return;
    }

    setBonusError("");
    runAction(async () => {
      const response = await fetch("/api/payroll/bonuses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: bonusForm.user_id,
          bonus_date: bonusForm.bonus_date,
          amount,
          notes: bonusForm.notes,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string; item?: { id?: string } };
      if (!response.ok) throw new Error(toHebrewError(json.error, "שמירת הבונוס נכשלה."));
      setBonusDialogOpen(false);
      setBonusForm(DEFAULT_BONUS_FORM);
      await refreshAll();
      const newBonusId = json.item?.id;
      if (!newBonusId) {
        toast.success("הבונוס נוסף לתלוש של אותו חודש.");
        return;
      }
      registerReversibleCreate({
        scope: "payslip-item",
        id: newBonusId,
        message: "הבונוס נוסף לתלוש של אותו חודש.",
        onUndo: async () => {
          const undoResponse = await fetch("/api/payroll/bonuses", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ item_id: newBonusId }),
          });
          const undoJson = (await undoResponse.json().catch(() => ({}))) as { error?: string };
          if (!undoResponse.ok) return { ok: false, error: toHebrewError(undoJson.error, "הביטול נכשל.") };
          await refreshAll();
          return { ok: true };
        },
      });
    });
  }

  // ── ימי חופש / היעדרות ────────────────────────────────────────────────────

  function openAbsenceDialog(userId: string) {
    setAbsenceError("");
    setAbsenceForm({ ...DEFAULT_ABSENCE_FORM, user_id: userId, absence_date: todayIsoDate() });
    setAbsenceDialogOpen(true);
  }

  function saveAbsence() {
    // "כל העובדים" = every active worker who has a salary agreement type at all —
    // the same people the hours sheet is built from, so nobody gets a day off row
    // on a sheet they don't appear in.
    const targetIds = absenceForm.applyToAll
      ? absenceEligibleWorkers.map((worker) => worker.id)
      : absenceForm.user_id
        ? [absenceForm.user_id]
        : [];

    if (targetIds.length === 0) {
      setAbsenceError(absenceForm.applyToAll ? "לא נמצאו עובדים פעילים." : "יש לבחור עובד.");
      return;
    }
    if (!absenceForm.absence_date) {
      setAbsenceError("יש לבחור תאריך.");
      return;
    }

    setAbsenceError("");
    runAction(async () => {
      const result = await createWorkerAbsences({
        userIds: targetIds,
        absenceDate: absenceForm.absence_date,
        absenceType: absenceForm.absence_type,
        notes: absenceForm.notes,
      });
      if (!result.ok) throw new Error(toHebrewError(result.error, "שמירת ההיעדרות נכשלה."));
      const added = result.added;
      setAbsenceDialogOpen(false);
      setAbsenceForm(DEFAULT_ABSENCE_FORM);
      // Say how many actually landed — with "all workers" the difference between
      // "12 marked" and "already marked" is the whole answer.
      toast.success(
        added === 0
          ? "היום הזה כבר סומן."
          : targetIds.length > 1
            ? `היום סומן כהיעדרות ל-${added} עובדים.`
            : "היום סומן כהיעדרות."
      );
      await refreshAll();
    });
  }

  function lockSalaryData() {
    runAction(async () => {
      await fetch("/api/payroll/admin/lock", { method: "POST" });
      setProtectedData(null);
      setSalaryUnlocked(false);
      setProtectedError("");
      toast.success("נתוני השכר ננעלו.");
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
    setEditingWorkerPaymentSnapshot(null);
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
      toast.error("לא נמצא פריט חוב פתוח עבור התלוש הזה.");
      return;
    }
    setSelectedWorkerId(payslip.user_id);
    openWorkerPaymentDialogForItems(payslip.user_id, [debtItem], toNumber(debtItem.owed_amount));
  }

  function openEditWorkerPaymentDialog(payment: WorkerPaymentRow) {
    const existingAllocations = workerPaymentAllocationsByPaymentId.get(payment.id) ?? [];
    setEditingWorkerPaymentSnapshot({
      payment,
      allocations: existingAllocations
        .map((allocation) => {
          const sourceId =
            allocation.source_type === "session" ? allocation.attendance_session_id : allocation.payslip_id;
          if (!sourceId) return null;
          return {
            source_type: allocation.source_type,
            source_id: sourceId,
            amount: toNumber(allocation.amount),
          };
        })
        .filter((allocation): allocation is { source_type: "session" | "payslip"; source_id: string; amount: number } =>
          Boolean(allocation)
        ),
    });
    const allocations = existingAllocations
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
      account_id: payment.account_id ?? "",
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
    if (workerPaymentAccountsList.length > 0 && !workerPaymentForm.account_id) {
      setWorkerPaymentError("יש לבחור חשבון לתנועה.");
      return;
    }
    // Allocations are optional: a payment can be recorded even when the worker has
    // no open debt (an advance / general payment). Only block allocating MORE than
    // was actually paid; an unallocated remainder is allowed.
    if (allocationTotal - amount > 0.01) {
      setWorkerPaymentError("סכום ההקצאות לא יכול לעלות על סכום התשלום.");
      return;
    }

    const editingPaymentId = workerPaymentForm.payment_id;
    const previousSnapshot = editingPaymentId ? editingWorkerPaymentSnapshot : null;
    const editedUserId = workerPaymentForm.user_id;
    runAction(async () => {
      const path = "/api/payroll/worker-payments";
      const response = await fetch(path, {
        method: editingPaymentId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payment_id: editingPaymentId || undefined,
          user_id: editedUserId,
          payment_date: workerPaymentForm.payment_date,
          amount,
          payment_method: workerPaymentForm.payment_method.trim() || null,
          account_id: workerPaymentForm.account_id || null,
          reference_number: workerPaymentForm.reference_number.trim() || null,
          notes: workerPaymentForm.notes.trim() || null,
          allocations: activeAllocations.map((allocation) => ({
            source_type: allocation.source_type,
            source_id: allocation.source_id,
            amount: allocation.parsedAmount,
          })),
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        payment?: { id?: string };
      };
      if (!response.ok) {
        throw new Error(toHebrewError(json.error, "Request failed."));
      }
      setWorkerPaymentDialogOpen(false);
      setWorkerPaymentForm(DEFAULT_WORKER_PAYMENT_FORM);
      setEditingWorkerPaymentSnapshot(null);
      setWorkerPaymentError("");
      await refreshAll();

      if (editingPaymentId && previousSnapshot) {
        // EDIT — undo resends the exact pre-edit payment + allocations
        // through the same route (see EditWorkerPaymentDialog for the same
        // pattern on the bank-register version of this edit).
        registerReversibleAction({
          key: `worker-payment:edit:${editingPaymentId}`,
          message: "תשלום לעובד עודכן.",
          onUndo: async () => {
            const previousPayment = previousSnapshot.payment;
            const undoResponse = await fetch("/api/payroll/worker-payments", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                payment_id: editingPaymentId,
                user_id: previousPayment.user_id,
                payment_date: previousPayment.payment_date,
                amount: toNumber(previousPayment.amount),
                payment_method: previousPayment.payment_method,
                account_id: previousPayment.account_id,
                reference_number: previousPayment.reference_number,
                notes: previousPayment.notes,
                allocations: previousSnapshot.allocations,
              }),
            });
            const undoJson = (await undoResponse.json().catch(() => ({}))) as { error?: string };
            if (!undoResponse.ok) return { ok: false, error: toHebrewError(undoJson.error, "הביטול נכשל.") };
            await refreshAll();
            return { ok: true };
          },
        });
        return;
      }

      // CREATE — undo deletes the newly-created payment via the existing
      // delete route (same one deleteWorkerPayment uses).
      const newPaymentId = json.payment?.id;
      if (!newPaymentId) {
        toast.success("תשלום לעובד נשמר.");
        return;
      }
      registerReversibleCreate({
        scope: "worker-payment",
        id: newPaymentId,
        message: "תשלום לעובד נשמר.",
        onUndo: async () => {
          const undoResponse = await fetch("/api/payroll/worker-payments", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ payment_id: newPaymentId, user_id: editedUserId }),
          });
          const undoJson = (await undoResponse.json().catch(() => ({}))) as { error?: string };
          if (!undoResponse.ok) return { ok: false, error: toHebrewError(undoJson.error, "הביטול נכשל.") };
          await refreshAll();
          return { ok: true };
        },
      });
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

    // Session/agreement/absence/bonus/payment deletes are DEFERRED: the row
    // hides immediately via the matching useUndoOverlay scope, and the real
    // delete call only fires ~6s later (in onCommit) unless undone — nothing
    // reaches the server if the user hits "בטל". Worker deactivation stays
    // commit-immediate below (it isn't a list-hide operation — see saveWorkerAccess).
    if (pending.kind === "session") {
      const sessionId = pending.sessionId;
      setPendingDeletion(null);
      if (sessionForm.session_id === sessionId) {
        setSessionDialogOpen(false);
      }
      scheduleDeferredDelete({
        scope: "payroll-session",
        id: sessionId,
        message: "המשמרת נמחקה.",
        onCommit: async () => {
          try {
            await postJson("/api/payroll/sessions/delete", { session_id: sessionId });
          } catch (deleteError: unknown) {
            return { ok: false, error: toHebrewError(deleteError, "המחיקה נכשלה.") };
          }
          await refreshAll();
          return { ok: true };
        },
      });
      return;
    }

    if (pending.kind === "agreement") {
      const { agreementId, userId } = pending;
      setPendingDeletion(null);
      scheduleDeferredDelete({
        scope: "salary-agreement",
        id: agreementId,
        message: "המשכורת נמחקה.",
        onCommit: async () => {
          try {
            await postJson("/api/payroll/salary-agreements", {
              action: "delete",
              agreement_id: agreementId,
              user_id: userId,
            });
          } catch (deleteError: unknown) {
            return { ok: false, error: toHebrewError(deleteError, "המחיקה נכשלה.") };
          }
          await refreshAll();
          return { ok: true };
        },
      });
      return;
    }

    if (pending.kind === "absence") {
      const absenceId = pending.absenceId;
      setPendingDeletion(null);
      scheduleDeferredDelete({
        scope: "worker-absence",
        id: absenceId,
        message: "ההיעדרות נמחקה.",
        onCommit: async () => {
          const result = await deleteWorkerAbsence(absenceId);
          if (!result.ok) return { ok: false, error: toHebrewError(result.error, "המחיקה נכשלה.") };
          await refreshAll();
          return { ok: true };
        },
      });
      return;
    }

    if (pending.kind === "bonus") {
      const bonusId = pending.bonusId;
      setPendingDeletion(null);
      scheduleDeferredDelete({
        scope: "payslip-item",
        id: bonusId,
        message: "הבונוס נמחק.",
        onCommit: async () => {
          const response = await fetch("/api/payroll/bonuses", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ item_id: bonusId }),
          });
          const json = (await response.json().catch(() => ({}))) as { error?: string };
          if (!response.ok) return { ok: false, error: toHebrewError(json.error, "המחיקה נכשלה.") };
          await refreshAll();
          return { ok: true };
        },
      });
      return;
    }

    if (pending.kind === "worker") {
      const workerId = pending.userId;
      const worker = usersById.get(workerId) ?? null;
      const previousSnapshot = worker ? workerFormFromUser(worker) : null;
      runAction(async () => {
        await postJson("/api/payroll/workers/delete", {
          user_id: workerId,
        });
        setWorkerAccessDialogOpen(false);
        setSelectedWorkerId("");
        setPendingDeletion(null);
        if (previousSnapshot) {
          registerReversibleAction({
            key: `worker-access:edit:${workerId}`,
            message: "העובד הוסר מהרשימה הפעילה.",
            onUndo: () => applyWorkerAccessSnapshot(workerId, previousSnapshot),
          });
        } else {
          toast.success("העובד הוסר מהרשימה הפעילה.");
        }
        if (isWorkerDetailMode) {
          router.push("/payroll");
          return;
        }
        await refreshAll();
      });
      return;
    }

    // payment
    const paymentId = pending.paymentId;
    const userId = pending.userId;
    if (workerPaymentForm.payment_id === paymentId) {
      setWorkerPaymentDialogOpen(false);
      setWorkerPaymentForm(DEFAULT_WORKER_PAYMENT_FORM);
      setWorkerPaymentError("");
    }
    setPendingDeletion(null);
    scheduleDeferredDelete({
      scope: "worker-payment",
      id: paymentId,
      message: "תשלום לעובד נמחק.",
      onCommit: async () => {
        const response = await fetch("/api/payroll/worker-payments", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payment_id: paymentId, user_id: userId }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return { ok: false, error: toHebrewError(json.error, "המחיקה נכשלה.") };
        await refreshAll();
        return { ok: true };
      },
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
    if (pendingDeletion.kind === "bonus") {
      return {
        title: "מחיקת בונוס",
        description: "הפעולה תמחק את הבונוס ואת החוב שנוצר ממנו.",
        label: pendingDeletion.amountLabel,
      };
    }
    if (pendingDeletion.kind === "absence") {
      return {
        title: "מחיקת היעדרות",
        description: "היום יחזור להיות יום עבודה רגיל בגליון השעות.",
        label: pendingDeletion.dateLabel,
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
  const selectedWorkerBonuses = useMemo(() => {
    if (!selectedWorker) return [];
    return workerBonuses
      .filter((bonus) => bonus.user_id === selectedWorker.id)
      .sort((a, b) => (b.item_date ?? "").localeCompare(a.item_date ?? ""));
  }, [selectedWorker, workerBonuses]);
  const selectedWorkerAbsences = useMemo(() => {
    if (!selectedWorker) return [];
    return workerAbsences
      .filter((absence) => absence.user_id === selectedWorker.id)
      .sort((a, b) => (b.absence_date ?? "").localeCompare(a.absence_date ?? ""));
  }, [selectedWorker, workerAbsences]);
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
  // Which payroll month each payslip settles, so a payslip-allocated payment can be
  // attributed to the period the WORK was done in (not the date it was paid out).
  const payslipPeriodMonthById = useMemo(() => {
    const next = new Map<string, string | null>();
    payslips.forEach((payslip) => {
      next.set(payslip.id, periodsById.get(payslip.payroll_period_id)?.period_month ?? null);
    });
    return next;
  }, [payslips, periodsById]);
  // For each payroll month, what fraction of that month's total shift cost is actually
  // shown in this print (after the project filter). A payslip payment settles a whole
  // month across all projects, so under a project filter we credit only that project's
  // share of the month. With no project filter every share is 1 (the full payment counts).
  const printedMonthCostShare = useMemo(() => {
    const allByMonth = new Map<string, number>();
    const printedByMonth = new Map<string, number>();
    for (const session of selectedWorkerSessions) {
      const monthKey = monthKeyFromDate(session.clock_in);
      allByMonth.set(monthKey, (allByMonth.get(monthKey) ?? 0) + (sessionCostsById.get(session.id) ?? 0));
    }
    for (const session of selectedWorkerPrintSessions) {
      const monthKey = monthKeyFromDate(session.clock_in);
      printedByMonth.set(monthKey, (printedByMonth.get(monthKey) ?? 0) + (sessionCostsById.get(session.id) ?? 0));
    }
    const share = new Map<string, number>();
    for (const [monthKey, printedCost] of printedByMonth) {
      const allCost = allByMonth.get(monthKey) ?? 0;
      share.set(monthKey, allCost > 0.009 ? Math.min(1, printedCost / allCost) : 0);
    }
    return share;
  }, [selectedWorkerSessions, selectedWorkerPrintSessions, sessionCostsById]);
  const selectedWorkerPrintPayments = useMemo(() => {
    const noPeriodFilter = !workerPrintFilters.month && !workerPrintFilters.year;
    // Does a payslip's period ("YYYY-MM") fall inside the printed month/year?
    const payslipMonthInPeriod = (periodMonth: string | null | undefined) => {
      if (noPeriodFilter) return true;
      if (!periodMonth) return false;
      const [year, month] = periodMonth.split("-");
      if (workerPrintFilters.year && year !== workerPrintFilters.year) return false;
      if (workerPrintFilters.month && month !== workerPrintFilters.month) return false;
      return true;
    };
    // "Paid in the period" means money that settles work DONE in the period — keyed to
    // the work each allocation covers (the session's month, or the payslip's period),
    // NOT the calendar date the payment was recorded. A worker paid on the 10th for the
    // previous month's work: that payment belongs to the previous month, not the month
    // it landed in. Session/payslip allocations carry that link; only truly unallocated
    // payments (advances) have no work to key on, so they fall back to the payment date.
    return selectedWorkerPayments
      .map((payment) => {
        const allocations = workerPaymentAllocationsByPaymentId.get(payment.id) ?? [];
        if (allocations.length === 0) {
          // Unallocated payment (e.g. an advance): no work to attribute it to. Only show
          // it in an all-months, all-projects print, where it still belongs to the total.
          if (workerPrintFilters.projectId || !noPeriodFilter) return null;
          return { payment, scopedAmount: toNumber(payment.amount) };
        }
        const scopedAmount = allocations.reduce((sum, allocation) => {
          if (allocation.source_type === "session") {
            // selectedWorkerPrintSessionIds already respects the month/year/project filters.
            return allocation.attendance_session_id &&
              selectedWorkerPrintSessionIds.has(allocation.attendance_session_id)
              ? sum + toNumber(allocation.amount)
              : sum;
          }
          // Payslip allocation: settles a whole payroll month across projects. Count it
          // for the printed period, scoped to the filtered project's share of that month.
          const periodMonth = allocation.payslip_id
            ? workerDebtItemsBySourceKey.get(`payslip:${allocation.payslip_id}`)?.period_month ??
              payslipPeriodMonthById.get(allocation.payslip_id) ??
              null
            : null;
          if (!periodMonth || !payslipMonthInPeriod(periodMonth)) return sum;
          const share = workerPrintFilters.projectId ? printedMonthCostShare.get(periodMonth) ?? 0 : 1;
          return sum + toNumber(allocation.amount) * share;
        }, 0);
        if (scopedAmount <= 0.009) return null;
        return { payment, scopedAmount };
      })
      .filter(
        (item): item is { payment: WorkerPaymentRow; scopedAmount: number } =>
          Boolean(item)
      );
  }, [
    selectedWorkerPayments,
    workerPaymentAllocationsByPaymentId,
    workerDebtItemsBySourceKey,
    selectedWorkerPrintSessionIds,
    payslipPeriodMonthById,
    printedMonthCostShare,
    workerPrintFilters,
  ]);
  const selectedWorkerPrintSummary = useMemo(() => {
    const noPeriodFilter = !workerPrintFilters.month && !workerPrintFilters.year;
    const monthInPeriod = (periodMonth: string | null | undefined) => {
      if (noPeriodFilter) return true;
      if (!periodMonth) return false;
      const [year, month] = periodMonth.split("-");
      if (workerPrintFilters.year && year !== workerPrintFilters.year) return false;
      if (workerPrintFilters.month && month !== workerPrintFilters.month) return false;
      return true;
    };
    // Earned = the shifts shown in "פירוט עבודה" (session cost) — correct for both worker
    // modes and matches the table the worker is looking at.
    const sessionEarned = selectedWorkerPrintSessions.reduce((sum, session) => {
      const debtItem = workerDebtItemsBySourceKey.get(`session:${session.id}`) ?? null;
      return sum + (debtItem ? toNumber(debtItem.earned_amount) : sessionCostsById.get(session.id) ?? 0);
    }, 0);
    // Bonuses need nothing here: they're רכיבי שכר inside the month's payslip, so
    // they're already in the payslip debt row this reads for `paid`.
    const earned = sessionEarned;
    // Paid = the SAME per-item paid_amount the rest of the salary center trusts, straight
    // from worker_debt_items_view (so the number matches every other screen and correctly
    // reflects fully-paid months). Session-tracked workers have a debt row per shift;
    // payslip-tracked workers are paid on the monthly payslip (one row per month), which
    // we scope to the filtered project's share of that month. Owed = earned − paid.
    const debtItems = selectedWorker ? workerDebtItemsByUserId.get(selectedWorker.id) ?? [] : [];
    let paid = 0;
    for (const item of debtItems) {
      if (item.source_type === "session") {
        if (selectedWorkerPrintSessionIds.has(item.source_id)) paid += toNumber(item.paid_amount);
        continue;
      }
      if (!monthInPeriod(item.period_month)) continue;
      const share = workerPrintFilters.projectId ? printedMonthCostShare.get(item.period_month ?? "") ?? 0 : 1;
      paid += toNumber(item.paid_amount) * share;
    }
    // Unallocated payments (advances) aren't tied to any month's work, so — mirroring the
    // payments list — they only count toward an all-months, all-projects total.
    if (noPeriodFilter && !workerPrintFilters.projectId) {
      for (const payment of selectedWorkerPayments) {
        if ((workerPaymentAllocationsByPaymentId.get(payment.id) ?? []).length === 0) {
          paid += toNumber(payment.amount);
        }
      }
    }
    return { earned, paid, owed: earned - paid };
  }, [
    selectedWorker,
    workerDebtItemsByUserId,
    selectedWorkerPayments,
    workerPaymentAllocationsByPaymentId,
    selectedWorkerPrintSessions,
    selectedWorkerPrintSessionIds,
    workerDebtItemsBySourceKey,
    sessionCostsById,
    printedMonthCostShare,
    workerPrintFilters,
  ]);
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
    const workRowsHtml = workRowData
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
      });
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
    const paymentRowsHtml = selectedWorkerPrintPayments
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
      });
    const paymentTableHeaders = `<th>תאריך תשלום</th><th>סכום</th><th>איך שולם</th><th>הערות</th>`;

    const headerHtml = `
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
    `;

    const printHtml = buildWorkerSummaryPrintDocument({
      docTitle: `סיכום עובד - ${workerName}`,
      headerHtml,
      tables: [
        {
          title: "פירוט עבודה",
          headers: workTableHeaders,
          rows: workRowsHtml,
          empty: "אין משמרות להצגה למסננים שנבחרו.",
        },
        {
          title: "פירוט תשלומים",
          headers: paymentTableHeaders,
          rows: paymentRowsHtml,
          empty: "אין תשלומים שמורים למסננים שנבחרו.",
        },
      ],
    });
    openWorkerSummaryPrintWindow(printHtml);
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

  /**
   * The approved bonuses folded into a payslip's gross — the same set
   * generatePayslipsForPeriod summed server-side (approved, dated inside the
   * period), so the printed breakdown always adds up to the ברוטו above it.
   */
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
      {protectedError ? (
        <Card>
          <CardContent className="space-y-2 py-4 text-sm">
            <div className="text-destructive">{protectedError}</div>
          </CardContent>
        </Card>
      ) : null}

      {!isWorkerDetailMode ? <>
      {/* Top row: month picker at the start (right in RTL), search in the middle, create actions at the end. */}
      <div className="flex flex-col items-center gap-2 py-1 sm:flex-row sm:justify-between">
        <NativeSelect
          value={selectedSummaryMonth}
          onChange={(event) => setSelectedSummaryMonth(event.target.value)} className="w-auto shrink-0 border-0 bg-transparent px-0 text-center text-lg font-semibold shadow-none sm:text-right"
        >
          {selectedSummaryMonthOptions.map((monthKey) => (
            <option key={monthKey} value={monthKey}>
              {monthLabelFromKey(monthKey)}
            </option>
          ))}
        </NativeSelect>

        <Input
          name="payroll_worker_search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="חיפוש עובד לפי שם, אימייל או טלפון"
          autoComplete="off"
          spellCheck={false}
          data-lpignore="true"
          className="w-full max-w-sm text-right sm:mx-2"
        />

        <div className="flex shrink-0 flex-wrap justify-center gap-2 sm:flex-nowrap">
          {/* No generic "הוספת משמרת" + here — "משמרת ידנית" is a tile in the
              app's one quick-create +. The per-worker "הוסף משמרת" below stays:
              it opens on the worker you have selected. */}
          {canCreateUsers ? (
            <Button variant="outline" onClick={() => setCreateUserOpen(true)}>
              <AddIcon className="h-4 w-4" />
              {"הוספת משתמש"}
            </Button>
          ) : null}
          {false ? (
            <Button variant="outline" onClick={() => lockSalaryData()}>
              <LockIcon className="h-4 w-4" />
              {"נעילת נתוני שכר"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Totals + per-worker-type breakdown share one row: five stats, one card. */}
      <SalaryProtected
        unlocked={salaryUnlocked}
        hasPasswordConfigured={hasPasswordConfigured}
        canUnlock={canViewSalary}
        onUnlockSuccess={loadProtectedData}
        fallback={
          <Card>
            <CardContent className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-3 lg:grid-cols-5">
              <MiniStat label="עלות עבודה החודש" value="מוגן" strong />
              <MiniStat label="יתרה לעובדים" value="מוגן" strong />
              <MiniStat label="קבלנות" value="מוגן" />
              <MiniStat label="שעתי עם תלוש" value="מוגן" />
              <MiniStat label="חודשי גלובלי" value="מוגן" />
            </CardContent>
          </Card>
        }
      >
        <Card>
          <CardContent className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-3 lg:grid-cols-5">
            <MiniStat
              label="עלות עבודה החודש"
              loading={protectedLoading}
              value={formatCurrency(summary.totalLaborCost)}
              strong
            />
            <MiniStat
              label="יתרה לעובדים"
              loading={protectedLoading}
              value={formatCurrency(summary.totalWorkerOwed)}
              strong
            />
            <MiniStat
              label="קבלנות"
              loading={protectedLoading}
              value={`${formatMinutes(summary.sessionOnlyMinutes)} • ${formatCurrency(summary.sessionOnlyAmount)}`}
            />
            <MiniStat
              label="שעתי עם תלוש"
              loading={protectedLoading}
              value={`${formatMinutes(summary.hourlyPayslipMinutes)} • ${formatCurrency(summary.hourlyPayslipAmount)}`}
            />
            <MiniStat
              label="חודשי גלובלי"
              loading={protectedLoading}
              value={`${summary.monthlyPayslipWorkers} עובדים • ${formatCurrency(summary.monthlyPayslipAmount)}`}
            />
          </CardContent>
        </Card>
      </SalaryProtected>

      <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
        <TabsList variant="underline" className="sm:justify-center">
          <TabsTrigger value="employees"><UsersIcon className="h-4 w-4" />עובדים</TabsTrigger>
          <TabsTrigger value="labor"><LaborIcon className="h-4 w-4" />פועלים</TabsTrigger>
          <TabsTrigger value="attendance"><CalendarCheckIcon className="h-4 w-4" />נוכחות</TabsTrigger>
          {canManageSalary ? <TabsTrigger value="agreements"><WalletIcon className="h-4 w-4" />משכורות</TabsTrigger> : null}
          {canManageSalary ? <TabsTrigger value="payslips"><ReceiptIcon className="h-4 w-4" />תקופות ותלושים</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="employees" className="space-y-3">
          <Card>
            <CardContent className="py-4">
              {/* Narrow screens / large font: stacked cards instead of the 11-column
                  table (which overflows sideways and squashes the email char-by-char).
                  Plain block flow (not `grid`) so a card can never be stretched wider
                  than the viewport by its own nowrap content (email / amounts). */}
              <ResponsiveDataView
                breakpoint="lg"
                mobile={
                  <div className="space-y-3">
                    {employeeWorkers.length === 0 ? (
                      <EmptyState dense>
                        {"אין עובדים להצגה."}
                      </EmptyState>
                    ) : (
                      employeeWorkers.map((worker) => {
                        const workerType = normalizePayrollWorkerType(worker.payroll_worker_type, worker.pay_tracking_mode);
                        const monthStats = currentMonthPayrollStatsByUserId.get(worker.id) ?? { totalMinutes: 0, totalAmount: 0, sessionCount: 0 };
                        const balance = effectiveWorkerBalancesByUserId.get(worker.id) ?? null;
                        return (
                          <div
                            key={worker.id}
                            className="cursor-pointer rounded-2xl border bg-background p-4 text-right shadow-sm transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                            {...rowNavigateProps(router, `/payroll/workers/${worker.id}`, { role: "button" })}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-semibold">{worker.full_name ?? worker.email ?? "עובד"}</div>
                                {worker.phone ? <div className="text-sm text-muted-foreground" dir="ltr">{worker.phone}</div> : null}
                                {worker.email ? <div className="truncate text-xs text-muted-foreground" dir="ltr">{worker.email}</div> : null}
                                {!worker.email && !worker.phone ? <div className="text-xs text-muted-foreground">{"ללא פרטי קשר"}</div> : null}
                              </div>
                              <StatusPill tone={worker.active === false ? "muted" : "success"}>
                                {worker.active === false ? "לא פעיל" : "פעיל"}
                              </StatusPill>
                            </div>

                            <div className="mt-3 flex flex-wrap justify-center gap-2">
                              <WorkerTypeBadge workerType={workerType} />
                              <RoleBadge role={worker.role} />
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-3">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<MiniStat label="יתרה כוללת" value="מוגן" />}
                              >
                                <MiniStat label="יתרה כוללת" loading={protectedLoading} value={formatCurrency(balance?.owed_amount ?? 0)} />
                              </SalaryProtected>
                              {workerType === "session_only" ? (
                                <MiniStat label="משמרות החודש" value={String(monthStats.sessionCount)} />
                              ) : payrollWorkerTypeAllowsSessions(workerType) ? (
                                <MiniStat label="שעות החודש" loading={protectedLoading} value={formatMinutes(monthStats.totalMinutes)} />
                              ) : null}
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-2">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span />}
                              >
                                <PaymentStatusBadge status={balance?.payment_status} owedAmount={balance?.owed_amount} />
                              </SalaryProtected>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  emitNavigationStart();
                                  router.push(`/payroll/workers/${worker.id}`);
                                }}
                              >
                                {"פרטים"}
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                }
                desktop={
                  <div className="max-h-[70vh] overflow-auto">
                    <table className="w-full text-center text-xs">
                      <thead className="sticky top-0 z-10 bg-muted">
                        <tr className="border-b text-muted-foreground">
                          <th className="px-2 py-2 font-medium">עובד</th>
                          <th className="px-2 py-2 font-medium">סטטוס</th>
                          <th className="px-2 py-2 font-medium">סוג עובד</th>
                          <th className="px-2 py-2 font-medium">שעות החודש</th>
                          <th className="px-2 py-2 font-medium">משכורת נוכחית</th>
                          <th className="px-2 py-2 font-medium">עלות עבודה החודש</th>
                          <th className="px-2 py-2 font-medium">תלוש אחרון</th>
                          <th className="px-2 py-2 font-medium">סטטוס תשלום</th>
                          <th className="px-2 py-2 font-medium">שולם כולל</th>
                          <th className="px-2 py-2 font-medium">יתרה כוללת</th>
                          <th className="px-2 py-2 font-medium">פעולות</th>
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
                              sessionCount: 0,
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
                                {...rowNavigateProps(router, `/payroll/workers/${worker.id}`, { role: "button" })}
                              >
                                <td className="px-2 py-2 font-medium w-[180px]">
                                  <div className="flex flex-col items-center gap-1">
                                    <div>{worker.full_name ?? worker.email ?? "עובד"}</div>
                                    <div className="flex flex-col items-center text-muted-foreground break-all">
                                      {worker.email ? <div dir="ltr">{worker.email}</div> : null}
                                      {worker.phone ? <div dir="ltr">{worker.phone}</div> : null}
                                      {!worker.email && !worker.phone ? <div>ללא פרטי קשר</div> : null}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-2 py-2">
                                  <div className="flex flex-col items-center gap-1">
                                    <RoleBadge role={worker.role} />
                                    <AccessBadge hasAccess={getWorkerAccessLabel(worker) === "עם גישה"} />
                                    <StatusPill tone={worker.active === false ? "muted" : "success"}>
                                      {worker.active === false ? "לא פעיל" : "פעיל"}
                                    </StatusPill>
                                  </div>
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap">
                                  <WorkerTypeBadge workerType={workerType} />
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap">
                                  {payrollWorkerTypeAllowsSessions(workerType) ? formatMinutes(monthStats.totalMinutes) : "-"}
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap">
                                  <SalaryProtected
                                    unlocked={salaryUnlocked}
                                    hasPasswordConfigured={hasPasswordConfigured}
                                    canUnlock={canViewSalary}
                                    onUnlockSuccess={loadProtectedData}
                                    fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                                  >
                                    {protectedLoading ? (
                                      <LoadingDots />
                                    ) : currentAgreement ? (
                                      currentAgreement.salary_type === "hourly"
                                        ? `${formatCurrency(currentAgreement.hourly_rate)} / שעה`
                                        : formatCurrency(currentAgreement.monthly_salary)
                                    ) : (
                                      "-"
                                    )}
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
                                    {protectedLoading ? <LoadingDots /> : formatCurrency(monthlyLaborCost)}
                                  </SalaryProtected>
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap">{latestPayslip ? formatCurrency(latestPayslip.gross_salary) : "-"}</td>
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
                                <td className="px-3 py-3">
                                  <SalaryProtected
                                    unlocked={salaryUnlocked}
                                    hasPasswordConfigured={hasPasswordConfigured}
                                    canUnlock={canViewSalary}
                                    onUnlockSuccess={loadProtectedData}
                                    fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                                  >
                                    {protectedLoading ? <LoadingDots /> : formatCurrency(balance?.paid_amount ?? 0)}
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
                                    {protectedLoading ? <LoadingDots /> : formatCurrency(balance?.owed_amount ?? 0)}
                                  </SalaryProtected>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex flex-wrap justify-center gap-2">
                                    <Button variant="outline" size="sm" onClick={() => { emitNavigationStart(); router.push(`/payroll/workers/${worker.id}`); }}>
                                      {"פרטים"}
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                  </table>
                </div>
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="labor" className="space-y-3">
          <Card>
            <CardContent className="py-4">
              {/* Narrow screens / large font: stacked cards instead of the wide table.
                  Plain block flow (not `grid`) so a card can never be stretched wider
                  than the viewport by its own nowrap content (email / amounts). */}
              <ResponsiveDataView
                breakpoint="lg"
                mobile={
                  <div className="space-y-3">
                    {laborWorkers.length === 0 ? (
                      <EmptyState dense>
                        {"אין פועלים להצגה."}
                      </EmptyState>
                    ) : (
                      laborWorkers.map((worker) => {
                        const workerType = normalizePayrollWorkerType(worker.payroll_worker_type, worker.pay_tracking_mode);
                        const monthStats = currentMonthPayrollStatsByUserId.get(worker.id) ?? { totalMinutes: 0, totalAmount: 0, sessionCount: 0 };
                        const balance = effectiveWorkerBalancesByUserId.get(worker.id) ?? null;
                        return (
                          <div
                            key={worker.id}
                            className="cursor-pointer rounded-2xl border bg-background p-4 text-right shadow-sm transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                            {...rowNavigateProps(router, `/payroll/workers/${worker.id}`, { role: "button" })}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-semibold">{worker.full_name ?? worker.email ?? "פועל"}</div>
                                {worker.phone ? <div className="text-sm text-muted-foreground" dir="ltr">{worker.phone}</div> : null}
                                {worker.email ? <div className="truncate text-xs text-muted-foreground" dir="ltr">{worker.email}</div> : null}
                                {!worker.email && !worker.phone ? <div className="text-xs text-muted-foreground">{"ללא פרטי קשר"}</div> : null}
                              </div>
                              <StatusPill tone={worker.active === false ? "muted" : "success"}>
                                {worker.active === false ? "לא פעיל" : "פעיל"}
                              </StatusPill>
                            </div>

                            <div className="mt-3 flex flex-wrap justify-center gap-2">
                              <WorkerTypeBadge workerType={workerType} />
                              <StatusPill tone="info">{"פועל"}</StatusPill>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-3">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<MiniStat label="יתרה כוללת" value="מוגן" />}
                              >
                                <MiniStat label="יתרה כוללת" loading={protectedLoading} value={formatCurrency(balance?.owed_amount ?? 0)} />
                              </SalaryProtected>
                              {workerType === "session_only" ? (
                                <MiniStat label="משמרות החודש" value={String(monthStats.sessionCount)} />
                              ) : payrollWorkerTypeAllowsSessions(workerType) ? (
                                <MiniStat label="שעות החודש" loading={protectedLoading} value={formatMinutes(monthStats.totalMinutes)} />
                              ) : null}
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-2">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canViewSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span />}
                              >
                                <PaymentStatusBadge status={balance?.payment_status} owedAmount={balance?.owed_amount} />
                              </SalaryProtected>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  emitNavigationStart();
                                  router.push(`/payroll/workers/${worker.id}`);
                                }}
                              >
                                {"פרטים"}
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                }
                desktop={
                  <div className="max-h-[70vh] overflow-auto">
                    <table className="w-full text-center text-xs">
                      <thead className="sticky top-0 z-10 bg-muted">
                        <tr className="border-b text-muted-foreground">
                          <th className="px-2 py-2 font-medium">פועל</th>
                          <th className="px-2 py-2 font-medium">סטטוס</th>
                          <th className="px-2 py-2 font-medium">סוג עובד</th>
                          <th className="px-2 py-2 font-medium">שעות החודש</th>
                          <th className="px-2 py-2 font-medium">סטטוס תשלום</th>
                          <th className="px-2 py-2 font-medium">שולם כולל</th>
                          <th className="px-2 py-2 font-medium">יתרה כוללת</th>
                          <th className="px-2 py-2 font-medium">פעולות</th>
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
                              sessionCount: 0,
                            };
                            const balance = effectiveWorkerBalancesByUserId.get(worker.id) ?? null;
                            const rowClass = index % 2 === 0 ? "bg-muted/20" : "bg-background";

                            return (
                              <tr
                                key={worker.id}
                                className={`cursor-pointer border-b align-top hover:bg-muted/40 focus-visible:bg-muted/40 ${rowClass}`}
                                {...rowNavigateProps(router, `/payroll/workers/${worker.id}`, { role: "button" })}
                              >
                                <td className="px-2 py-2 font-medium w-[180px]">
                                  <div className="flex flex-col items-center gap-1">
                                    <div>{worker.full_name ?? worker.email ?? "פועל"}</div>
                                    <div className="flex flex-col items-center text-muted-foreground break-all">
                                      {worker.email ? <div dir="ltr">{worker.email}</div> : null}
                                      {worker.phone ? <div dir="ltr">{worker.phone}</div> : null}
                                      {!worker.email && !worker.phone ? <div>ללא פרטי קשר</div> : null}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-2 py-2">
                                  <div className="flex flex-col items-center gap-1">
                                    <StatusPill tone="warning">{"פועל"}</StatusPill>
                                    <AccessBadge hasAccess={false} />
                                    <StatusPill tone={worker.active === false ? "muted" : "success"}>
                                      {worker.active === false ? "לא פעיל" : "פעיל"}
                                    </StatusPill>
                                  </div>
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap">
                                  <WorkerTypeBadge workerType={workerType} />
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap">
                                  {payrollWorkerTypeAllowsSessions(workerType) ? formatMinutes(monthStats.totalMinutes) : "-"}
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
                                <td className="px-2 py-2 whitespace-nowrap">
                                  <SalaryProtected
                                    unlocked={salaryUnlocked}
                                    hasPasswordConfigured={hasPasswordConfigured}
                                    canUnlock={canViewSalary}
                                    onUnlockSuccess={loadProtectedData}
                                    fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                                  >
                                    {protectedLoading ? <LoadingDots /> : formatCurrency(balance?.paid_amount ?? 0)}
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
                                    {protectedLoading ? <LoadingDots /> : formatCurrency(balance?.owed_amount ?? 0)}
                                  </SalaryProtected>
                                </td>
                                <td className="px-2 py-2">
                                  <div className="flex flex-wrap justify-center gap-2">
                                    <Button variant="outline" size="sm" onClick={() => { emitNavigationStart(); router.push(`/payroll/workers/${worker.id}`); }}>
                                      {"פרטים"}
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="space-y-3">
          <div className="flex justify-start">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAttendanceFiltersOpen((value) => !value)}
            >
              <FilterIcon className="h-4 w-4" />
              {attendanceFiltersOpen ? "הסתרת סינון" : "סינון"}
              {(() => {
                const activeCount = Object.values(attendanceFilters).filter(Boolean).length;
                return activeCount > 0 ? ` (${activeCount})` : "";
              })()}
            </Button>
          </div>
          {attendanceFiltersOpen ? (
          <Card>
            <CardContent
              className="grid grid-cols-1 gap-3 py-5 md:grid-cols-3 xl:grid-cols-6"
              dir="rtl"
            >
              <Field label="עובד">
                <NativeSelect
                  value={attendanceFilters.workerId}
                  onChange={(event) =>
                    setAttendanceFilters((current) => ({ ...current, workerId: event.target.value }))
                  }
                >
                  <option value="">{"הכול"}</option>
                  {publicUsers
                    .filter((user) => user.role === "worker" || user.role === "worker_no_access")
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name ?? user.email ?? "עובד"}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field label="תחום">
                <DomainSelect
                  domains={WORK_SESSION_BUSINESS_DOMAINS}
                  emptyLabel="הכול"
                  value={attendanceFilters.businessDomain}
                  onChange={(value) =>
                    setAttendanceFilters((current) => ({ ...current, businessDomain: value }))
                  }
                />
              </Field>
              <Field label="פרויקט">
                <NativeSelect
                  value={attendanceFilters.projectId}
                  onChange={(event) =>
                    setAttendanceFilters((current) => ({ ...current, projectId: event.target.value }))
                  }
                >
                  <option value="">{"הכול"}</option>
                  {projectOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="סטטוס">
                <NativeSelect
                  value={attendanceFilters.status}
                  onChange={(event) =>
                    setAttendanceFilters((current) => ({ ...current, status: event.target.value }))
                  }
                >
                  <option value="">{"הכול"}</option>
                  <option value="open">{"פתוח"}</option>
                  <option value="closed">{"סגור"}</option>
                </NativeSelect>
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
          ) : null}

          <Card>
            <CardContent className="py-4">
              {/* Narrow screens / large font: stacked session cards instead of the wide table. */}
              <div className="space-y-3 lg:hidden">
                {filteredSessions.length === 0 ? (
                  <EmptyState dense>
                    {"אין משמרות להצגה."}
                  </EmptyState>
                ) : (
                  filteredSessions.map((session) => {
                    const worker = usersById.get(session.user_id);
                    const linkLabel = getSessionLinkLabel(session, projectLabelsById, propertyLabelsById);
                    const rowWorkerType = worker
                      ? normalizePayrollWorkerType(worker.payroll_worker_type, worker.pay_tracking_mode)
                      : null;
                    const rowShowHours = shouldShowSessionHours(rowWorkerType);
                    const rowShowPrice = shouldShowSessionPrice(rowWorkerType);
                    // Actions live behind a swipe on phones, so the card stays compact.
                    // A locked session (or one mid-mutation) offers none, and then the
                    // card renders plain — swiping would only uncover an empty strip.
                    const sessionActions: SwipeAction[] =
                      canManageAttendance && !session.locked && !isPending
                        ? [
                            {
                              key: "edit",
                              label: "עריכה",
                              icon: <EditIcon className="h-5 w-5" />,
                              className: "bg-secondary-2",
                              onSelect: () => openEditSession(session),
                            },
                            ...(!session.clock_out
                              ? [
                                  {
                                    key: "close",
                                    label: "סגירה",
                                    icon: <CheckIcon className="h-5 w-5" />,
                                    className: "bg-secondary",
                                    onSelect: () => closeOpenSession(session.id),
                                  },
                                ]
                              : []),
                            {
                              key: "delete",
                              label: "מחיקה",
                              icon: <DeleteIcon className="h-5 w-5" />,
                              className: "bg-destructive",
                              onSelect: () => deleteSession(session.id),
                            },
                          ]
                        : [];

                    const card = (
                      <div className="p-4 text-right">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold">{worker?.full_name ?? worker?.email ?? "עובד"}</div>
                            <div className="text-sm text-muted-foreground">
                              {rowShowHours ? formatSessionRange(session.clock_in, session.clock_out) : formatDate(session.clock_in)}
                            </div>
                          </div>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <StatusPill tone={session.clock_out ? "success" : "warning"}>
                              {session.clock_out ? "סגור" : "פתוח"}
                            </StatusPill>
                            {session.billing_status && session.is_billable_to_customer ? (
                              <StatusPill tone={session.billing_status === "paid" ? "success" : "muted"}>
                                {getBillingStatusLabel(session.billing_status)}
                              </StatusPill>
                            ) : null}
                          </div>
                        </div>
                        {session.notes ? <div className="mt-2 text-xs text-muted-foreground">{session.notes}</div> : null}
                        {/* Compact label/value rows (boxes made the session card far too tall). */}
                        <div className="mt-3 space-y-1 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">{"משך"}</span>
                            <span className="font-medium">{rowShowHours ? formatMinutes(sessionWorkedMinutes(session)) : "—"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">{"עלות עבודה"}</span>
                            <span className="font-medium">
                              {rowShowPrice ? (
                                <SalaryProtected
                                  unlocked={salaryUnlocked}
                                  hasPasswordConfigured={hasPasswordConfigured}
                                  canUnlock={canViewSalary}
                                  onUnlockSuccess={loadProtectedData}
                                  fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                                >
                                  {formatCurrency(sessionCostsById.get(session.id) ?? 0)}
                                </SalaryProtected>
                              ) : (
                                "אוטומטי"
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="shrink-0 text-muted-foreground">{"קישור"}</span>
                            <span className="min-w-0 truncate font-medium">{linkLabel || "—"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">{"תחום"}</span>
                            <span className="font-medium">{getBusinessDomainLabel(session.business_domain)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">{"חיוב לקוח"}</span>
                            <span className="font-medium">
                              {session.is_billable_to_customer ? formatCurrency(session.bill_to_customer_amount) : "לא לחיוב"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );

                    if (sessionActions.length === 0) {
                      return (
                        <div key={session.id} className="rounded-2xl border bg-background shadow-sm">
                          {card}
                        </div>
                      );
                    }

                    return (
                      <SwipeActions
                        key={session.id}
                        className="border border-border/70 bg-background shadow-sm"
                        actions={sessionActions}
                        open={swipedSessionId === session.id}
                        onOpenChange={(next) => setSwipedSessionId(next ? session.id : null)}
                      >
                        {card}
                      </SwipeActions>
                    );
                  })
                )}
              </div>

              {/* Wide screens: full session table */}
              <div className="hidden max-h-[70vh] overflow-auto lg:block">
                <table className="w-full text-right text-sm">
                  <thead className="sticky top-0 z-10 bg-muted">
                    {/* RTL reading order: the worker opens the row (rightmost), actions close it. */}
                    <tr className="border-b text-muted-foreground">
                      <th className="px-3 py-2 font-medium">עובד</th>
                      <th className="px-3 py-2 font-medium">סטטוס</th>
                      <th className="px-3 py-2 font-medium">תחום</th>
                      <th className="px-3 py-2 font-medium">קישור</th>
                      <th className="px-3 py-2 font-medium">טווח</th>
                      <th className="px-3 py-2 font-medium">משך</th>
                      <th className="px-3 py-2 font-medium">חיוב לקוח</th>
                      <th className="px-3 py-2 font-medium">עלות עבודה</th>
                      <th className="px-3 py-2 font-medium">פעולות</th>
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
                            <td className="px-3 py-3 font-medium">
                              {worker?.full_name ?? worker?.email ?? "עובד"}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap justify-end gap-2">
                                <StatusPill tone={session.clock_out ? "success" : "warning"}>
                                  {session.clock_out ? "סגור" : "פתוח"}
                                </StatusPill>
                                {session.billing_status && session.is_billable_to_customer ? (
                                  <StatusPill tone={session.billing_status === "paid" ? "success" : "muted"}>
                                    {getBillingStatusLabel(session.billing_status)}
                                  </StatusPill>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-3">{getBusinessDomainLabel(session.business_domain)}</td>
                            <td className="px-3 py-3">{linkLabel}</td>
                            <td className="px-3 py-3 text-muted-foreground">
                              <div>{rowShowHours ? formatSessionRange(session.clock_in, session.clock_out) : formatDate(session.clock_in)}</div>
                              {session.notes ? <div className="mt-1 text-xs">{session.notes}</div> : null}
                            </td>
                            <td className="px-3 py-3">
                              {rowShowHours ? formatMinutes(sessionWorkedMinutes(session)) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-3">
                              {session.is_billable_to_customer
                                ? formatCurrency(session.bill_to_customer_amount)
                                : "לא לחיוב"}
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
                              {canManageAttendance ? (
                                <div className="flex flex-wrap justify-end gap-2">
                                  <EditButton onClick={() => openEditSession(session)} disabled={session.locked || isPending} label="עריכה" />
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
                                  <DeleteButton
                                    onClick={() => deleteSession(session.id)}
                                    label="מחיקת משמרת"
                                    disabled={session.locked || isPending}
                                  />
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
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
                    <AddIcon className="h-4 w-4" />
                    {"הוספת משכורת"}
                  </Button>
                </div>
                {/* Narrow screens / large font: one card per worker, listing agreements. */}
                <div className="space-y-3 lg:hidden">
                  {agreementUsersWithAgreements.length === 0 ? (
                    <EmptyState dense>
                      {"אין משכורות להצגה."}
                    </EmptyState>
                  ) : (
                    agreementUsersWithAgreements.map((worker) => {
                      const workerAgreements = agreementsByUserId.get(worker.id) ?? [];
                      const current = getCurrentSalaryAgreement(workerAgreements);
                      return (
                        <div key={worker.id} className="rounded-2xl border bg-background p-4 text-right shadow-sm">
                          <div className="font-semibold">{worker.full_name ?? worker.email ?? "עובד"}</div>
                          <div className="mt-3 space-y-2">
                            {workerAgreements.map((agreement) => (
                              <SwipeActions
                                key={agreement.id}
                                className="rounded-xl border"
                                actions={[
                                  {
                                    key: "edit",
                                    label: "עריכה",
                                    icon: <EditIcon className="h-5 w-5" />,
                                    className: "bg-secondary-2",
                                    onSelect: () => openEditAgreementDialog(agreement),
                                  },
                                  {
                                    key: "delete",
                                    label: "מחיקה",
                                    icon: <DeleteIcon className="h-5 w-5" />,
                                    className: "bg-destructive",
                                    onSelect: () => deleteAgreement(agreement),
                                  },
                                ]}
                                open={swipedAgreementId === agreement.id}
                                onOpenChange={(next) => setSwipedAgreementId(next ? agreement.id : null)}
                              >
                                <div className="flex items-start justify-between gap-2 px-3 py-2">
                                  <div className="min-w-0">
                                    <div className="font-semibold">
                                      {agreement.salary_type === "hourly"
                                        ? `${formatCurrency(agreement.hourly_rate)} / שעה`
                                        : formatCurrency(agreement.monthly_salary)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">{getSalaryTypeLabel(agreement.salary_type)}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {`מ־${formatDate(agreement.valid_from)} עד ${formatDate(agreement.valid_to)}`}
                                    </div>
                                  </div>
                                  {current?.id === agreement.id ? <Tag>{"נוכחי"}</Tag> : null}
                                </div>
                              </SwipeActions>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Wide screens: full agreements table */}
                <div className="hidden max-h-[70vh] overflow-auto lg:block">
                  <table className="w-full text-right text-sm">
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr className="border-b text-muted-foreground">
                        <th className="px-3 py-2 font-medium">עובד</th>
                        <th className="px-3 py-2 font-medium">סוג</th>
                        <th className="px-3 py-2 font-medium">סכום</th>
                        <th className="px-3 py-2 font-medium">מתאריך</th>
                        <th className="px-3 py-2 font-medium">עד תאריך</th>
                        <th className="px-3 py-2 font-medium">מצב</th>
                        <th className="px-3 py-2 font-medium">פעולות</th>
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
                              {index === 0 ? (
                                <td rowSpan={workerAgreements.length} className="px-3 py-3 align-top font-medium">
                                  {worker.full_name ?? worker.email ?? "עובד"}
                                </td>
                              ) : null}
                              <td className="px-3 py-3">{getSalaryTypeLabel(agreement.salary_type)}</td>
                              <td className="px-3 py-3 font-semibold">
                                {agreement.salary_type === "hourly"
                                  ? `${formatCurrency(agreement.hourly_rate)} / שעה`
                                  : formatCurrency(agreement.monthly_salary)}
                              </td>
                              <td className="px-3 py-3 text-muted-foreground">{formatDate(agreement.valid_from)}</td>
                              <td className="px-3 py-3 text-muted-foreground">{formatDate(agreement.valid_to)}</td>
                              <td className="px-3 py-3">
                                {current?.id === agreement.id ? <Tag>{"נוכחי"}</Tag> : <span className="text-muted-foreground">-</span>}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <EditButton onClick={() => openEditAgreementDialog(agreement)} label="עריכה" />
                                  <DeleteButton onClick={() => deleteAgreement(agreement)} label="מחיקת הסכם" />
                                </div>
                              </td>
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
                        </>
                      )}
                    </div>
                    <div className="text-right">
                      {selectedPayslipPeriod ? (
                        <div className="text-lg font-semibold">{monthLabelFromKey(selectedPayslipPeriod.period_month)}</div>
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

              {unattachedItemsInSelectedPeriod.length > 0 ? (
                <Card>
                  <CardContent className="py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3">
                      <div className="min-w-0 text-sm">
                        <div className="font-medium text-warning-soft-foreground">
                          {`${unattachedItemsInSelectedPeriod.length} רכיבי שכר עוד לא נכנסו לתלושים`}
                        </div>
                        <div className="text-muted-foreground">
                          {`סה״כ ${formatCurrency(
                            unattachedItemsInSelectedPeriod.reduce((sum, item) => sum + toNumber(item.amount), 0)
                          )} — לעובד אין תלוש לחודש הזה. לחץ «יצירת / רענון תלושים».`}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => runPeriodAction("generate")} disabled={isPending}>
                        {"יצירת / רענון תלושים"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

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
                      {/* RTL: the worker opens the card, the badges trail at the end. */}
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="font-semibold">{worker?.full_name ?? worker?.email ?? "עובד"}</div>
                        <div className="flex flex-wrap justify-end gap-2">
                          {workerType ? <WorkerTypeBadge workerType={workerType} /> : null}
                          <Tag>{getSalaryTypeLabel(payslip.calculated_salary_type)}</Tag>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <MiniStat label="ברוטו" value={formatCurrency(payslip.gross_salary)} />
                        <MiniStat label="דקות עבודה" value={formatMinutes(payslip.total_work_minutes)} />
                      </div>

                      {/* Every line here reads label-first (right) and money-last (left). */}
                      <div className="rounded-2xl border p-3 space-y-1 text-sm">
                        <div className="flex justify-between text-muted-foreground">
                          <span>שכר בסיס</span>
                          <span className="font-medium text-foreground">{formatCurrency(payslip.calculated_base_salary)}</span>
                        </div>
                        {payslipItems
                          .filter((item) => item.payslip_id === payslip.id)
                          .map((item) => {
                            const isException = isExceptionItemType(item.item_type);
                            const isNegative = toNumber(item.amount) < 0;
                            return (
                              <div key={item.id} className="flex items-center justify-between gap-2 py-0.5">
                                <div className="flex items-center gap-1.5 text-right">
                                  {isException && <WarningIcon className="h-3.5 w-3.5 text-warning-soft-foreground shrink-0" />}
                                  <span className="text-muted-foreground">
                                    {/* A dated item (a bonus) says WHICH day it was for —
                                        that's the difference between "₪300 bonus" and
                                        "₪300 for the ten-hour Tuesday". */}
                                    {item.item_date ? `${formatDate(item.item_date)} • ` : ""}
                                    {item.notes || getPayslipItemTypeLabel(item.item_type)}
                                  </span>
                                  <Badge variant="outline" className="text-xs px-1.5 py-0">{getPayslipItemTypeLabel(item.item_type)}</Badge>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={isNegative || isException ? "text-destructive font-medium" : "font-medium"}>
                                    {formatCurrency(item.amount)}
                                  </span>
                                  {isEditable && (
                                    <DeleteButton
                                      onClick={() => deletePayslipItem(item.id, payslip.id)}
                                      disabled={isPending}
                                      label="מחיקת פריט"
                                    />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        {toNumber(payslip.manual_adjustments) !== 0 && (
                          <div className="flex justify-between text-muted-foreground">
                            <span>התאמה ידנית</span>
                            <span className={toNumber(payslip.manual_adjustments) < 0 ? "text-destructive" : ""}>{formatCurrency(payslip.manual_adjustments)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-semibold border-t pt-2 mt-1">
                          <span>ברוטו</span>
                          <span>{formatCurrency(payslip.gross_salary)}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-end justify-between gap-3">
                        {/* Fixed-width input — a full-width `1fr` cell rendered as a big empty box on mobile. */}
                        <div className="w-40 max-w-full">
                          <Field label="התאמה ידנית">
                            <CurrencyInput
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
                        <div className="flex flex-wrap gap-2">
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
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

            </div>

            {/* Period Management Dialog */}
            <ViewDialog
              open={periodManagementDialogOpen}
              onOpenChange={setPeriodManagementDialogOpen}
              title="ניהול תקופות שכר"
              description="יצירת תקופה חדשה ובחירת תקופה לעבודה"
            >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
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
                        {"יצירת תקופה"}
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
            </ViewDialog>

            {/* Add Payslip Item Dialog */}
            <FormDialog
              open={!!payslipItemForm.payslip_id}
              onOpenChange={(open) => {
                if (!open) setPayslipItemForm(DEFAULT_PAYSLIP_ITEM_FORM);
              }}
              title="הוספת רכיב שכר"
              description="רכיב נוסף (בונוס, ניכוי, החזר) שייכנס לתלוש הזה."
              onSubmit={() => addPayslipItem()}
              submitLabel="הוספת רכיב"
              busyLabel="שומר..."
              busy={isPending}
            >
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="סוג רכיב">
                      <NativeSelect
                        value={payslipItemForm.item_type}
                        onChange={(event) =>
                          setPayslipItemForm((current) => ({ ...current, item_type: event.target.value }))
                        }
                      >
                        {PAYSLIP_ITEM_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="סכום (שלילי = ניכוי)">
                      <CurrencyInput
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
                  {/* A bonus is about a specific day ("the ten-hour Tuesday"), so it
                      gets the date the other components don't need. */}
                  {payslipItemForm.item_type === BONUS_ITEM_TYPE ? (
                    <Field label="על איזה יום">
                      <DateInput
                        value={payslipItemForm.item_date}
                        onChange={(event) =>
                          setPayslipItemForm((current) => ({ ...current, item_date: event.target.value }))
                        }
                      />
                    </Field>
                  ) : null}
                  </div>
            </FormDialog>
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
                          <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/10 px-3 py-1.5">
                            <span className="shrink-0 text-muted-foreground">אימייל</span>
                            <span className="min-w-0 break-all font-medium" dir="ltr">{selectedWorker.email ?? "—"}</span>
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
                          <DeleteButton onClick={() => deleteSelectedWorker()} disabled={isPending} label="מחיקת עובד" size="default" />
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
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                        <MiniStat label="סה״כ נצבר" loading={protectedLoading} value={formatCurrency(selectedWorkerBalance?.earned_amount ?? 0)} />
                        <MiniStat label="שולם כולל" loading={protectedLoading} value={formatCurrency(selectedWorkerBalance?.paid_amount ?? 0)} />
                        <MiniStat label="יתרה כוללת" loading={protectedLoading} value={formatCurrency(selectedWorkerBalance?.owed_amount ?? 0)} />
                        <MiniStat
                          label="סטטוס"
                          loading={protectedLoading}
                          value={sharedPaymentStatusLabel(selectedWorkerBalance?.payment_status)}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </SalaryProtected>

                <Card>
                  <CardContent className="py-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="חודש">
                        <NativeSelect
                          value={workerPrintFilters.month}
                          onChange={(event) =>
                            setWorkerPrintFilters((current) => ({ ...current, month: event.target.value }))
                          }
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
                        </NativeSelect>
                      </Field>
                      <Field label="שנה">
                        <NativeSelect
                          value={workerPrintFilters.year}
                          onChange={(event) =>
                            setWorkerPrintFilters((current) => ({ ...current, year: event.target.value }))
                          }
                        >
                          <option value="">כל השנים</option>
                          {selectedWorkerPrintYearOptions.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                    </div>
                  </CardContent>
                </Card>

                <Tabs
                  defaultValue={
                    canManageSalary
                      ? "finances"
                      : selectedWorkerType === "monthly_payslip"
                        ? "print"
                        : "attendance"
                  }
                  dir="rtl"
                >
                  <TabsList variant="underline" className="sm:justify-center">
                    {canManageSalary ? <TabsTrigger value="finances"><CoinsIcon className="h-4 w-4" />כספים</TabsTrigger> : null}
                    {/* Monthly (global) workers are paid a fixed salary and don't track attendance. */}
                    {selectedWorkerType !== "monthly_payslip" ? (
                      <TabsTrigger value="attendance"><CalendarCheckIcon className="h-4 w-4" />נוכחות</TabsTrigger>
                    ) : null}
                    {canSelectedWorkerHaveAgreement && canManageSalary ? (
                      <TabsTrigger value="salary"><CashIcon className="h-4 w-4" />שכר</TabsTrigger>
                    ) : null}
                    {/* Bonuses and days off — the two records that aren't hours.
                        Offered for EVERY worker type: a global worker has no
                        נוכחות tab at all, and this is where his days off live. */}
                    <TabsTrigger value="extras">
                      <CoinsIcon className="h-4 w-4" />
                      בונוסים וחופשות
                    </TabsTrigger>
                    <TabsTrigger value="print"><PrintIcon className="h-4 w-4" />הדפסה</TabsTrigger>
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
                        <Button onClick={() => openWorkerPaymentDialog()} disabled={isPending}>
                          הוספת תשלום
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <div className="font-medium">היסטוריית תשלומים</div>
                        {protectedLoading ? (
                          <div className="flex justify-center py-4">
                            <LoadingDots />
                          </div>
                        ) : selectedWorkerPaymentsByPeriod.length === 0 ? (
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
                                  <EditButton onClick={() => openEditWorkerPaymentDialog(payment)} label="עריכת תשלום" />
                                  <DeleteButton onClick={() => deleteWorkerPayment(payment)} label="מחיקת תשלום" />
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
                      <ProjectPicker
                        value={sessionsProjectId}
                        onChange={setSessionsProjectId}
                        emptyLabel="כל הפרויקטים"
                        searchPlaceholder="חיפוש פרויקט..."
                        projects={selectedWorkerProjectOptions.map((option) => ({ id: option.id, label: option.label }))}
                      />
                    </Field>
                    <div className={`grid gap-3 ${shouldShowSessionHours(selectedWorkerType) ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                      {shouldShowSessionHours(selectedWorkerType) ? (
                        <MiniStat
                          label="שעות בתקופה"
                          value={formatMinutes(selectedWorkerFilteredStats.totalMinutes)}
                        />
                      ) : null}
                      <MiniStat label="משמרות בתקופה" value={String(selectedWorkerFilteredStats.sessionCount)} />
                      <MiniStat label="עלות בתקופה" loading={protectedLoading} value={formatCurrency(selectedWorkerFilteredStats.totalAmount)} />
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
                            // No per-session debt (payslip-mode worker) → the central
                            // session_effective_payment_view already gives the effective status,
                            // derived from that month's covering payslip.
                            const coveringPayslipDebtItem = debtItem
                              ? null
                              : sessionEffectivePaymentBySessionId.get(session.id) ?? null;
                            return (
                              <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Tag>{getBusinessDomainLabel(session.business_domain)}</Tag>
                              {debtItem ? (
                                <PaymentStatusBadge
                                  status={debtItem.payment_status}
                                  owedAmount={debtItem.owed_amount}
                                />
                              ) : coveringPayslipDebtItem?.payment_status ? (
                                <span className="flex items-center gap-1">
                                  <StatusBadge value={coveringPayslipDebtItem.payment_status} type="payment" />
                                  <Tag>{"לפי תלוש"}</Tag>
                                </span>
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
                              <EditButton onClick={() => openEditSession(session)} label="עריכת משמרת" />
                              <DeleteButton onClick={() => deleteSession(session.id)} label="מחיקת משמרת" />
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
                            <AddIcon className="ms-2 h-4 w-4" />
                            {"הוספת משכורת חדשה"}
                          </Button>
                          <Button variant="outline" onClick={() => setOverrideDialogOpen(true)} disabled={isPending}>
                            {"הוספת החרגה"}
                          </Button>
                        </div>

                        <div className="space-y-3">
                          <div className="font-medium">{"היסטוריית משכורות"}</div>
                            {(agreementsByUserId.get(selectedWorker.id) ?? []).length === 0 ? (
                              <div className="text-sm text-muted-foreground">{"אין משכורות לעובד הזה."}</div>
                            ) : (
                              <div className="overflow-x-auto rounded-lg border">
                                <table className="w-full text-right text-sm">
                                  <thead className="border-b bg-muted text-muted-foreground">
                                    <tr>
                                      <th className="px-3 py-2 font-medium">סוג</th>
                                      <th className="px-3 py-2 font-medium">בתוקף</th>
                                      <th className="px-3 py-2 font-medium">משויך ל</th>
                                      <th className="px-3 py-2 font-medium">שכר</th>
                                      <th className="px-3 py-2 font-medium">שעות תקניות</th>
                                      <th className="px-3 py-2 font-medium">נוספות</th>
                                      <th className="px-3 py-2 font-medium">תשלום</th>
                                      <th className="px-3 py-2 font-medium">פעולות</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(agreementsByUserId.get(selectedWorker.id) ?? []).map((agreement, index) => {
                                      const isCurrent =
                                        getCurrentSalaryAgreement(agreementsByUserId.get(selectedWorker.id) ?? [])?.id === agreement.id;
                                      const attribution = agreementAttributionLabel(agreement);
                                      return (
                                        <tr
                                          key={agreement.id}
                                          className={`border-b align-top ${index % 2 === 0 ? "bg-muted/20" : "bg-background"}`}
                                        >
                                          <td className="px-3 py-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="font-medium">{getSalaryTypeLabel(agreement.salary_type)}</span>
                                              {isCurrent ? <Tag>{"נוכחי"}</Tag> : null}
                                            </div>
                                            {agreement.notes ? (
                                              <div className="mt-1 text-xs text-muted-foreground">{agreement.notes}</div>
                                            ) : null}
                                          </td>
                                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                                            {`${formatDate(agreement.valid_from)} - ${formatDate(agreement.valid_to)}`}
                                          </td>
                                          <td className="px-3 py-2">
                                            {attribution ? <Tag>{attribution}</Tag> : <span className="text-muted-foreground">—</span>}
                                          </td>
                                          <td className="whitespace-nowrap px-3 py-2 font-semibold">
                                            {agreement.salary_type === "hourly"
                                              ? `${formatCurrency(agreement.hourly_rate)} / שעה`
                                              : formatCurrency(agreement.monthly_salary)}
                                          </td>
                                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                                            {agreement.salary_type === "hourly"
                                              ? (agreement.standard_daily_hours ?? "0")
                                              : "—"}
                                          </td>
                                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                                            {agreement.salary_type === "hourly" ? formatCurrency(agreement.overtime_rate) : "—"}
                                          </td>
                                          <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                                            {`עד יום ${agreement.due_day_of_next_month ?? 10}`}
                                          </td>
                                          <td className="px-3 py-2">
                                            <div className="flex gap-2">
                                              <EditButton onClick={() => openEditAgreementDialog(agreement)} label="עריכה" />
                                              <DeleteButton onClick={() => deleteAgreement(agreement)} label="מחיקת הסכם" />
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}

                          <div className="font-medium">{"החרגות שכר שעתי"}</div>
                          {selectedWorkerOverrides.length === 0 ? (
                            <div className="text-sm text-muted-foreground">{"אין חריגות שכר."}</div>
                          ) : (
                            selectedWorkerOverrides.map((override, index) => (
                              <div
                                key={`${override.created_at ?? "override"}-${index}`}
                                className="grid grid-cols-1 gap-1 rounded-lg border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
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
                            <div className="overflow-x-auto rounded-lg border">
                              <table className="w-full text-right text-sm">
                                <thead className="border-b bg-muted text-muted-foreground">
                                  <tr>
                                    <th className="px-3 py-2 font-medium">חודש</th>
                                    <th className="px-3 py-2 font-medium">סוג</th>
                                    <th className="px-3 py-2 font-medium">משויך ל</th>
                                    <th className="px-3 py-2 font-medium">שעות</th>
                                    <th className="px-3 py-2 font-medium">סכום</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(payslipsByUserId.get(selectedWorker.id) ?? []).map((payslip, index) => {
                                    const period = periodsById.get(payslip.payroll_period_id);
                                    const coveringAgreement = period
                                      ? getCurrentSalaryAgreement(
                                          agreementsByUserId.get(selectedWorker.id) ?? [],
                                          new Date(`${period.end_date}T23:59:59.999`)
                                        )
                                      : null;
                                    const payslipAttribution = coveringAgreement
                                      ? agreementAttributionLabel(coveringAgreement)
                                      : null;
                                    const isMonthlyPayslip = payslip.calculated_salary_type === "monthly";
                                    return (
                                      <tr
                                        key={payslip.id}
                                        className={`border-b ${index % 2 === 0 ? "bg-muted/20" : "bg-background"}`}
                                      >
                                        <td className="whitespace-nowrap px-3 py-2 font-medium">
                                          {period ? monthLabelFromKey(period.period_month) : "תקופה"}
                                        </td>
                                        <td className="px-3 py-2 text-muted-foreground">
                                          {getSalaryTypeLabel(payslip.calculated_salary_type)}
                                        </td>
                                        <td className="px-3 py-2">
                                          {payslipAttribution ? (
                                            <Tag>{payslipAttribution}</Tag>
                                          ) : (
                                            <span className="text-muted-foreground">—</span>
                                          )}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                                          {isMonthlyPayslip ? "—" : formatMinutes(payslip.total_work_minutes)}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 font-semibold">
                                          {formatCurrency(payslip.gross_salary)}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
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

                  <TabsContent value="extras" className="space-y-5">
                    {/* Two cards, two different permissions: a bonus is money and
                        stays admin-only, a day off moves none and office may mark
                        it — the same split the rest of the payroll centre uses. */}
                    <Card>
                      <CardContent className="space-y-3 py-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-lg font-semibold">בונוסים</div>
                            <div className="text-sm text-muted-foreground">
                              רכיב שכר עם תאריך. נכנס לברוטו של התלוש של החודש שבו התאריך נמצא — גם אם הוזן באיחור.
                            </div>
                          </div>
                          {canManageSalary ? (
                            <Button onClick={() => openNewBonusDialog(selectedWorker.id)} disabled={isPending}>
                              <AddIcon className="h-4 w-4" />
                              הוספת בונוס
                            </Button>
                          ) : null}
                        </div>

                        {protectedLoading ? (
                          <div className="flex justify-center py-4">
                            <LoadingDots />
                          </div>
                        ) : selectedWorkerBonuses.length === 0 ? (
                          <div className="text-sm text-muted-foreground">אין בונוסים לעובד הזה.</div>
                        ) : (
                          <div className="space-y-2">
                            {selectedWorkerBonuses.map((bonus) => (
                              <div
                                key={bonus.id}
                                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-sm"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold">{formatCurrency(bonus.amount)}</span>
                                    {/* Which month's ברוטו it landed in — or that it's
                                        still waiting for that month to be generated. */}
                                    {bonus.payslip_id ? (
                                      <Tag>
                                        {`בתלוש ${monthLabelFromKey(
                                          periodsById.get(payslipsById.get(bonus.payslip_id)?.payroll_period_id ?? "")
                                            ?.period_month ?? ""
                                        )}`}
                                      </Tag>
                                    ) : (
                                      <Tag>
                                        {bonus.item_date
                                          ? `ייכנס לתלוש ${monthLabelFromKey(bonus.item_date.slice(0, 7))}`
                                          : "ייכנס לתלוש"}
                                      </Tag>
                                    )}
                                  </div>
                                  <div className="mt-0.5 text-muted-foreground">
                                    {bonus.item_date ? `${formatDate(bonus.item_date)} • ` : ""}
                                    {bonus.notes || "בונוס"}
                                  </div>
                                </div>
                                {canManageSalary ? (
                                  <DeleteButton
                                    onClick={() =>
                                      setPendingDeletion({
                                        kind: "bonus",
                                        bonusId: bonus.id,
                                        amountLabel: `${formatCurrency(bonus.amount)}${
                                          bonus.item_date ? ` • ${formatDate(bonus.item_date)}` : ""
                                        }`,
                                      })
                                    }
                                    label="מחיקת בונוס"
                                  />
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="space-y-3 py-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-lg font-semibold">ימי חופש והיעדרות</div>
                            <div className="text-sm text-muted-foreground">
                              לא יורד כסף — היום פשוט יופיע ריק בגליון השעות שמייצאים לאקסל.
                            </div>
                          </div>
                          {canManageAttendance ? (
                            <Button onClick={() => openAbsenceDialog(selectedWorker.id)} disabled={isPending}>
                              <AddIcon className="h-4 w-4" />
                              סימון יום חופש
                            </Button>
                          ) : null}
                        </div>

                        {protectedLoading ? (
                          <div className="flex justify-center py-4">
                            <LoadingDots />
                          </div>
                        ) : selectedWorkerAbsences.length === 0 ? (
                          <div className="text-sm text-muted-foreground">לא סומנו ימי חופש לעובד הזה.</div>
                        ) : (
                          <div className="space-y-2">
                            {selectedWorkerAbsences.map((absence) => (
                              <div
                                key={absence.id}
                                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-sm"
                              >
                                <div className="min-w-0">
                                  <div className="font-medium">{formatDate(absence.absence_date)}</div>
                                  <div className="text-muted-foreground">
                                    {getWorkerAbsenceTypeLabel(absence.absence_type)}
                                    {absence.notes ? ` — ${absence.notes}` : ""}
                                  </div>
                                </div>
                                {canManageAttendance ? (
                                  <DeleteButton
                                    onClick={() =>
                                      setPendingDeletion({
                                        kind: "absence",
                                        absenceId: absence.id,
                                        dateLabel: formatDate(absence.absence_date),
                                      })
                                    }
                                    label="מחיקת היעדרות"
                                  />
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

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
                          <ProjectPicker
                            value={workerPrintFilters.projectId}
                            onChange={(projectId) =>
                              setWorkerPrintFilters((current) => ({ ...current, projectId }))
                            }
                            emptyLabel="כל הפרויקטים"
                            searchPlaceholder="חיפוש פרויקט..."
                            projects={selectedWorkerProjectOptions.map((option) => ({ id: option.id, label: option.label }))}
                          />
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

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <MiniStat label="סה״כ נצבר לתקופה" value={formatCurrency(selectedWorkerPrintSummary.earned)} />
                          <MiniStat label="סה״כ שולם לתקופה" value={formatCurrency(selectedWorkerPrintSummary.paid)} />
                          <MiniStat label="יתרה לתשלום" value={formatCurrency(selectedWorkerPrintSummary.owed)} />
                        </div>

                        <div className="space-y-2">
                          <div className="font-medium">פירוט עבודה</div>
                          {selectedWorkerPrintSessions.length === 0 ? (
                            <EmptyState dense>
                              אין משמרות להצגה במסננים שנבחרו.
                            </EmptyState>
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
                            <EmptyState dense>
                              אין תשלומים להצגה במסננים שנבחרו.
                            </EmptyState>
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

      {/* Bonus — a רכיב שכר with a date on it */}
      <FormDialog
        open={bonusDialogOpen}
        onOpenChange={(open) => {
          setBonusDialogOpen(open);
          if (!open) {
            setBonusForm(DEFAULT_BONUS_FORM);
            setBonusError("");
          }
        }}
        title="הוספת בונוס"
        description="נכנס כרכיב שכר לתלוש של החודש שבו התאריך נמצא."
        onSubmit={() => saveBonus()}
        submitLabel="הוספת בונוס"
        busyLabel="שומר..."
        busy={isPending}
        error={bonusError}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="על איזה יום">
              <DateInput
                value={bonusForm.bonus_date}
                onChange={(event) =>
                  setBonusForm((current) => ({ ...current, bonus_date: event.target.value }))
                }
              />
            </Field>
            <Field label="סכום">
              <CurrencyInput
                inputMode="decimal"
                value={bonusForm.amount}
                onChange={(event) => setBonusForm((current) => ({ ...current, amount: event.target.value }))}
              />
            </Field>
          </div>
          <Field label="על מה הבונוס">
            <Input
              placeholder="לדוגמה: 10 שעות ביום אחד"
              value={bonusForm.notes}
              onChange={(event) => setBonusForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
        </div>
      </FormDialog>

      {/* Day off / absence */}
      <FormDialog
        open={absenceDialogOpen}
        onOpenChange={(open) => {
          setAbsenceDialogOpen(open);
          if (!open) {
            setAbsenceForm(DEFAULT_ABSENCE_FORM);
            setAbsenceError("");
          }
        }}
        title="סימון יום חופש"
        description="לא יורד כסף — היום רק יופיע ריק בגליון השעות."
        onSubmit={() => saveAbsence()}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={isPending}
        error={absenceError}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="תאריך">
              <DateInput
                value={absenceForm.absence_date}
                onChange={(event) =>
                  setAbsenceForm((current) => ({ ...current, absence_date: event.target.value }))
                }
              />
            </Field>
            <Field label="סוג">
              <NativeSelect
                value={absenceForm.absence_type}
                onChange={(event) =>
                  setAbsenceForm((current) => ({ ...current, absence_type: event.target.value }))
                }
              >
                {WORKER_ABSENCE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="הערות">
            <Input
              value={absenceForm.notes}
              onChange={(event) => setAbsenceForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
          {/* The business closing for a day is one action, not one dialog per
              person. Anyone already marked for that date is skipped. */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-secondary"
              checked={absenceForm.applyToAll}
              onChange={(event) =>
                setAbsenceForm((current) => ({ ...current, applyToAll: event.target.checked }))
              }
            />
            <span>
              {`סימון לכל העובדים (${absenceEligibleWorkers.length}) — לא רק לעובד הזה`}
            </span>
          </label>
        </div>
      </FormDialog>

      <FormDialog
        open={workerAccessDialogOpen}
        onOpenChange={setWorkerAccessDialogOpen}
        title="עדכון פרטי עובד"
        description="עדכון פרטים אישיים, תפקיד, סטטוס וגישה למערכת."
        size="formXl"
        onSubmit={() => saveWorkerAccess()}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={isPending}
        footerStart={
          <DeleteButton
            onClick={() => deleteSelectedWorker()}
            disabled={isPending}
            label="מחיקת עובד"
            size="default"
          />
        }
      >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
              <NativeSelect
                value={workerForm.role}
                onChange={(event) =>
                  setWorkerForm((current) => ({
                    ...current,
                    role: event.target.value as WorkerFormState["role"],
                    system_access: event.target.value === "worker_no_access" ? false : current.system_access,
                  }))
                }
              >
                <option value="admin">{"מנהל"}</option>
                <option value="office">{"משרד"}</option>
                <option value="worker">{"עובד"}</option>
                <option value="worker_no_access">{"עובד ללא גישה"}</option>
              </NativeSelect>
            </Field>
            <Field label="פעיל">
              <NativeSelect
                value={workerForm.active ? "yes" : "no"}
                onChange={(event) =>
                  setWorkerForm((current) => ({ ...current, active: event.target.value === "yes" }))
                }
              >
                <option value="yes">{"כן"}</option>
                <option value="no">{"לא"}</option>
              </NativeSelect>
            </Field>
            <Field label="סוג עובד">
              <NativeSelect
                value={workerForm.payroll_worker_type}
                onChange={(event) =>
                  setWorkerForm((current) => ({
                    ...current,
                    payroll_worker_type: event.target.value as WorkerFormState["payroll_worker_type"],
                  }))
                }
              >
                <option value="session_only">{"קבלנות"}</option>
                <option value="monthly_payslip">{"חודשי גלובלי"}</option>
                <option value="hourly_payslip">{"שעתי עם תלוש"}</option>
              </NativeSelect>
            </Field>
            <Field label="גישה למערכת">
              <NativeSelect
                value={workerForm.system_access ? "yes" : "no"}
                onChange={(event) =>
                  setWorkerForm((current) => ({ ...current, system_access: event.target.value === "yes" }))
                }
                disabled={workerForm.role === "worker_no_access"}
              >
                <option value="yes">{"כן"}</option>
                <option value="no">{"לא"}</option>
              </NativeSelect>
            </Field>
            {/* Only a worker is ever offered Arabic — office/admin stay Hebrew,
                so this field is meaningless (and hidden) for every other role. */}
            {workerForm.role === "worker" ? (
              <Field label="שפת תצוגה">
                <NativeSelect
                  value={workerForm.locale}
                  onChange={(event) =>
                    setWorkerForm((current) => ({ ...current, locale: event.target.value as WorkerFormState["locale"] }))
                  }
                >
                  <option value="he">{"עברית"}</option>
                  <option value="ar">{"العربية"}</option>
                </NativeSelect>
              </Field>
            ) : null}
            {/* Admin-set per worker (2026-08-23): every worker keeps attendance/
                tasks/calendar/alerts/profile regardless — this is the one route
                that's individually toggle-able. Meaningless for office/admin,
                who always have it. */}
            {workerForm.role === "worker" ? (
              <Field label="גישה למשלוחים">
                <NativeSelect
                  value={workerForm.deliveries_access ? "yes" : "no"}
                  onChange={(event) =>
                    setWorkerForm((current) => ({ ...current, deliveries_access: event.target.value === "yes" }))
                  }
                >
                  <option value="yes">{"כן"}</option>
                  <option value="no">{"לא"}</option>
                </NativeSelect>
              </Field>
            ) : null}
          </div>
      </FormDialog>

      <FormDialog
        open={agreementDialogOpen}
        onOpenChange={setAgreementDialogOpen}
        title={agreementForm.agreement_id ? "עריכת משכורת" : "הוספת משכורת"}
        description={agreementForm.agreement_id ? "עדכון משכורת קיימת." : "הוספת משכורת חדשה ובחירת עובד."}
        size="details4xl"
        onSubmit={saveAgreement}
        submitLabel={agreementForm.agreement_id ? "שמירת שינויים" : "שמירת משכורת"}
        busyLabel="שומר..."
        busy={isPending}
        submitDisabled={!agreementStandardDailyHoursValid || !agreementDueDayValid}
      >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="עובד">
              <NativeSelect
                value={agreementForm.user_id}
                onChange={(event) =>
                  setAgreementForm((current) => ({ ...current, user_id: event.target.value }))
                }
                disabled={Boolean(agreementForm.agreement_id)}
              >
                <option value="">{"בחירת עובד"}</option>
                {allAgreementEligibleUsers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.full_name ?? worker.email ?? "עובד"}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="סוג שכר">
              <NativeSelect
                value={agreementForm.salary_type}
                onChange={(event) =>
                  setAgreementForm((current) => ({
                    ...current,
                    salary_type: event.target.value as "hourly" | "monthly",
                  }))
                }
              >
                <option value="hourly">{"שעתי"}</option>
                <option value="monthly">{"חודשי"}</option>
              </NativeSelect>
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
                <CurrencyInput
                  inputMode="decimal"
                  value={agreementForm.hourly_rate}
                  onChange={(event) =>
                    setAgreementForm((current) => ({ ...current, hourly_rate: event.target.value }))
                  }
                />
              </Field>
            ) : (
              <Field label="שכר חודשי">
                <CurrencyInput
                  inputMode="decimal"
                  value={agreementForm.monthly_salary}
                  onChange={(event) =>
                    setAgreementForm((current) => ({ ...current, monthly_salary: event.target.value }))
                  }
                />
              </Field>
            )}
            {agreementForm.salary_type === "monthly" ? (
              <>
                <Field label="תחום">
                  <DomainSelect
                    domains={WORK_SESSION_BUSINESS_DOMAINS}
                    value={agreementForm.business_domain}
                    onChange={(value) =>
                      setAgreementForm((current) => ({
                        ...current,
                        business_domain: value,
                        project_id: value === "logistics_projects" ? current.project_id : "",
                        property_id: value === "property_management" ? current.property_id : "",
                        is_billable_to_customer: value === "logistics_projects" ? current.is_billable_to_customer : false,
                        bill_to_customer_amount: value === "logistics_projects" ? current.bill_to_customer_amount : "",
                      }))
                    }
                  />
                  <div className="mt-1 text-xs text-muted-foreground">
                    התחום שאליו תשויך המשכורת בתזרים הכספי.
                  </div>
                </Field>
                {agreementForm.business_domain === "logistics_projects" ? (
                  <Field label="פרויקט">
                    <ProjectPicker
                      value={agreementForm.project_id}
                      onChange={(value) =>
                        setAgreementForm((current) => ({
                          ...current,
                          project_id: value,
                          is_billable_to_customer: value ? current.is_billable_to_customer : false,
                          bill_to_customer_amount: value ? current.bill_to_customer_amount : "",
                        }))
                      }
                      searchPlaceholder="חיפוש פרויקט..."
                      projects={projectOptions.map((option) => ({ id: option.id, label: option.label }))}
                    />
                    <div className="mt-1 text-xs text-muted-foreground">
                      כל המשכורת החודשית תירשם כהוצאה על הפרויקט הזה.
                    </div>
                  </Field>
                ) : null}
                {agreementForm.business_domain === "logistics_projects" && agreementForm.project_id ? (
                  <Field label="חיוב לקוח">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={agreementForm.is_billable_to_customer}
                        onChange={(event) =>
                          setAgreementForm((current) => ({
                            ...current,
                            is_billable_to_customer: event.target.checked,
                            bill_to_customer_amount: event.target.checked ? current.bill_to_customer_amount : "",
                          }))
                        }
                      />
                      <span>לחיוב לקוח</span>
                    </label>
                    {agreementForm.is_billable_to_customer ? (
                      <div className="mt-2 space-y-1">
                        <div className="text-sm font-medium">סכום לחיוב לקוח (חודשי)</div>
                        <CurrencyInput
                          inputMode="decimal"
                          value={agreementForm.bill_to_customer_amount}
                          onChange={(event) =>
                            setAgreementForm((current) => ({
                              ...current,
                              bill_to_customer_amount: event.target.value,
                            }))
                          }
                          placeholder="למשל 5000"
                        />
                      </div>
                    ) : null}
                    <div className="mt-1 text-xs text-muted-foreground">
                      הסכום ייווסף לחיוב הלקוח של הפרויקט מדי חודש, בנוסף לעלות המשכורת בהוצאות.
                    </div>
                  </Field>
                ) : null}
                {agreementForm.business_domain === "property_management" ? (
                  <Field label="נכס">
                    <NativeSelect
                      value={agreementForm.property_id}
                      onChange={(event) =>
                        setAgreementForm((current) => ({ ...current, property_id: event.target.value }))
                      }
                    >
                      <option value="">{"בחירה"}</option>
                      {propertyOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                    <div className="mt-1 text-xs text-muted-foreground">
                      כל המשכורת החודשית תירשם כהוצאה על הנכס הזה.
                    </div>
                  </Field>
                ) : null}
              </>
            ) : null}
            <Field label="תעריף שעות נוספות">
              <CurrencyInput
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
                <div className="relative">
                  <Textarea
                    rows={3}
                    value={agreementForm.notes}
                    onChange={(event) =>
                      setAgreementForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    className="pe-11"
                  />
                  <DictateButton
                    onTranscript={(text) =>
                      setAgreementForm((current) => ({ ...current, notes: appendDictatedText(current.notes, text) }))
                    }
                    className="absolute bottom-1 end-1 h-8 w-8"
                  />
                </div>
              </Field>
            </div>
          </div>
      </FormDialog>

      <FormDialog
        open={overrideDialogOpen}
        onOpenChange={setOverrideDialogOpen}
        title="הוספת חריגת שכר שעתי"
        description="תעריף שונה שיחול על העובד בטווח זמן מוגדר."
        size="formXl"
        onSubmit={() => saveOverride()}
        submitLabel="שמירת חריגה"
        busyLabel="שומר..."
        busy={isPending}
      >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="תעריף שעתי חריג (₪)">
              <CurrencyInput
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
      </FormDialog>

      <FormDialog
        open={createUserOpen}
        onOpenChange={(open) => {
          setCreateUserOpen(open);
          if (!open) resetCreateUserForm();
        }}
        title="הוספת משתמש"
        description="אפשר ליצור מכאן עובד, פועל, משרד או מנהל, עם סטטוס פעיל וגישה למערכת לפי הצורך."
        size="form2xl"
        onSubmit={() => createUser()}
        submitLabel="שמירת משתמש"
        busyLabel="שומר..."
        busy={isPending}
        error={createUserError || undefined}
      >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
              <NativeSelect
                value={createUserForm.role}
                onChange={(event) =>
                  setCreateUserForm((current) => ({
                    ...current,
                    role: event.target.value as CreateUserFormState["role"],
                    system_access: event.target.value === "worker_no_access" ? false : current.system_access,
                  }))
                }
              >
                <option value="worker">{"עובד"}</option>
                <option value="worker_no_access">{"פועל"}</option>
                <option value="office">{"משרד"}</option>
                <option value="admin">{"מנהל"}</option>
              </NativeSelect>
            </Field>
            <Field label="פעיל">
              <NativeSelect
                value={createUserForm.active ? "yes" : "no"}
                onChange={(event) =>
                  setCreateUserForm((current) => ({ ...current, active: event.target.value === "yes" }))
                }
              >
                <option value="yes">{"כן"}</option>
                <option value="no">{"לא"}</option>
              </NativeSelect>
            </Field>
            <Field label="סוג עובד">
              <NativeSelect
                value={createUserForm.payroll_worker_type}
                onChange={(event) =>
                  setCreateUserForm((current) => ({
                    ...current,
                    payroll_worker_type: event.target.value as CreateUserFormState["payroll_worker_type"],
                  }))
                }
              >
                <option value="session_only">{"קבלנות"}</option>
                <option value="monthly_payslip">{"חודשי גלובלי"}</option>
                <option value="hourly_payslip">{"שעתי עם תלוש"}</option>
              </NativeSelect>
            </Field>
            <Field label="גישה למערכת">
              <NativeSelect
                value={createUserForm.system_access ? "yes" : "no"}
                onChange={(event) =>
                  setCreateUserForm((current) => ({ ...current, system_access: event.target.value === "yes" }))
                }
                disabled={createUserForm.role === "worker_no_access"}
              >
                <option value="yes">{"כן"}</option>
                <option value="no">{"לא"}</option>
              </NativeSelect>
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
          </div>
      </FormDialog>

      <FormDialog
        open={workerPaymentDialogOpen}
        onOpenChange={setWorkerPaymentDialogOpen}
        title={workerPaymentForm.payment_id ? "עדכון תשלום לעובד" : "הוספת תשלום לעובד"}
        description="רישום תשלום והקצאה שלו למשמרות או לתלושים פתוחים."
        size="details4xl"
        onSubmit={() => saveWorkerPayment()}
        submitLabel={workerPaymentForm.payment_id ? "שמירת עדכון" : "שמירת תשלום"}
        busyLabel="שומר..."
        busy={isPending}
        error={workerPaymentError || undefined}
      >

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="תאריך תשלום">
              <DateInput
                value={workerPaymentForm.payment_date}
                onChange={(event) =>
                  setWorkerPaymentForm((current) => ({ ...current, payment_date: event.target.value }))
                }
              />
            </Field>
            <Field label="סכום">
              <CurrencyInput
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
            <AccountSelect
              required
              value={workerPaymentForm.account_id}
              onChange={(accountId) =>
                setWorkerPaymentForm((current) => ({ ...current, account_id: accountId }))
              }
              onLoaded={setWorkerPaymentAccountsList}
            />
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
                <div className="relative">
                  <Textarea
                    rows={3}
                    value={workerPaymentForm.notes}
                    onChange={(event) =>
                      setWorkerPaymentForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    className="pe-11"
                  />
                  <DictateButton
                    onTranscript={(text) =>
                      setWorkerPaymentForm((current) => ({ ...current, notes: appendDictatedText(current.notes, text) }))
                    }
                    className="absolute bottom-1 end-1 h-8 w-8"
                  />
                </div>
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
              <EmptyState dense>
                {"אין פריטי חוב פתוחים לעובד הזה — אפשר לרשום את התשלום ללא שיוך (תשלום כללי / מקדמה)."}
              </EmptyState>
            ) : (
              <div className="space-y-2">
                {workerPaymentForm.allocations.map((allocation) => (
                  <div
                    key={allocation.source_id}
                    className="grid grid-cols-1 gap-3 rounded-2xl border p-3 md:grid-cols-[minmax(0,1fr)_180px]"
                  >
                    <div className="text-right">
                      <div className="font-medium">{allocation.title}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{allocation.subtitle}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {`יתרה להקצאה: ${formatCurrency(allocation.max_amount)}`}
                      </div>
                    </div>
                    <Field label="סכום להקצאה">
                      <CurrencyInput
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
          </div>
      </FormDialog>

      <SessionEditorDialog
        open={sessionDialogOpen}
        onOpenChange={setSessionDialogOpen}
        mode={sessionMode}
        initialForm={sessionForm}
        workers={publicUsers}
        projectOptions={projectOptions}
        propertyOptions={propertyOptions}
        agreementsByUserId={agreementsByUserId}
        salaryUnlocked={salaryUnlocked}
        hasPasswordConfigured={hasPasswordConfigured}
        canViewSalary={canViewSalary}
        onUnlockSuccess={loadProtectedData}
        onSaved={(msg) => {
          toast.success(msg);
          void refreshAll();
        }}
        editExtras={
          sessionDialogWorkerType === "session_only" ? (
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
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
                                  <EditButton onClick={() => openEditWorkerPaymentDialog(payment)} label="עריכת תשלום" />
                                  <DeleteButton onClick={() => deleteWorkerPayment(payment)} label="מחיקת תשלום" />
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
          ) : null
        }
      />

      <ConfirmDialog
        open={Boolean(pendingDeletion)}
        onOpenChange={(open) => {
          if (!open) setPendingDeletion(null);
        }}
        destructive
        title={pendingDeletionDetails?.title ?? "אישור מחיקה"}
        description={pendingDeletionDetails?.description ?? "הפעולה תתבצע רק לאחר אישור."}
        confirmLabel="מחיקה"
        loading={isPending}
        onConfirm={() => confirmPendingDeletion()}
      >
        <p className="text-sm">
          למחוק את <span className="font-medium">{pendingDeletionDetails?.label ?? "הרשומה"}</span>?
        </p>
      </ConfirmDialog>
    </div>
  );
}
