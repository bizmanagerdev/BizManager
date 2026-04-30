"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";
import SalaryProtected from "@/components/payroll/SalaryProtected";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { UserRole } from "@/lib/auth/requireProfile";
import { getBusinessDomainLabel } from "@/lib/expenses";
import {
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
  getPayslipItemsTotal,
  isSalaryTrackedWorker,
  getSessionLinkLabel,
  getWorkerAccessLabel,
  getWorkerMonthStats,
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

type Props = {
  viewerRole: UserRole;
  publicUsers: SalaryCenterUserRow[];
  publicSessions: SessionPublicRow[];
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
  publicPeriods: PayrollPeriodRow[];
  initiallyUnlocked: boolean;
  hasPasswordConfigured: boolean;
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
  pay_tracking_mode: "session" | "payslip";
};

type CreateUserFormState = {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  role: "admin" | "office" | "worker" | "worker_no_access";
  active: boolean;
  system_access: boolean;
  pay_tracking_mode: "session" | "payslip";
};

type AgreementFormState = {
  agreement_id: string;
  user_id: string;
  salary_type: "hourly" | "monthly";
  hourly_rate: string;
  monthly_salary: string;
  overtime_rate: string;
  standard_daily_hours: string;
  valid_from: string;
  notes: string;
};

type OverrideFormState = {
  override_hourly_rate: string;
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
  valid_from: new Date().toISOString().slice(0, 10),
  notes: "",
};

const DEFAULT_OVERRIDE_FORM: OverrideFormState = {
  override_hourly_rate: "",
  notes: "",
};

const DEFAULT_PAYSLIP_ITEM_FORM: PayslipItemFormState = {
  payslip_id: "",
  item_type: "manual_adjustment",
  amount: "",
  notes: "",
};

const DEFAULT_CREATE_USER_FORM: CreateUserFormState = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
  role: "worker",
  active: true,
  system_access: true,
  pay_tracking_mode: "session",
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
}: Props) {
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
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [workerAccessDialogOpen, setWorkerAccessDialogOpen] = useState(false);
  const [agreementDialogOpen, setAgreementDialogOpen] = useState(false);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createUserForm, setCreateUserForm] = useState<CreateUserFormState>(DEFAULT_CREATE_USER_FORM);
  const [createUserError, setCreateUserError] = useState("");
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionForm, setSessionForm] = useState<SessionFormState>(DEFAULT_SESSION_FORM);
  const [sessionMode, setSessionMode] = useState<"create" | "edit">("create");
  const [workerPaymentDialogOpen, setWorkerPaymentDialogOpen] = useState(false);
  const [workerPaymentForm, setWorkerPaymentForm] = useState<WorkerPaymentFormState>(DEFAULT_WORKER_PAYMENT_FORM);
  const [workerPaymentError, setWorkerPaymentError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
    pay_tracking_mode: "session",
  });
  const [agreementForm, setAgreementForm] = useState<AgreementFormState>(DEFAULT_AGREEMENT_FORM);
  const [overrideForm, setOverrideForm] = useState<OverrideFormState>(DEFAULT_OVERRIDE_FORM);
  const [periodMonth, setPeriodMonth] = useState(getCurrentMonthKey());
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [payslipItemForm, setPayslipItemForm] = useState<PayslipItemFormState>(DEFAULT_PAYSLIP_ITEM_FORM);
  const [payslipAdjustmentDrafts, setPayslipAdjustmentDrafts] = useState<Record<string, string>>({});

  const canManageSalary = viewerRole === "admin";
  const agreementStandardDailyHoursValid = toNumber(agreementForm.standard_daily_hours) > 0;
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
  const canManageAttendance = viewerRole === "admin";
  const canCreateUsers = viewerRole === "admin";

  const loadProtectedData = useCallback(async () => {
    if (!canManageSalary) return;

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
  }, [canManageSalary]);

  useEffect(() => {
    if (initiallyUnlocked && canManageSalary) {
      void loadProtectedData();
    }
  }, [initiallyUnlocked, canManageSalary, loadProtectedData]);

  const currentMonthKey = getCurrentMonthKey();
  const activePayrollPeriod = useMemo(() => getCurrentPayrollPeriod(publicPeriods), [publicPeriods]);
  const usersById = useMemo(() => new Map(publicUsers.map((user) => [user.id, user])), [publicUsers]);
  const projectLabelsById = useMemo(() => new Map(projectOptions.map((option) => [option.id, option.label])), [projectOptions]);
  const propertyLabelsById = useMemo(() => new Map(propertyOptions.map((option) => [option.id, option.label])), [propertyOptions]);
  const protectedPeriods = protectedData?.periods ?? [];
  const periodsForUi = protectedPeriods.length > 0 ? protectedPeriods : publicPeriods;
  const periodsById = useMemo(() => new Map(periodsForUi.map((period) => [period.id, period])), [periodsForUi]);
  const agreements = useMemo(() => protectedData?.agreements ?? [], [protectedData]);
  const payslips = useMemo(() => protectedData?.payslips ?? [], [protectedData]);
  const payslipItems = useMemo(() => protectedData?.payslipItems ?? [], [protectedData]);
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
  const workerPaymentsByUserId = useMemo(() => {
    const next = new Map<string, WorkerPaymentRow[]>();
    (protectedData?.workerPayments ?? []).forEach((payment) => {
      const list = next.get(payment.user_id) ?? [];
      list.push(payment);
      next.set(payment.user_id, list);
    });
    return next;
  }, [protectedData]);
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

  const selectedWorker = selectedWorkerId ? usersById.get(selectedWorkerId) ?? null : null;
  const isSelectedWorkerSalaryTracked = selectedWorker ? isSalaryTrackedWorker(selectedWorker) : false;
  const canSelectedWorkerHaveAgreement = Boolean(
    selectedWorker &&
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
      pay_tracking_mode: selectedWorker.pay_tracking_mode === "payslip" ? "payslip" : "session",
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

  const isAttendanceWorker = useCallback(
    (user: Pick<SalaryCenterUserRow, "role"> | null | undefined) =>
      user?.role === "worker" || user?.role === "worker_no_access",
    []
  );

  const filteredSessions = useMemo(() => {
    return publicSessions.filter((session) => {
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
  }, [publicSessions, attendanceFilters]);

  const summary = useMemo(() => {
    const workerIds = new Set(
      publicUsers
        .filter((user) => user.active !== false && (user.role === "worker" || user.role === "worker_no_access"))
        .map((user) => user.id)
    );
    const thisMonthSessions = publicSessions.filter((session) => monthKeyFromDate(session.clock_in) === currentMonthKey);
    return {
      currentPayrollMonth: activePayrollPeriod?.period_month ?? currentMonthKey,
      activeWorkers: workerIds.size,
      openSessions: publicSessions.filter((session) => !session.clock_out).length,
      totalWorkMinutes: thisMonthSessions.reduce((sum, session) => sum + sessionWorkedMinutes(session), 0),
      totalLaborCost: protectedData?.summary.totalLaborCostThisMonth ?? 0,
      unpaidPayslips: protectedData?.summary.unpaidOrUnfinishedPayslips ?? 0,
      totalWorkerOwed: protectedData?.summary.totalWorkerOwed ?? 0,
    };
  }, [activePayrollPeriod, currentMonthKey, protectedData, publicSessions, publicUsers]);

  function openCreateSession(userId = "") {
    setSessionMode("create");
    setSessionError("");
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
    if (reloadProtected && salaryUnlocked && canManageSalary) {
      await loadProtectedData();
    }
  }

  async function postJson(path: string, payload: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(json.error ?? "Request failed.");
    }
    return json;
  }

  function runAction(action: () => Promise<void>) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await action();
      } catch (actionError: unknown) {
        setError(actionError instanceof Error ? actionError.message : "Unknown error");
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
        (usersById.get(savedSession.user_id)?.pay_tracking_mode ?? "session") === "session";

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
        pay_tracking_mode: createUserForm.pay_tracking_mode,
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
    const session = publicSessions.find((item) => item.id === sessionId) ?? null;
    const worker = session ? usersById.get(session.user_id) ?? null : null;
    const workerLabel = worker?.full_name ?? worker?.email ?? "העובד";
    const confirmed = window.confirm(`למחוק את המשמרת של ${workerLabel}?`);
    if (!confirmed) return;

    runAction(async () => {
      await postJson("/api/payroll/sessions/delete", { session_id: sessionId });
      setMessage("המשמרת נמחקה.");
      await refreshAll();
    });
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
        pay_tracking_mode: workerForm.pay_tracking_mode,
      });
      setMessage("פרטי הגישה עודכנו.");
      await refreshAll({ reloadProtected: false });
    });
  }

  function deleteSelectedWorker() {
    if (!selectedWorker) return;
    const confirmed = window.confirm("למחוק את העובד הזה? הפעולה תשבית אותו, תבטל גישה למערכת, ותשמור את כל ההיסטוריה.");
    if (!confirmed) return;

    runAction(async () => {
      await postJson("/api/payroll/workers/delete", {
        user_id: selectedWorker.id,
      });
      setWorkerAccessDialogOpen(false);
      setSelectedWorkerId("");
      setMessage("העובד הוסר מהרשימה הפעילה.");
      await refreshAll();
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
    setAgreementForm({
      agreement_id: "",
      user_id: userId,
      salary_type:
        currentAgreement?.salary_type === "monthly" || currentAgreement?.salary_type === "hourly"
          ? currentAgreement.salary_type
          : "hourly",
      hourly_rate: currentAgreement?.hourly_rate ? String(currentAgreement.hourly_rate) : "",
      monthly_salary: currentAgreement?.monthly_salary ? String(currentAgreement.monthly_salary) : "",
      overtime_rate: currentAgreement?.overtime_rate ? String(currentAgreement.overtime_rate) : "",
      standard_daily_hours: currentAgreement?.standard_daily_hours ? String(currentAgreement.standard_daily_hours) : "0",
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
      valid_from: agreement.valid_from,
      notes: agreement.notes ?? "",
    });
    setAgreementDialogOpen(true);
  }

  function deleteAgreement(agreement: SalaryAgreementRow) {
    const worker = publicUsers.find((user) => user.id === agreement.user_id);
    const workerLabel = worker?.full_name ?? worker?.email ?? "העובד";
    const confirmed = window.confirm(`למחוק את המשכורת של ${workerLabel}?`);
    if (!confirmed) return;

    runAction(async () => {
      await postJson("/api/payroll/salary-agreements", {
        action: "delete",
        agreement_id: agreement.id,
        user_id: agreement.user_id,
      });
      setMessage("המשכורת נמחקה.");
      await refreshAll();
    });
  }

  function saveOverride() {
    if (!selectedWorker) return;
    runAction(async () => {
      await postJson("/api/payroll/hourly-overrides", {
        user_id: selectedWorker.id,
        override_hourly_rate: overrideForm.override_hourly_rate,
        notes: overrideForm.notes,
      });
      setOverrideForm(DEFAULT_OVERRIDE_FORM);
      setMessage("החרגת השכר נוספה.");
      await refreshAll();
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
    const confirmed = window.confirm("למחוק את התשלום הזה?");
    if (!confirmed) return;

    runAction(async () => {
      const response = await fetch("/api/payroll/worker-payments", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payment_id: payment.id,
          user_id: payment.user_id,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Request failed.");
      }

      if (workerPaymentForm.payment_id === payment.id) {
        setWorkerPaymentDialogOpen(false);
        setWorkerPaymentForm(DEFAULT_WORKER_PAYMENT_FORM);
        setWorkerPaymentError("");
      }

      setMessage("תשלום לעובד נמחק.");
      await refreshAll();
    });
  }

  const selectedWorkerSessions = useMemo(
    () => publicSessions.filter((session) => session.user_id === selectedWorkerId),
    [publicSessions, selectedWorkerId]
  );
  const selectedWorkerStats = selectedWorker ? getWorkerMonthStats(selectedWorker.id, publicSessions) : null;
  const selectedWorkerTotalPay = useMemo(
    () =>
      selectedWorkerSessions.reduce((sum, session) => sum + (sessionCostsById.get(session.id) ?? 0), 0),
    [selectedWorkerSessions, sessionCostsById]
  );
  const selectedWorkerBalance = selectedWorker ? workerBalancesByUserId.get(selectedWorker.id) ?? null : null;
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
  const sessionDialogWorker = useMemo(
    () => (sessionForm.user_id ? usersById.get(sessionForm.user_id) ?? null : null),
    [sessionForm.user_id, usersById]
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
  const canManageSessionPayments =
    sessionMode === "edit" &&
    sessionDialogWorker?.pay_tracking_mode === "session" &&
    Boolean(sessionDialogDebtItem);

  function buildDebtItemTitle(item: WorkerDebtItemRow) {
    if (item.source_type === "payslip") {
      return item.period_month ? `תלוש ${monthLabelFromKey(item.period_month)}` : "תלוש";
    }
    const projectLabel = item.project_id ? projectLabelsById.get(item.project_id) ?? "פרויקט" : "ללא פרויקט";
    return item.source_date ? `${formatDate(item.source_date)} • ${projectLabel}` : projectLabel;
  }

  function buildDebtItemSubtitle(item: WorkerDebtItemRow) {
    if (item.source_type === "payslip") {
      return `ברוטו ${formatCurrency(item.earned_amount)}`;
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="חודש שכר נוכחי" value={monthLabelFromKey(summary.currentPayrollMonth)} />
        <SummaryCard title="סה״כ שעות החודש" value={formatMinutes(summary.totalWorkMinutes)} />
        <SalaryProtected
          unlocked={salaryUnlocked}
          hasPasswordConfigured={hasPasswordConfigured}
          canUnlock={canManageSalary}
          onUnlockSuccess={loadProtectedData}
          fallback={<SummaryCard title="עלות עבודה החודש" value="מוגן" protectedValue />}
        >
          <SummaryCard title="עלות עבודה החודש" value={formatCurrency(summary.totalLaborCost)} protectedValue />
        </SalaryProtected>
        <SalaryProtected
          unlocked={salaryUnlocked}
          hasPasswordConfigured={hasPasswordConfigured}
          canUnlock={canManageSalary}
          onUnlockSuccess={loadProtectedData}
          fallback={<SummaryCard title="יתרה לעובדים" value="מוגן" protectedValue />}
        >
          <SummaryCard title="יתרה לעובדים" value={formatCurrency(summary.totalWorkerOwed)} protectedValue />
        </SalaryProtected>
      </div>

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
          {canManageSalary && salaryUnlocked ? (
            <Button variant="ghost" onClick={() => void loadProtectedData()} disabled={loadingProtected}>
              <RefreshCcw className="h-4 w-4" />
              {"רענון נתוני שכר"}
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
          <TabsTrigger value="agreements">{"משכורות"}</TabsTrigger>
          <TabsTrigger value="payslips">{"תקופות ותלושים"}</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="space-y-3">
          <Card>
            <CardContent className="py-4">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1450px] text-right text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-3 py-2 font-medium">פעולות</th>
                      <th className="px-3 py-2 font-medium">יתרה</th>
                      <th className="px-3 py-2 font-medium">שולם</th>
                      <th className="px-3 py-2 font-medium">סטטוס תשלום</th>
                      <th className="px-3 py-2 font-medium">תלוש אחרון</th>
                      <th className="px-3 py-2 font-medium">עלות עבודה החודש</th>
                      <th className="px-3 py-2 font-medium">משכורת נוכחית</th>
                      <th className="px-3 py-2 font-medium">פתוחות</th>
                      <th className="px-3 py-2 font-medium">פרויקטים</th>
                      <th className="px-3 py-2 font-medium">משמרות</th>
                      <th className="px-3 py-2 font-medium">שעות החודש</th>
                      <th className="px-3 py-2 font-medium">סטטוס</th>
                      <th className="px-3 py-2 font-medium">פרטי קשר</th>
                      <th className="px-3 py-2 font-medium">עובד</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeWorkers.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="px-3 py-6 text-center text-muted-foreground">
                          {"אין עובדים להצגה."}
                        </td>
                      </tr>
                    ) : (
                      employeeWorkers.map((worker, index) => {
                        const monthStats = getWorkerMonthStats(worker.id, publicSessions);
                        const currentAgreement = getCurrentSalaryAgreement(agreementsByUserId.get(worker.id) ?? []);
                        const latestPayslip = [...(payslipsByUserId.get(worker.id) ?? [])].sort((a, b) =>
                          (periodsById.get(b.payroll_period_id)?.period_month ?? "").localeCompare(
                            periodsById.get(a.payroll_period_id)?.period_month ?? ""
                          )
                        )[0] ?? null;
                        const balance = workerBalancesByUserId.get(worker.id) ?? null;
                        const rowClass = index % 2 === 0 ? "bg-muted/20" : "bg-background";
                        const monthlyLaborCost = publicSessions
                          .filter((session) => session.user_id === worker.id && monthKeyFromDate(session.clock_in) === currentMonthKey)
                          .reduce((sum, session) => sum + (sessionCostsById.get(session.id) ?? 0), 0);

                        return (
                          <tr key={worker.id} className={`border-b align-top ${rowClass}`}>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => setSelectedWorkerId(worker.id)}>
                                  {"פרטים"}
                                </Button>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canManageSalary}
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
                                canUnlock={canManageSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                {formatCurrency(balance?.paid_amount ?? 0)}
                              </SalaryProtected>
                            </td>
                            <td className="px-3 py-3">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canManageSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                <PaymentStatusBadge status={balance?.payment_status} />
                              </SalaryProtected>
                            </td>
                            <td className="px-3 py-3">{latestPayslip ? formatCurrency(latestPayslip.gross_salary) : "-"}</td>
                            <td className="px-3 py-3">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canManageSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                {formatCurrency(monthlyLaborCost)}
                              </SalaryProtected>
                            </td>
                            <td className="px-3 py-3">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canManageSalary}
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
                            <td className="px-3 py-3">{String(monthStats.openSessionCount)}</td>
                            <td className="px-3 py-3">{String(monthStats.projectCount)}</td>
                            <td className="px-3 py-3">{String(monthStats.sessionCount)}</td>
                            <td className="px-3 py-3">{formatMinutes(monthStats.totalMinutes)}</td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap justify-end gap-2">
                                <RoleBadge role={worker.role} />
                                <AccessBadge hasAccess={getWorkerAccessLabel(worker) === "עם גישה"} />
                                <StatusPill tone={worker.active === false ? "muted" : "success"}>
                                  {worker.active === false ? "לא פעיל" : "פעיל"}
                                </StatusPill>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {[worker.email, worker.phone].filter(Boolean).join(" • ") || "ללא פרטי קשר"}
                            </td>
                            <td className="px-3 py-3 font-medium">{worker.full_name ?? worker.email ?? "עובד"}</td>
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1240px] text-right text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-3 py-2 font-medium">פעולות</th>
                      <th className="px-3 py-2 font-medium">יתרה</th>
                      <th className="px-3 py-2 font-medium">שולם</th>
                      <th className="px-3 py-2 font-medium">סטטוס תשלום</th>
                      <th className="px-3 py-2 font-medium">פתוחות</th>
                      <th className="px-3 py-2 font-medium">פרויקטים</th>
                      <th className="px-3 py-2 font-medium">משמרות</th>
                      <th className="px-3 py-2 font-medium">שעות החודש</th>
                      <th className="px-3 py-2 font-medium">סטטוס</th>
                      <th className="px-3 py-2 font-medium">פרטי קשר</th>
                      <th className="px-3 py-2 font-medium">פועל</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laborWorkers.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">
                          {"אין פועלים להצגה."}
                        </td>
                      </tr>
                    ) : (
                      laborWorkers.map((worker, index) => {
                        const monthStats = getWorkerMonthStats(worker.id, publicSessions);
                        const balance = workerBalancesByUserId.get(worker.id) ?? null;
                        const rowClass = index % 2 === 0 ? "bg-muted/20" : "bg-background";

                        return (
                          <tr key={worker.id} className={`border-b align-top ${rowClass}`}>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => setSelectedWorkerId(worker.id)}>
                                  {"פרטים"}
                                </Button>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canManageSalary}
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
                                canUnlock={canManageSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                {formatCurrency(balance?.paid_amount ?? 0)}
                              </SalaryProtected>
                            </td>
                            <td className="px-3 py-3">
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canManageSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                <PaymentStatusBadge status={balance?.payment_status} />
                              </SalaryProtected>
                            </td>
                            <td className="px-3 py-3">{String(monthStats.openSessionCount)}</td>
                            <td className="px-3 py-3">{String(monthStats.projectCount)}</td>
                            <td className="px-3 py-3">{String(monthStats.sessionCount)}</td>
                            <td className="px-3 py-3">{formatMinutes(monthStats.totalMinutes)}</td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap justify-end gap-2">
                                <StatusPill tone="warning">{"פועל"}</StatusPill>
                                <AccessBadge hasAccess={false} />
                                <StatusPill tone={worker.active === false ? "muted" : "success"}>
                                  {worker.active === false ? "לא פעיל" : "פעיל"}
                                </StatusPill>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {[worker.email, worker.phone].filter(Boolean).join(" • ") || "ללא פרטי קשר"}
                            </td>
                            <td className="px-3 py-3 font-medium">{worker.full_name ?? worker.email ?? "פועל"}</td>
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
                  <option value="general_business">{"כללי"}</option>
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
                <Input
                  name="attendance_date_from"
                  type="date"
                  value={attendanceFilters.dateFrom}
                  onChange={(event) =>
                    setAttendanceFilters((current) => ({ ...current, dateFrom: event.target.value }))
                  }
                  autoComplete="off"
                />
              </Field>
              <Field label="עד תאריך">
                <Input
                  name="attendance_date_to"
                  type="date"
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-right text-sm">
                  <thead>
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
                              <SalaryProtected
                                unlocked={salaryUnlocked}
                                hasPasswordConfigured={hasPasswordConfigured}
                                canUnlock={canManageSalary}
                                onUnlockSuccess={loadProtectedData}
                                fallback={<span className="text-muted-foreground">{"מוגן"}</span>}
                              >
                                <span className="font-medium">{formatCurrency(sessionCostsById.get(session.id) ?? 0)}</span>
                              </SalaryProtected>
                            </td>
                            <td className="px-3 py-3">
                              {session.is_billable_to_customer
                                ? formatCurrency(session.bill_to_customer_amount)
                                : "לא לחיוב"}
                            </td>
                            <td className="px-3 py-3">{formatMinutes(sessionWorkedMinutes(session))}</td>
                            <td className="px-3 py-3 text-muted-foreground">
                              <div>{formatSessionRange(session.clock_in, session.clock_out)}</div>
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
            canUnlock={canManageSalary}
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
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-right text-sm">
                    <thead>
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
            canUnlock={canManageSalary}
            onUnlockSuccess={loadProtectedData}
          >
            <div className="space-y-3">
              <Card>
                <CardContent className="grid gap-3 py-5 sm:grid-cols-[1fr_auto]">
                  <Field label="חודש תקופה">
                    <Input type="month" value={periodMonth} onChange={(event) => setPeriodMonth(event.target.value)} />
                  </Field>
                  <div className="flex items-end">
                    <Button onClick={() => createOrOpenPeriod()} disabled={isPending}>
                      {"יצירה / פתיחה מחדש"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {protectedPeriods.map((period) => (
                <Card key={period.id}>
                  <CardContent className="space-y-3 py-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold">{monthLabelFromKey(period.period_month)}</div>
                        <div className="text-sm text-muted-foreground">
                          {`${formatDate(period.start_date)} - ${formatDate(period.end_date)}`}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Tag>{getPayrollPeriodLabel(period.status)}</Tag>
                        <Button variant="outline" onClick={() => setSelectedPeriodId(period.id)}>
                          {"בחירת תקופה"}
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() =>
                          runAction(async () => {
                            setSelectedPeriodId(period.id);
                            await postJson("/api/payroll/periods", { action: "generate", period_id: period.id });
                            setMessage("התלושים נוצרו.");
                            await refreshAll();
                          })
                        }
                        disabled={!isPayrollPeriodEditable(period.status) || isPending}
                      >
                        {"יצירת תלושים לכל העובדים"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSelectedPeriodId(period.id);
                          runPeriodAction("lock", period.id);
                        }}
                        disabled={!isPayrollPeriodEditable(period.status) || isPending}
                      >
                        {"נעילה"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              <Card>
                <CardContent className="grid gap-3 py-5 md:grid-cols-2">
                  <Field label="תקופה נבחרת">
                    <select
                      value={selectedPeriodId}
                      onChange={(event) => setSelectedPeriodId(event.target.value)}
                      className={selectClassName}
                    >
                      <option value="">{"בחירה"}</option>
                      {protectedPeriods.map((period) => (
                        <option key={period.id} value={period.id}>
                          {monthLabelFromKey(period.period_month)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="flex items-end">
                    <Button onClick={() => runPeriodAction("generate")} disabled={!selectedPeriodId || isPending}>
                      {"יצירת / רענון תלושים"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {payslips
                .filter((payslip) => !selectedPeriodId || payslip.payroll_period_id === selectedPeriodId)
                .map((payslip) => {
                  const worker = usersById.get(payslip.user_id);
                  const period = periodsById.get(payslip.payroll_period_id) ?? null;
                  const isEditable = period ? isPayrollPeriodEditable(period.status) : false;
                  const itemTotal = getPayslipItemsTotal(payslipItems, payslip.id);
                  return (
                    <Card key={payslip.id}>
                      <CardContent className="space-y-3 py-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{worker?.full_name ?? worker?.email ?? "עובד"}</div>
                            <div className="text-sm text-muted-foreground">
                              {period ? monthLabelFromKey(period.period_month) : "תקופת שכר"}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Tag>{getSalaryTypeLabel(payslip.calculated_salary_type)}</Tag>
                            <Tag>{period ? getPayrollPeriodLabel(period.status) : "-"}</Tag>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <MiniStat label="דקות עבודה" value={formatMinutes(payslip.total_work_minutes)} />
                          <MiniStat label="שכר בסיס" value={formatCurrency(payslip.calculated_base_salary)} />
                          <MiniStat label="סך פריטי תלוש" value={formatCurrency(itemTotal)} />
                          <MiniStat label="ברוטו" value={formatCurrency(payslip.gross_salary)} />
                        </div>

                        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
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
                          <div className="flex items-end gap-2">
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
                              {"הוספת פריט תלוש"}
                            </Button>
                          </div>
                        </div>

                        {payslipItems.filter((item) => item.payslip_id === payslip.id).length ? (
                          <div className="rounded-2xl border p-3 text-sm">
                            {payslipItems
                              .filter((item) => item.payslip_id === payslip.id)
                              .map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-3 py-1">
                                  <div>{item.notes || item.item_type || "פריט"}</div>
                                  <div className="font-medium">{formatCurrency(item.amount)}</div>
                                </div>
                              ))}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}

              {payslipItemForm.payslip_id ? (
                <Card>
                  <CardContent className="grid gap-3 py-5 md:grid-cols-2">
                    <Field label="סוג פריט">
                      <Input
                        value={payslipItemForm.item_type}
                        onChange={(event) =>
                          setPayslipItemForm((current) => ({ ...current, item_type: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label="סכום">
                      <Input
                        inputMode="decimal"
                        value={payslipItemForm.amount}
                        onChange={(event) =>
                          setPayslipItemForm((current) => ({ ...current, amount: event.target.value }))
                        }
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <Field label="הערות">
                        <Textarea
                          value={payslipItemForm.notes}
                          onChange={(event) =>
                            setPayslipItemForm((current) => ({ ...current, notes: event.target.value }))
                          }
                          rows={3}
                        />
                      </Field>
                    </div>
                    <div className="md:col-span-2 flex flex-wrap gap-2">
                      <Button onClick={() => addPayslipItem()} disabled={isPending}>
                        {"שמירת פריט"}
                      </Button>
                      <Button variant="outline" onClick={() => setPayslipItemForm(DEFAULT_PAYSLIP_ITEM_FORM)}>
                        {"ביטול"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </SalaryProtected>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(selectedWorker)} onOpenChange={(open) => !open && setSelectedWorkerId("")}>
        <DialogContent className="max-h-[90vh] w-full overflow-y-auto text-right sm:max-w-4xl" dir="rtl">
          {selectedWorker ? (
            <>
              <DialogHeader className="sr-only">
                <DialogTitle>{`פרטי עובד - ${selectedWorker.full_name ?? selectedWorker.email ?? "עובד"}`}</DialogTitle>
              </DialogHeader>
              <div className="mt-6 space-y-5">
                <Card>
                  <CardContent className="space-y-3 py-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoRow label="שם מלא" value={selectedWorker.full_name ?? "—"} />
                      {selectedWorker.system_access !== false ? (
                        <InfoRow label="אימייל" value={selectedWorker.email ?? "—"} />
                      ) : null}
                      <InfoRow label="טלפון" value={selectedWorker.phone ?? "—"} />
                      <InfoRow label="תפקיד" value={getRoleLabel(selectedWorker.role)} />
                      <InfoRow label="סטטוס" value={selectedWorker.active === false ? "לא פעיל" : "פעיל"} />
                      <InfoRow
                        label="אופן מעקב תשלום"
                        value={selectedWorker.pay_tracking_mode === "payslip" ? "לפי תלוש" : "לפי משמרות"}
                      />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button onClick={() => setWorkerAccessDialogOpen(true)} disabled={isPending}>
                        {"עדכון פרטי עובד"}
                      </Button>
                      <Button variant="destructive" onClick={() => deleteSelectedWorker()} disabled={isPending}>
                        {"מחק עובד"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <SalaryProtected
                  unlocked={salaryUnlocked}
                  hasPasswordConfigured={hasPasswordConfigured}
                  canUnlock={canManageSalary}
                  onUnlockSuccess={loadProtectedData}
                >
                  <Card>
                    <CardContent className="space-y-4 py-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-lg font-semibold">כספים לעובד</div>
                        <Button onClick={() => openWorkerPaymentDialog()} disabled={isPending || selectedWorkerOpenDebtItems.length === 0}>
                          הוספת תשלום
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <MiniStat label="סה״כ חוב" value={formatCurrency(selectedWorkerBalance?.earned_amount ?? 0)} />
                        <MiniStat label="שולם" value={formatCurrency(selectedWorkerBalance?.paid_amount ?? 0)} />
                        <MiniStat label="יתרה" value={formatCurrency(selectedWorkerBalance?.owed_amount ?? 0)} />
                        <MiniStat label="סטטוס תשלום" value={paymentStatusLabel(selectedWorkerBalance?.payment_status)} />
                      </div>
                      <div className="space-y-2">
                        <div className="font-medium">היסטוריית תשלומים</div>
                        {selectedWorkerPayments.length === 0 ? (
                          <div className="text-sm text-muted-foreground">אין תשלומים שמורים לעובד הזה.</div>
                        ) : (
                          selectedWorkerPayments.map((payment) => (
                            <div key={payment.id} className="rounded-2xl border p-3 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="font-medium">{formatCurrency(payment.amount)}</div>
                                <div>{formatDate(payment.payment_date)}</div>
                              </div>
                              <div className="mt-1 text-muted-foreground">
                                {[payment.payment_method, payment.reference_number].filter(Boolean).join(" • ") || "ללא פירוט"}
                              </div>
                              {payment.notes ? <div className="mt-1 text-muted-foreground">{payment.notes}</div> : null}
                              <div className="mt-3 flex flex-wrap justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={() => openEditWorkerPaymentDialog(payment)}>
                                  {"ערוך"}
                                </Button>
                                <Button variant="destructive" size="sm" onClick={() => deleteWorkerPayment(payment)}>
                                  {"מחק"}
                                </Button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </SalaryProtected>

                <Card>
                  <CardContent className="space-y-3 py-5">
                    <div className="text-lg font-semibold">{"נוכחות"}</div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <MiniStat label="שעות החודש" value={selectedWorkerStats ? formatMinutes(selectedWorkerStats.totalMinutes) : "0:00"} />
                      <MiniStat label="משמרות החודש" value={selectedWorkerStats ? String(selectedWorkerStats.sessionCount) : "0"} />
                      <MiniStat label="עלות משמרות" value={formatCurrency(selectedWorkerTotalPay)} />
                    </div>
                    <div className="space-y-2">
                      {selectedWorkerSessions.slice(0, 12).map((session) => (
                        <div key={session.id} className="rounded-2xl border p-3 text-sm">
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
                              {debtItem ? <PaymentStatusBadge status={debtItem.payment_status} /> : null}
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
                          {debtItem ? (
                            <div className="mt-2 flex flex-wrap justify-end gap-3 text-xs text-muted-foreground">
                              <span>{`שולם: ${formatCurrency(debtItem.paid_amount)}`}</span>
                              <span>{`יתרה: ${formatCurrency(debtItem.owed_amount)}`}</span>
                            </div>
                          ) : null}
                          {!session.locked ? (
                            <div className="mt-3 flex flex-wrap justify-end gap-2">
                              <Button variant="outline" onClick={() => openEditSession(session)}>
                                {"עריכה"}
                              </Button>
                              <Button variant="ghost" onClick={() => deleteSession(session.id)}>
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

                {canSelectedWorkerHaveAgreement ? (
                  <SalaryProtected
                    unlocked={salaryUnlocked}
                    hasPasswordConfigured={hasPasswordConfigured}
                    canUnlock={canManageSalary}
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
                            <div className="text-sm text-muted-foreground">{"אין החרגות שכר."}</div>
                          ) : (
                            selectedWorkerOverrides.map((override, index) => (
                              <div
                                key={`${override.created_at ?? "override"}-${index}`}
                                className="grid gap-1 rounded-lg border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                              >
                                <div className="min-w-0 text-right">
                                  <div className="text-muted-foreground">
                                    {override.created_at ? formatDateTime(override.created_at) : "ללא תאריך"}
                                  </div>
                                  {override.notes ? (
                                    <div className="mt-1 text-xs text-muted-foreground">{override.notes}</div>
                                  ) : null}
                                </div>
                                <div className="text-right font-semibold">{formatCurrency(override.override_hourly_rate)}</div>
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
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={workerAccessDialogOpen} onOpenChange={setWorkerAccessDialogOpen}>
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
            <Field label="מעקב תשלום">
              <select
                value={workerForm.pay_tracking_mode}
                onChange={(event) =>
                  setWorkerForm((current) => ({
                    ...current,
                    pay_tracking_mode: event.target.value as WorkerFormState["pay_tracking_mode"],
                  }))
                }
                className={selectClassName}
              >
                <option value="session">{"לפי משמרות"}</option>
                <option value="payslip">{"לפי תלוש"}</option>
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
            <Button variant="outline" onClick={() => setWorkerAccessDialogOpen(false)}>
              {"ביטול"}
            </Button>
            <Button
              onClick={() => {
                saveWorkerAccess();
                setWorkerAccessDialogOpen(false);
              }}
              disabled={isPending}
            >
              {"שמירה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={agreementDialogOpen} onOpenChange={setAgreementDialogOpen}>
        <DialogContent dir="rtl" className="max-w-2xl">
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
            <Button variant="outline" onClick={() => setAgreementDialogOpen(false)}>
              {"ביטול"}
            </Button>
            <Button
              onClick={saveAgreement}
              disabled={isPending || !agreementStandardDailyHoursValid}
            >
              {agreementForm.agreement_id ? "שמירת שינויים" : "שמירת משכורת"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent dir="rtl" className="max-w-xl">
          <DialogHeader className="text-right">
            <DialogTitle>{"הוספת החרגת שכר"}</DialogTitle>
            <DialogDescription>{"שמירת תעריף החרגה לעובד הנבחר."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="תעריף החרגה">
              <Input
                inputMode="decimal"
                value={overrideForm.override_hourly_rate}
                onChange={(event) =>
                  setOverrideForm((current) => ({
                    ...current,
                    override_hourly_rate: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="הערות">
              <Input
                value={overrideForm.notes}
                onChange={(event) =>
                  setOverrideForm((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialogOpen(false)}>
              {"ביטול"}
            </Button>
            <Button
              onClick={() => {
                saveOverride();
                setOverrideDialogOpen(false);
              }}
              disabled={isPending}
            >
              {"שמירת החרגה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createUserOpen}
        onOpenChange={(open) => {
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
            <Field label="מעקב תשלום">
              <select
                value={createUserForm.pay_tracking_mode}
                onChange={(event) =>
                  setCreateUserForm((current) => ({
                    ...current,
                    pay_tracking_mode: event.target.value as CreateUserFormState["pay_tracking_mode"],
                  }))
                }
                className={selectClassName}
              >
                <option value="session">{"לפי משמרות"}</option>
                <option value="payslip">{"לפי תלוש"}</option>
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
            <Button variant="outline" onClick={() => setCreateUserOpen(false)}>
              {"ביטול"}
            </Button>
            <Button onClick={() => createUser()} disabled={isPending}>
              {"שמירת משתמש"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={workerPaymentDialogOpen} onOpenChange={setWorkerPaymentDialogOpen}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader className="text-right">
            <DialogTitle>{workerPaymentForm.payment_id ? "עדכון תשלום לעובד" : "הוספת תשלום לעובד"}</DialogTitle>
            <DialogDescription>
              {"רישום תשלום והקצאה שלו למשמרות או לתלושים פתוחים."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="תאריך תשלום">
              <Input
                type="date"
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
            <Button variant="outline" onClick={() => setWorkerPaymentDialogOpen(false)}>
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

      <Dialog open={sessionDialogOpen} onOpenChange={setSessionDialogOpen}>
        <DialogContent dir="rtl" className="max-w-2xl">
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
                <option value="general_business">{"כללי"}</option>
                <option value="logistics_projects">{"פרויקטים"}</option>
                <option value="property_management">{"נכסים"}</option>
                <option value="sales">{"מכירות"}</option>
                <option value="home">{"בית"}</option>
                <option value="charity">{"צדקה"}</option>
              </select>
            </Field>
            <Field label="כניסה">
              <Input
                type="datetime-local"
                value={sessionForm.clock_in}
                onChange={(event) => setSessionForm((current) => ({ ...current, clock_in: event.target.value }))}
              />
            </Field>
            <Field label="יציאה">
              <Input
                type="datetime-local"
                value={sessionForm.clock_out}
                onChange={(event) => setSessionForm((current) => ({ ...current, clock_out: event.target.value }))}
              />
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
            <Field label="מחיר">
              <Input
                inputMode="decimal"
                value={sessionForm.labor_cost}
                onChange={(event) =>
                  setSessionForm((current) => ({ ...current, labor_cost: event.target.value }))
                }
                placeholder="אופציונלי"
              />
            </Field>
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
            {sessionDialogWorker?.pay_tracking_mode === "session" ? (
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
            {sessionError ? <div className="md:col-span-2 text-sm text-destructive">{sessionError}</div> : null}
          </div>

          {sessionMode === "edit" && sessionDialogWorker?.pay_tracking_mode === "session" ? (
            <SalaryProtected
              unlocked={salaryUnlocked}
              hasPasswordConfigured={hasPasswordConfigured}
              canUnlock={canManageSalary}
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
                      <MiniStat label="סטטוס" value={paymentStatusLabel(sessionDialogDebtItem.payment_status)} />
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
            <Button variant="outline" onClick={() => setSessionDialogOpen(false)}>
              {"ביטול"}
            </Button>
            <Button onClick={() => saveSession()} disabled={isPending}>
              {"שמירה"}
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-muted/10 p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
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
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return <Badge className={className}>{children}</Badge>;
}

function PaymentStatusBadge({ status }: { status: string | null | undefined }) {
  const normalized = status === "paid" || status === "partial" || status === "overpaid" ? status : "unpaid";
  const tone =
    normalized === "paid"
      ? "success"
      : normalized === "partial"
        ? "warning"
        : normalized === "overpaid"
          ? "danger"
          : "muted";

  return <StatusPill tone={tone}>{paymentStatusLabel(normalized)}</StatusPill>;
}

function paymentStatusLabel(status: string | null | undefined) {
  if (status === "paid") return "שולם";
  if (status === "partial") return "שולם חלקית";
  if (status === "overpaid") return "שולם יתר";
  return "לא שולם";
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

function toDateTimeLocalValue(date: Date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

const selectClassName =
  "h-11 w-full rounded-xl border border-input bg-background/80 px-4 py-2 text-right text-sm shadow-sm";
