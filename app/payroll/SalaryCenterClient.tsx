"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, Plus, RefreshCcw } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
};

type WorkerFormState = {
  full_name: string;
  email: string;
  phone: string;
  role: "admin" | "office" | "worker" | "worker_no_access";
  active: boolean;
  system_access: boolean;
};

type CreateUserFormState = {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  role: "admin" | "office" | "worker" | "worker_no_access";
  active: boolean;
  system_access: boolean;
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
  });
  const [agreementForm, setAgreementForm] = useState<AgreementFormState>(DEFAULT_AGREEMENT_FORM);
  const [overrideForm, setOverrideForm] = useState<OverrideFormState>(DEFAULT_OVERRIDE_FORM);
  const [periodMonth, setPeriodMonth] = useState(getCurrentMonthKey());
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [payslipItemForm, setPayslipItemForm] = useState<PayslipItemFormState>(DEFAULT_PAYSLIP_ITEM_FORM);
  const [payslipAdjustmentDrafts, setPayslipAdjustmentDrafts] = useState<Record<string, string>>({});

  const canManageSalary = viewerRole === "admin";
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

  const selectedWorker = selectedWorkerId ? usersById.get(selectedWorkerId) ?? null : null;
  const isSelectedWorkerSalaryTracked = selectedWorker ? isSalaryTrackedWorker(selectedWorker) : false;

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
        sessionTimingChanged && clockOutIso !== null && laborCostInput === originalLaborCost;

      await postJson(path, {
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
      setSessionDialogOpen(false);
      setMessage(sessionMode === "create" ? "המשמרת נוספה." : "המשמרת עודכנה.");
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
    runAction(async () => {
      await postJson("/api/payroll/sessions/delete", { session_id: sessionId });
      setMessage("המשמרת נמחקה.");
      await refreshAll();
    });
  }

  function recalculateSession(sessionId: string) {
    runAction(async () => {
      await postJson("/api/payroll/sessions/recalculate", { session_id: sessionId });
      setMessage("עלות העבודה חושבה מחדש.");
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
      });
      setMessage("פרטי הגישה עודכנו.");
      await refreshAll({ reloadProtected: false });
    });
  }

  function saveAgreement() {
    const targetUserId = agreementForm.user_id || selectedWorker?.id || "";
    if (!targetUserId) return;
    runAction(async () => {
      await postJson("/api/payroll/salary-agreements", {
        agreement_id: agreementForm.agreement_id || undefined,
        user_id: targetUserId,
        ...agreementForm,
      });
      setAgreementForm(DEFAULT_AGREEMENT_FORM);
      setMessage("הסכם השכר נשמר.");
      await refreshAll();
    });
  }

  function openNewAgreementDialog(userId: string, currentAgreement?: SalaryAgreementRow | null) {
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
    runAction(async () => {
      await postJson("/api/payroll/periods", { action, period_id: periodId });
      setMessage(
        action === "generate"
          ? "התלושים נוצרו."
          : action === "lock"
            ? "תקופת השכר ננעלה."
            : "תקופת השכר סומנה כשולמה."
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
  const selectedWorkerOverrides = useMemo(
    () => (selectedWorker ? (protectedData?.hourlyOverrides ?? []).filter((override) => override.user_id === selectedWorker.id) : []),
    [protectedData, selectedWorker]
  );

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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {canCreateUsers ? (
            <Button variant="outline" onClick={() => setCreateUserOpen(true)}>
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
          className="max-w-sm"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="employees">{"עובדים"}</TabsTrigger>
          <TabsTrigger value="labor">{"פועלים"}</TabsTrigger>
          <TabsTrigger value="attendance">{"נוכחות"}</TabsTrigger>
          <TabsTrigger value="agreements">{"הסכמי שכר"}</TabsTrigger>
          <TabsTrigger value="periods">{"תקופות שכר"}</TabsTrigger>
          <TabsTrigger value="payslips">{"תלושים"}</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="space-y-3">
          {employeeWorkers.map((worker) => {
            const monthStats = getWorkerMonthStats(worker.id, publicSessions);
            const currentAgreement = getCurrentSalaryAgreement(agreementsByUserId.get(worker.id) ?? []);
            const latestPayslip = [...(payslipsByUserId.get(worker.id) ?? [])].sort((a, b) =>
              (periodsById.get(b.payroll_period_id)?.period_month ?? "").localeCompare(
                periodsById.get(a.payroll_period_id)?.period_month ?? ""
              )
            )[0] ?? null;
            const salaryTracked = isSalaryTrackedWorker(worker);

            return (
              <Card key={worker.id}>
                <CardContent className="space-y-4 py-5">
                  <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
                    <div className="flex flex-wrap gap-2 md:col-start-1 md:justify-self-start">
                      <Button variant="outline" onClick={() => setSelectedWorkerId(worker.id)}>
                        {"פרטי עובד"}
                      </Button>
                      {canManageAttendance && isAttendanceWorker(worker) ? (
                        <Button variant="ghost" onClick={() => openCreateSession(worker.id)}>
                          {"הוספת משמרת"}
                        </Button>
                      ) : null}
                    </div>

                    <div className="min-w-0 space-y-2 md:col-start-2 md:justify-self-end md:text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <div className="shrink-0 text-lg font-semibold">{worker.full_name ?? worker.email ?? "עובד"}</div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <RoleBadge role={worker.role} />
                          <AccessBadge hasAccess={getWorkerAccessLabel(worker) === "עם גישה"} />
                          <StatusPill tone={worker.active === false ? "muted" : "success"}>
                            {worker.active === false ? "לא פעיל" : "פעיל"}
                          </StatusPill>
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {[worker.email, worker.phone].filter(Boolean).join(" • ") || "ללא פרטי קשר"}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <InlineMetric label="שעות החודש" value={formatMinutes(monthStats.totalMinutes)} />
                    <InlineMetric label="משמרות" value={String(monthStats.sessionCount)} />
                    <InlineMetric label="פרויקטים / קישורים" value={String(monthStats.projectCount)} />
                    <InlineMetric label="פתוחות" value={String(monthStats.openSessionCount)} />
                  </div>

                  {salaryTracked ? (
                    <SalaryProtected
                      unlocked={salaryUnlocked}
                      hasPasswordConfigured={hasPasswordConfigured}
                      canUnlock={canManageSalary}
                      onUnlockSuccess={loadProtectedData}
                    >
                      <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3">
                        <div className="mb-2 text-xs font-medium text-muted-foreground">{"נתוני שכר"}</div>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          <InlineMetric
                          label="שעות החודש"
                          value={formatMinutes(monthStats.totalMinutes)}
                          forceShow
                          />
                          <InlineMetric
                          label="הסכם שכר נוכחי"
                          value={
                            currentAgreement
                              ? currentAgreement.salary_type === "hourly"
                                ? `${formatCurrency(currentAgreement.hourly_rate)} / שעה`
                                : formatCurrency(currentAgreement.monthly_salary)
                              : "-"
                          }
                          />
                          <InlineMetric
                          label="עלות עבודה החודש"
                          value={formatCurrency(
                            publicSessions
                              .filter(
                                (session) =>
                                  session.user_id === worker.id && monthKeyFromDate(session.clock_in) === currentMonthKey
                              )
                              .reduce((sum, session) => sum + (sessionCostsById.get(session.id) ?? 0), 0)
                          )}
                          />
                          <InlineMetric
                          label="תלוש אחרון"
                          value={latestPayslip ? formatCurrency(latestPayslip.gross_salary) : "-"}
                          />
                        </div>
                      </div>
                    </SalaryProtected>
                  ) : (
                    <div className="rounded-2xl border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
                      {"עובד ללא גישה מנוהל לפי עבודה/פרויקט, בלי הסכמי שכר ותלושים קבועים."}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="labor" className="space-y-3">
          {laborWorkers.map((worker) => {
            const monthStats = getWorkerMonthStats(worker.id, publicSessions);

            return (
              <Card key={worker.id}>
                <CardContent className="space-y-4 py-5">
                  <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
                    <div className="flex flex-wrap gap-2 md:col-start-1 md:justify-self-start">
                      <Button variant="outline" onClick={() => setSelectedWorkerId(worker.id)}>
                        {"פרטי פועל"}
                      </Button>
                      {canManageAttendance && isAttendanceWorker(worker) ? (
                        <Button variant="ghost" onClick={() => openCreateSession(worker.id)}>
                          {"הוספת משמרת"}
                        </Button>
                      ) : null}
                    </div>

                    <div className="min-w-0 space-y-2 md:col-start-2 md:justify-self-end md:text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <div className="shrink-0 text-lg font-semibold">{worker.full_name ?? worker.email ?? "פועל"}</div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <StatusPill tone="warning">{"פועל"}</StatusPill>
                          <AccessBadge hasAccess={false} />
                          <StatusPill tone={worker.active === false ? "muted" : "success"}>
                            {worker.active === false ? "לא פעיל" : "פעיל"}
                          </StatusPill>
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {[worker.email, worker.phone].filter(Boolean).join(" • ") || "ללא פרטי קשר"}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <InlineMetric label="שעות החודש" value={formatMinutes(monthStats.totalMinutes)} />
                    <InlineMetric label="משמרות" value={String(monthStats.sessionCount)} />
                    <InlineMetric label="פרויקטים / קישורים" value={String(monthStats.projectCount)} />
                    <InlineMetric label="פתוחות" value={String(monthStats.openSessionCount)} />
                  </div>

                  <div className="rounded-2xl border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
                    {"פועלים מנוהלים לפי עבודה / פרויקט, בלי הסכמי שכר חודשיים ובלי תלושים."}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="attendance" className="space-y-3">
          <Card>
            <CardContent className="grid gap-3 py-5 md:grid-cols-3 xl:grid-cols-6">
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

          {filteredSessions.map((session) => {
            const worker = usersById.get(session.user_id);
            const linkLabel = getSessionLinkLabel(session, projectLabelsById, propertyLabelsById);
            return (
              <Card key={session.id}>
                <CardContent className="space-y-4 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold">{worker?.full_name ?? worker?.email ?? "עובד"}</div>
                        <StatusPill tone="muted">{getBusinessDomainLabel(session.business_domain)}</StatusPill>
                        <StatusPill tone="muted">{linkLabel}</StatusPill>
                        <StatusPill tone={session.clock_out ? "success" : "warning"}>
                          {session.clock_out ? "סגור" : "פתוח"}
                        </StatusPill>
                        <StatusPill tone={session.locked ? "danger" : "muted"}>
                          {session.locked ? "נעול" : "ניתן לעריכה"}
                        </StatusPill>
                        {session.billing_status ? (
                          <StatusPill tone={session.billing_status === "paid" ? "success" : "muted"}>
                            {getBillingStatusLabel(session.billing_status)}
                          </StatusPill>
                        ) : null}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatSessionRange(session.clock_in, session.clock_out)}
                      </div>
                    </div>

                    <div className="grid min-w-[220px] gap-2 sm:grid-cols-3">
                      <InlineMetric label="משך" value={formatMinutes(sessionWorkedMinutes(session))} />
                      <InlineMetric
                        label="חיוב לקוח"
                        value={
                          session.is_billable_to_customer
                            ? formatCurrency(session.bill_to_customer_amount)
                            : "לא לחיוב"
                        }
                      />
                      <SalaryProtected
                        unlocked={salaryUnlocked}
                        hasPasswordConfigured={hasPasswordConfigured}
                        canUnlock={canManageSalary}
                        onUnlockSuccess={loadProtectedData}
                        fallback={<InlineMetric label="עלות עבודה" value="מוגן" />}
                      >
                        <InlineMetric label="עלות עבודה" value={formatCurrency(sessionCostsById.get(session.id) ?? 0)} />
                      </SalaryProtected>
                    </div>
                  </div>

                  {session.notes ? (
                    <div className="rounded-2xl bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{session.notes}</div>
                  ) : null}

                  {canManageAttendance ? (
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <Button variant="outline" onClick={() => openEditSession(session)} disabled={session.locked || isPending}>
                        {"עריכה"}
                      </Button>
                      {!session.clock_out ? (
                        <Button variant="ghost" onClick={() => closeOpenSession(session.id)} disabled={session.locked || isPending}>
                          {"סגירת משמרת"}
                        </Button>
                      ) : null}
                      <Button variant="ghost" onClick={() => deleteSession(session.id)} disabled={session.locked || isPending}>
                        {"מחיקה"}
                      </Button>
                      {canManageSalary ? (
                        <SalaryProtected
                          unlocked={salaryUnlocked}
                          hasPasswordConfigured={hasPasswordConfigured}
                          canUnlock={canManageSalary}
                          onUnlockSuccess={loadProtectedData}
                          fallback={null}
                        >
                          <Button variant="ghost" onClick={() => recalculateSession(session.id)} disabled={session.locked || isPending}>
                            {"חישוב מחדש של עלות עבודה"}
                          </Button>
                        </SalaryProtected>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="agreements">
          <SalaryProtected
            unlocked={salaryUnlocked}
            hasPasswordConfigured={hasPasswordConfigured}
            canUnlock={canManageSalary}
            onUnlockSuccess={loadProtectedData}
          >
            <div className="space-y-3">
              {publicUsers
                .filter((user) => isSalaryTrackedWorker(user))
                .map((worker) => {
                  const workerAgreements = agreementsByUserId.get(worker.id) ?? [];
                  const current = getCurrentSalaryAgreement(workerAgreements);
                  return (
                    <Card key={worker.id}>
                      <CardContent className="space-y-3 py-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="font-semibold">{worker.full_name ?? worker.email ?? "עובד"}</div>
                          <div className="flex flex-wrap gap-2">
                            {current ? (
                              <Tag>
                                {current.salary_type === "hourly"
                                  ? `${formatCurrency(current.hourly_rate)} / שעה`
                                  : formatCurrency(current.monthly_salary)}
                              </Tag>
                            ) : (
                              <Tag>{"ללא הסכם פעיל"}</Tag>
                            )}
                            <Button variant="outline" onClick={() => openNewAgreementDialog(worker.id, current)}>
                              {"הסכם חדש"}
                            </Button>
                          </div>
                        </div>
                        {workerAgreements.length === 0 ? (
                          <div className="text-sm text-muted-foreground">{"אין עדיין היסטוריית שכר."}</div>
                        ) : (
                          workerAgreements.map((agreement) => (
                            <div key={agreement.id} className="rounded-2xl border p-3 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>{getSalaryTypeLabel(agreement.salary_type)}</div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="font-semibold">
                                    {agreement.salary_type === "hourly"
                                      ? `${formatCurrency(agreement.hourly_rate)} / שעה`
                                      : formatCurrency(agreement.monthly_salary)}
                                  </div>
                                  <Button variant="ghost" onClick={() => openEditAgreementDialog(agreement)}>
                                    {"עריכה"}
                                  </Button>
                                </div>
                              </div>
                              <div className="mt-1 text-muted-foreground">
                                {`${formatDate(agreement.valid_from)} - ${formatDate(agreement.valid_to)}`}
                              </div>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          </SalaryProtected>
        </TabsContent>

        <TabsContent value="periods">
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
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSelectedPeriodId(period.id);
                          runPeriodAction("mark_paid", period.id);
                        }}
                        disabled={normalizePayrollStatus(period.status) === "paid" || isPending}
                      >
                        {"סימון כשולם"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
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

      <Sheet open={Boolean(selectedWorker)} onOpenChange={(open) => !open && setSelectedWorkerId("")}>
        <SheetContent side="right" className="w-full overflow-y-auto text-right sm:max-w-2xl" dir="rtl">
          {selectedWorker ? (
            <>
              <SheetHeader className="text-center">
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <SheetTitle>{selectedWorker.full_name ?? selectedWorker.email ?? "עובד"}</SheetTitle>
                  {isAttendanceWorker(selectedWorker) ? (
                    <Button variant="outline" onClick={() => openCreateSession(selectedWorker.id)}>
                      {"הוספת משמרת"}
                    </Button>
                  ) : null}
                </div>
              </SheetHeader>

              <div className="mt-6 space-y-5">
                <Card>
                  <CardContent className="space-y-3 py-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoRow label="שם מלא" value={selectedWorker.full_name ?? "—"} />
                      <InfoRow label="אימייל" value={selectedWorker.email ?? "—"} />
                      <InfoRow label="טלפון" value={selectedWorker.phone ?? "—"} />
                      <InfoRow label="תפקיד" value={getRoleLabel(selectedWorker.role)} />
                      <InfoRow label="סטטוס" value={selectedWorker.active === false ? "לא פעיל" : "פעיל"} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setWorkerAccessDialogOpen(true)} disabled={isPending}>
                        {"עדכון פרטי עובד"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-3 py-5">
                    <div className="text-lg font-semibold">{"נוכחות"}</div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <MiniStat label="שעות החודש" value={selectedWorkerStats ? formatMinutes(selectedWorkerStats.totalMinutes) : "0:00"} />
                      <MiniStat label="משמרות החודש" value={selectedWorkerStats ? String(selectedWorkerStats.sessionCount) : "0"} />
                      <MiniStat label="סה״כ תשלום" value={formatCurrency(selectedWorkerTotalPay)} />
                    </div>
                    <div className="space-y-2">
                      {selectedWorkerSessions.slice(0, 12).map((session) => (
                        <div key={session.id} className="rounded-2xl border p-3 text-sm">
                          {(() => {
                            const payrollPeriod = getSessionPayrollPeriod(session);
                            return (
                              <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>{`${formatDateTime(session.clock_in)}${session.clock_out ? ` - ${formatDateTime(session.clock_out)}` : ""}`}</div>
                            <div className="flex flex-wrap gap-2">
                              <Tag>{getBusinessDomainLabel(session.business_domain)}</Tag>
                              <Tag>{session.locked ? "נעול" : "פתוח לעריכה"}</Tag>
                              {payrollPeriod ? <Tag>{getPayrollPeriodLabel(payrollPeriod.status)}</Tag> : null}
                            </div>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {`${formatMinutes(sessionWorkedMinutes(session))} • ${getSessionLinkLabel(
                              session,
                              projectLabelsById,
                              propertyLabelsById
                            )}`}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {`עלות עבודה: ${formatCurrency(sessionCostsById.get(session.id) ?? 0)}${
                              payrollPeriod ? ` • תקופה: ${monthLabelFromKey(payrollPeriod.period_month)}` : ""
                            }`}
                          </div>
                          {!session.locked ? (
                            <div className="mt-3 flex flex-wrap gap-2">
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

                {isSelectedWorkerSalaryTracked ? (
                  <SalaryProtected
                    unlocked={salaryUnlocked}
                    hasPasswordConfigured={hasPasswordConfigured}
                    canUnlock={canManageSalary}
                    onUnlockSuccess={loadProtectedData}
                  >
                    <Card>
                      <CardContent className="space-y-4 py-5">
                        <div className="text-lg font-semibold">{"שכר"}</div>
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                              <Button onClick={() => setAgreementDialogOpen(true)} disabled={isPending}>
                                {"הוספת הסכם חדש"}
                              </Button>
                              <Button variant="outline" onClick={() => setOverrideDialogOpen(true)} disabled={isPending}>
                                {"הוספת החרגה"}
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="font-medium">{"היסטוריית הסכמים"}</div>
                            {(agreementsByUserId.get(selectedWorker.id) ?? []).map((agreement) => (
                              <div key={agreement.id} className="rounded-2xl border p-3 text-sm">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>{getSalaryTypeLabel(agreement.salary_type)}</div>
                                  <div className="font-semibold">
                                    {agreement.salary_type === "hourly"
                                      ? `${formatCurrency(agreement.hourly_rate)} / שעה`
                                      : formatCurrency(agreement.monthly_salary)}
                                  </div>
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  {`${formatDate(agreement.valid_from)} - ${formatDate(agreement.valid_to)}`}
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  {agreement.salary_type === "hourly"
                                    ? `תעריף שעתי: ${formatCurrency(agreement.hourly_rate)}`
                                    : `שכר חודשי: ${formatCurrency(agreement.monthly_salary)}`}
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  {`תעריף שעות נוספות: ${formatCurrency(agreement.overtime_rate)} • שעות יומיות תקניות: ${agreement.standard_daily_hours ?? "0"}`}
                                </div>
                                {agreement.notes ? (
                                  <div className="mt-2 rounded-2xl bg-muted/30 px-3 py-2 text-muted-foreground">
                                    {agreement.notes}
                                  </div>
                                ) : null}
                              </div>
                            ))}

                            <div className="font-medium">{"החרגות שכר שעתי"}</div>
                            {selectedWorkerOverrides.length === 0 ? (
                              <div className="text-sm text-muted-foreground">{"אין החרגות שכר."}</div>
                            ) : (
                              selectedWorkerOverrides.map((override, index) => (
                                <div key={`${override.created_at ?? "override"}-${index}`} className="rounded-2xl border p-3 text-sm">
                                  <div className="font-semibold">{formatCurrency(override.override_hourly_rate)}</div>
                                  <div className="mt-1 text-muted-foreground">
                                    {override.created_at ? formatDateTime(override.created_at) : "ללא תאריך"}
                                  </div>
                                  {override.notes ? (
                                    <div className="mt-2 rounded-2xl bg-muted/30 px-3 py-2 text-muted-foreground">
                                      {override.notes}
                                    </div>
                                  ) : null}
                                </div>
                              ))
                            )}

                            <div className="font-medium">{"תלושים"}</div>
                            {(payslipsByUserId.get(selectedWorker.id) ?? []).length === 0 ? (
                              <div className="text-sm text-muted-foreground">{"אין תלושים לעובד הזה כרגע."}</div>
                            ) : (
                              (payslipsByUserId.get(selectedWorker.id) ?? []).map((payslip) => {
                                const period = periodsById.get(payslip.payroll_period_id);
                                return (
                                  <div key={payslip.id} className="rounded-2xl border p-3 text-sm">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div>{period ? monthLabelFromKey(period.period_month) : "תקופה"}</div>
                                      <div className="font-semibold">{formatCurrency(payslip.gross_salary)}</div>
                                    </div>
                                    <div className="mt-1 text-muted-foreground">
                                      {`${formatMinutes(payslip.total_work_minutes)} • ${getSalaryTypeLabel(
                                        payslip.calculated_salary_type
                                      )}`}
                                    </div>
                                    <div className="mt-1 text-muted-foreground">
                                      {`שכר בסיס: ${formatCurrency(payslip.calculated_base_salary)} • התאמות: ${formatCurrency(payslip.manual_adjustments)}`}
                                    </div>
                                    {period ? (
                                      <div className="mt-1 text-muted-foreground">{`סטטוס: ${getPayrollPeriodLabel(period.status)} • ${formatDate(period.start_date)} - ${formatDate(period.end_date)}`}</div>
                                    ) : null}
                                  </div>
                                );
                              })
                            )}

                            {selectedPeriodId ? (
                              <Button onClick={() => generateWorkerPayslip(selectedWorker.id)} disabled={isPending}>
                                {"יצירת / חישוב תלוש לתקופה שנבחרה"}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </SalaryProtected>
                ) : (
                  <Card>
                    <CardContent className="py-5 text-sm text-muted-foreground">
                      {"העובד הזה מנוהל לפי משימות / פרויקטים בלבד, ולכן אין עבורו הסכמי שכר, תלושים או היסטוריית שכר חודשית."}
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

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
            <DialogTitle>{agreementForm.agreement_id ? "עריכת הסכם שכר" : "הוספת הסכם שכר"}</DialogTitle>
            <DialogDescription>
              {agreementForm.agreement_id ? "עדכון הסכם שכר קיים." : "הוספת הסכם חדש לעובד הנבחר."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
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
              <Input
                type="date"
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
                inputMode="decimal"
                value={agreementForm.standard_daily_hours}
                onChange={(event) =>
                  setAgreementForm((current) => ({ ...current, standard_daily_hours: event.target.value }))
                }
              />
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
              onClick={() => {
                saveAgreement();
                setAgreementDialogOpen(false);
              }}
              disabled={isPending}
            >
              {agreementForm.agreement_id ? "שמירת שינויים" : "שמירת הסכם שכר"}
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

function InlineMetric({
  label,
  value,
  forceShow = false,
}: {
  label: string;
  value: string;
  forceShow?: boolean;
}) {
  if (
    !forceShow &&
    (label === "משמרות" ||
      label === "פרויקטים / קישורים" ||
      label === "פתוחות" ||
      label === "שעות החודש")
  ) {
    return null;
  }

  return (
    <div className="rounded-2xl border bg-background/80 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
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
