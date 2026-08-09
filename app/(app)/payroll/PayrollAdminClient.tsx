"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { clearDraft, loadDraft, offlineFetch, saveDraft } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, DeleteIcon, DragIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import type { UserRole } from "@/lib/auth/requireProfile";
import { getBusinessDomainLabel, WORK_SESSION_BUSINESS_DOMAINS } from "@/lib/expenses";
import { DomainSelect } from "@/components/financial/DomainSelect";
import {
  calculateSessionLaborCost,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMinutes,
  getActiveSalaryAgreementForDate,
  getCurrentSalaryAgreement,
  getNextMonthDueText,
  getPayrollStatusLabel,
  getSalaryTypeLabel,
  sessionWorkedMinutes,
  toNumber,
  type PayrollPeriodRow,
  type PayslipRow,
  type SalaryAgreementRow,
  type WorkSessionRow,
} from "@/lib/payroll";

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  active: boolean | null;
};

type Props = {
  viewerRole: UserRole;
  unlocked: boolean;
  hasPasswordConfigured: boolean;
  users: UserRow[];
  agreements: SalaryAgreementRow[];
  payslips: PayslipRow[];
  periods: PayrollPeriodRow[];
  sessions: WorkSessionRow[];
  projectOptions: Array<{ id: string; label: string }>;
  propertyOptions: Array<{ id: string; label: string }>;
};

type FormState = {
  salary_type: "hourly" | "monthly";
  hourly_rate: string;
  monthly_salary: string;
  valid_from: string;
  overtime_rate: string;
  standard_daily_hours: string;
  notes: string;
};

type EditableSessionField = "labor_cost" | "worked_minutes" | "bill_to_customer_amount";

type CreateUserFormState = {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  role: "worker" | "worker_no_access";
};

type CreateSessionFormState = {
  user_id: string;
  business_domain: string;
  project_id: string;
  property_id: string;
  notes: string;
  clock_in: string;
  clock_out: string;
  labor_cost: string;
  is_billable_to_customer: boolean;
  bill_to_customer_amount: string;
};

type PendingAdminDeletion = {
  session: WorkSessionRow;
};

const DEFAULT_FORM: FormState = {
  salary_type: "monthly",
  hourly_rate: "",
  monthly_salary: "",
  valid_from: new Date().toISOString().slice(0, 10),
  overtime_rate: "",
  standard_daily_hours: "0",
  notes: "",
};

const DEFAULT_CREATE_USER_FORM: CreateUserFormState = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
  role: "worker",
};

const DEFAULT_CREATE_SESSION_FORM: CreateSessionFormState = {
  user_id: "",
  business_domain: "general_business",
  project_id: "",
  property_id: "",
  notes: "",
  clock_in: new Date(new Date().setSeconds(0, 0)).toISOString().slice(0, 16),
  clock_out: new Date(new Date(Date.now() + 60 * 60 * 1000).setSeconds(0, 0)).toISOString().slice(0, 16),
  labor_cost: "",
  is_billable_to_customer: false,
  bill_to_customer_amount: "",
};

export default function PayrollAdminClient({
  viewerRole,
  unlocked,
  hasPasswordConfigured,
  users,
  agreements,
  payslips,
  periods,
  sessions,
  projectOptions,
  propertyOptions,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const canManageSessions = viewerRole === "admin" || viewerRole === "office";
  const canViewSalary = viewerRole === "admin" && unlocked;
  const canCreateUsers = viewerRole === "admin";
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [filter, setFilter] = useState("");
  const [expandedUserId, setExpandedUserId] = useState("");
  const [editingUserId, setEditingUserId] = useState("");
  const [orderedUserIds, setOrderedUserIds] = useState(() => users.map((user) => user.id));
  const [draggingUserId, setDraggingUserId] = useState("");
  const [dragOverUserId, setDragOverUserId] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createUserForm, setCreateUserForm] = useState<CreateUserFormState>(DEFAULT_CREATE_USER_FORM);
  const [createUserError, setCreateUserError] = useState("");
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const [createSessionForm, setCreateSessionForm] = useState<CreateSessionFormState>(() => {
    const draft = loadDraft<CreateSessionFormState>("session-create");
    return draft
      ? { ...DEFAULT_CREATE_SESSION_FORM, ...draft }
      : {
          ...DEFAULT_CREATE_SESSION_FORM,
          clock_in: toDateTimeLocalValue(new Date(Date.now() - 60 * 60 * 1000)),
          clock_out: toDateTimeLocalValue(new Date()),
        };
  });
  const [createSessionError, setCreateSessionError] = useState("");
  const [sessionLaborCostDrafts, setSessionLaborCostDrafts] = useState<Record<string, string>>({});
  const [sessionDurationDrafts, setSessionDurationDrafts] = useState<Record<string, string>>({});
  const [sessionBillableAmountDrafts, setSessionBillableAmountDrafts] = useState<Record<string, string>>({});
  const [sessionEditError, setSessionEditError] = useState("");
  const [sessionEditErrorId, setSessionEditErrorId] = useState("");
  const [pendingSessionEditConfirm, setPendingSessionEditConfirm] = useState<{
    session: WorkSessionRow;
    field: EditableSessionField;
    oldValue: number;
    newValue: number;
  } | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState("");
  const [deleteSessionError, setDeleteSessionError] = useState("");
  const [deleteSessionErrorId, setDeleteSessionErrorId] = useState("");
  const [pendingDeletion, setPendingDeletion] = useState<PendingAdminDeletion | null>(null);
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM);

  const periodsById = useMemo(() => new Map(periods.map((period) => [period.id, period])), [periods]);
  const agreementsByUserId = useMemo(() => {
    const map = new Map<string, SalaryAgreementRow[]>();
    agreements.forEach((agreement) => {
      const list = map.get(agreement.user_id) ?? [];
      list.push(agreement);
      map.set(agreement.user_id, list);
    });
    return map;
  }, [agreements]);
  const standardDailyHoursValid = toNumber(formState.standard_daily_hours) > 0;
  const latestPayslipByUserId = useMemo(() => {
    const map = new Map<string, PayslipRow>();
    payslips.forEach((payslip) => {
      const existing = map.get(payslip.user_id);
      const existingPeriod = existing ? periodsById.get(existing.payroll_period_id)?.period_month ?? "" : "";
      const nextPeriod = periodsById.get(payslip.payroll_period_id)?.period_month ?? "";
      if (!existing || nextPeriod.localeCompare(existingPeriod) > 0) {
        map.set(payslip.user_id, payslip);
      }
    });
    return map;
  }, [payslips, periodsById]);
  const sessionsByUserId = useMemo(() => {
    const map = new Map<string, WorkSessionRow[]>();
    sessions.forEach((session) => {
      const list = map.get(session.user_id) ?? [];
      list.push(session);
      map.set(session.user_id, list);
    });
    return map;
  }, [sessions]);
  const projectLabelsById = useMemo(
    () => new Map(projectOptions.map((option) => [option.id, option.label])),
    [projectOptions]
  );
  const propertyLabelsById = useMemo(
    () => new Map(propertyOptions.map((option) => [option.id, option.label])),
    [propertyOptions]
  );
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const createSessionWorkedMinutes = useMemo(() => {
    const start = new Date(createSessionForm.clock_in).getTime();
    const end = new Date(createSessionForm.clock_out).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.round((end - start) / 60000);
  }, [createSessionForm.clock_in, createSessionForm.clock_out]);
  const createSessionDurationHours = useMemo(() => {
    if (createSessionWorkedMinutes <= 0) return "";
    const hours = createSessionWorkedMinutes / 60;
    return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
  }, [createSessionWorkedMinutes]);
  const createSessionAgreement = useMemo(() => {
    if (!createSessionForm.user_id || !createSessionForm.clock_in) return null;
    return getActiveSalaryAgreementForDate(
      agreementsByUserId.get(createSessionForm.user_id) ?? [],
      new Date(createSessionForm.clock_in)
    );
  }, [agreementsByUserId, createSessionForm.clock_in, createSessionForm.user_id]);
  const createSessionSuggestedAmount = useMemo(() => {
    if (createSessionForm.labor_cost.trim()) {
      const parsed = Number(createSessionForm.labor_cost);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (createSessionWorkedMinutes <= 0) return null;
    return calculateSessionLaborCost(createSessionAgreement, createSessionWorkedMinutes);
  }, [createSessionAgreement, createSessionForm.labor_cost, createSessionWorkedMinutes]);

  useEffect(() => {
    if (!createSessionOpen) return;
    saveDraft("session-create", createSessionForm);
  }, [createSessionOpen, createSessionForm]);

  useEffect(() => {
    setOrderedUserIds((current) => {
      const validIds = current.filter((id) => usersById.has(id));
      const missingIds = users.map((user) => user.id).filter((id) => !validIds.includes(id));
      return [...validIds, ...missingIds];
    });
  }, [users, usersById]);

  const orderedUsers = useMemo(() => {
    const knownUsers = orderedUserIds
      .map((id) => usersById.get(id))
      .filter((user): user is UserRow => Boolean(user));
    if (knownUsers.length === users.length) return knownUsers;
    const missingUsers = users.filter((user) => !orderedUserIds.includes(user.id));
    return [...knownUsers, ...missingUsers];
  }, [orderedUserIds, users, usersById]);

  const filteredUsers = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return orderedUsers;
    return orderedUsers.filter((user) =>
      [user.full_name ?? "", user.email ?? "", user.phone ?? ""].join(" ").toLowerCase().includes(query)
    );
  }, [filter, orderedUsers]);
  const sessionAssignableUsers = useMemo(
    () =>
      orderedUsers.filter(
        (user) => user.active !== false && (user.role === "worker" || user.role === "worker_no_access")
      ),
    [orderedUsers]
  );

  function moveUserBefore(targetUserId: string) {
    if (!draggingUserId || draggingUserId === targetUserId) return;
    setOrderedUserIds((current) => reorderIds(current, draggingUserId, targetUserId));
    setDragOverUserId("");
  }

  async function unlock() {
    setUnlockError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/payroll/admin/unlock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setUnlockError(toHebrewError(json.error, "פתיחת מרכז השכר נכשלה."));
          return;
        }
        setPassword("");
        router.refresh();
      } catch (error: unknown) {
        setUnlockError(toHebrewError(error, "Unknown error"));
      }
    });
  }

  async function lockCenter() {
    if (!canViewSalary) return;
    startTransition(async () => {
      await fetch("/api/payroll/admin/lock", { method: "POST" });
      router.refresh();
    });
  }

  function resetCreateUserForm() {
    setCreateUserForm(DEFAULT_CREATE_USER_FORM);
    setCreateUserError("");
  }

  function resetCreateSessionForm() {
    clearDraft("session-create");
    setCreateSessionForm({
      ...DEFAULT_CREATE_SESSION_FORM,
      user_id: sessionAssignableUsers[0]?.id ?? "",
      clock_in: toDateTimeLocalValue(new Date(Date.now() - 60 * 60 * 1000)),
      clock_out: toDateTimeLocalValue(new Date()),
    });
    setCreateSessionError("");
  }

  async function createUser() {
    if (isPending) return;

    const fullName = createUserForm.full_name.trim();
    const email = createUserForm.email.trim().toLowerCase();
    const phone = createUserForm.phone.trim();
    const password = createUserForm.password;

    setCreateUserError("");
    setSaveError("");
    setSaveMessage("");

    if (!fullName) {
      setCreateUserError("יש להזין שם עובד.");
      return;
    }
    if (!email) {
      setCreateUserError("יש להזין אימייל.");
      return;
    }
    if (!password) {
      setCreateUserError("יש להזין סיסמה לעובד.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/users/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            full_name: fullName,
            email,
            phone: phone || null,
            password,
            role: createUserForm.role,
          }),
        });

        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setCreateUserError(toHebrewError(json.error, "יצירת העובד נכשלה."));
          return;
        }

        setCreateUserOpen(false);
        resetCreateUserForm();
        setSaveMessage("העובד והחשבון נוצרו בהצלחה.");
        router.refresh();
      } catch (error: unknown) {
        setCreateUserError(toHebrewError(error, "Unknown error"));
      }
    });
  }

  async function createSession() {
    if (!canManageSessions || isPending) return;

    const userId = createSessionForm.user_id.trim();
    const businessDomain = createSessionForm.business_domain.trim();
    const projectId = createSessionForm.project_id.trim();
    const propertyId = createSessionForm.property_id.trim();
    const notes = createSessionForm.notes.trim();
    const clockIn = createSessionForm.clock_in ? new Date(createSessionForm.clock_in).toISOString() : "";
    const clockOut = createSessionForm.clock_out ? new Date(createSessionForm.clock_out).toISOString() : "";
    const laborCost = createSessionForm.labor_cost.trim();

    setCreateSessionError("");
    setSaveError("");
    setSaveMessage("");

    if (!userId) {
      setCreateSessionError("יש לבחור עובד.");
      return;
    }
    if (!clockIn || !clockOut) {
      setCreateSessionError("יש להזין שעת התחלה ושעת סיום.");
      return;
    }
    if (new Date(clockOut) <= new Date(clockIn)) {
      setCreateSessionError("שעת הסיום חייבת להיות אחרי שעת ההתחלה.");
      return;
    }
    if (businessDomain === "logistics_projects" && !projectId) {
      setCreateSessionError("יש לבחור פרויקט.");
      return;
    }
    if (businessDomain === "property_management" && !propertyId) {
      setCreateSessionError("יש לבחור נכס.");
      return;
    }

    const billToCustomer = businessDomain === "logistics_projects" && createSessionForm.is_billable_to_customer;
    const billAmountInput = createSessionForm.bill_to_customer_amount.trim();
    const billAmountNumber = billToCustomer && billAmountInput ? Number(billAmountInput) : null;
    if (
      billToCustomer &&
      (!Number.isFinite(billAmountNumber) || billAmountNumber === null || billAmountNumber <= 0)
    ) {
      setCreateSessionError("יש להזין סכום לחיוב לקוח.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await offlineFetch(
          "/api/payroll/sessions/create",
          {
            user_id: userId,
            business_domain: businessDomain,
            project_id: projectId || null,
            property_id: propertyId || null,
            notes: notes || null,
            clock_in: clockIn,
            clock_out: clockOut,
            labor_cost: canViewSalary && laborCost ? laborCost : null,
            is_billable_to_customer: billToCustomer,
            bill_to_customer_amount: billToCustomer ? billAmountNumber : null,
            billing_status: billToCustomer ? "billable" : "not_billable",
          },
          "משמרת חדשה",
          { idempotent: true }
        );
        if (result.queued) {
          setCreateSessionOpen(false);
          resetCreateSessionForm();
          return;
        }
        if (!result.ok) {
          setCreateSessionError(toHebrewError(result.error, "יצירת המשמרת נכשלה."));
          return;
        }
        setCreateSessionOpen(false);
        resetCreateSessionForm();
        setSaveMessage("המשמרת נוספה בהצלחה.");
        router.refresh();
      } catch (error: unknown) {
        setCreateSessionError(toHebrewError(error, "יצירת המשמרת נכשלה."));
      }
    });
  }

  function openFormForUser(userId: string, agreement: SalaryAgreementRow | null) {
    setExpandedUserId(userId);
    setEditingUserId(userId);
    setSaveError("");
    setSaveMessage("");
    setFormState({
      salary_type: agreement?.salary_type === "hourly" ? "hourly" : "monthly",
      hourly_rate: agreement?.hourly_rate ? String(agreement.hourly_rate) : "",
      monthly_salary: agreement?.monthly_salary ? String(agreement.monthly_salary) : "",
      valid_from: new Date().toISOString().slice(0, 10),
      overtime_rate: agreement?.overtime_rate ? String(agreement.overtime_rate) : "",
      standard_daily_hours: agreement?.standard_daily_hours
        ? String(agreement.standard_daily_hours)
        : "0",
      notes: "",
    });
  }

  async function saveAgreement(userId: string) {
    setSaveError("");
    setSaveMessage("");
    if (!standardDailyHoursValid) {
      setSaveError("יש להזין שעות תקן יומיות גדולות מ-0.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/payroll/salary-agreements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...formState, user_id: userId }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setSaveError(toHebrewError(json.error, "שמירת הסכם השכר נכשלה."));
          return;
        }
        setSaveMessage("הסכם השכר נשמר בהצלחה.");
        setEditingUserId("");
        setFormState(DEFAULT_FORM);
        router.refresh();
      } catch (error: unknown) {
        setSaveError(toHebrewError(error, "Unknown error"));
      }
    });
  }

  function startEditingSessionField(session: WorkSessionRow, field: EditableSessionField) {
    setSessionEditError("");
    setSessionEditErrorId("");
    if (field === "labor_cost") {
      setSessionLaborCostDrafts((current) => ({
        ...current,
        [session.id]: current[session.id] ?? String(Math.max(0, toNumber(session.labor_cost))),
      }));
      return;
    }
    if (field === "worked_minutes") {
      setSessionDurationDrafts((current) => ({
        ...current,
        [session.id]: current[session.id] ?? formatDurationInput(sessionWorkedMinutes(session)),
      }));
      return;
    }
    setSessionBillableAmountDrafts((current) => ({
      ...current,
      [session.id]:
        current[session.id] ?? String(Math.max(0, toNumber(session.bill_to_customer_amount))),
    }));
  }

  function syncSessionDraftValue(session: WorkSessionRow, field: EditableSessionField, value: number) {
    if (field === "labor_cost") {
      setSessionLaborCostDrafts((current) => ({ ...current, [session.id]: String(value) }));
      return;
    }
    if (field === "worked_minutes") {
      setSessionDurationDrafts((current) => ({
        ...current,
        [session.id]: formatDurationInput(value),
      }));
      return;
    }
    setSessionBillableAmountDrafts((current) => ({ ...current, [session.id]: String(value) }));
  }

  function cancelSessionFieldEdit() {
    setSessionEditError("");
    setSessionEditErrorId("");
    if (pendingSessionEditConfirm) {
      syncSessionDraftValue(
        pendingSessionEditConfirm.session,
        pendingSessionEditConfirm.field,
        pendingSessionEditConfirm.oldValue
      );
    }
    setPendingSessionEditConfirm(null);
  }

  async function confirmSessionCostChange() {
    await confirmSessionFieldChange();
  }

  async function saveSessionField(session: WorkSessionRow, field: EditableSessionField) {
    const rawValue =
      field === "labor_cost"
        ? sessionLaborCostDrafts[session.id] ?? String(Math.max(0, toNumber(session.labor_cost)))
        : field === "worked_minutes"
          ? sessionDurationDrafts[session.id] ?? formatDurationInput(sessionWorkedMinutes(session))
          : sessionBillableAmountDrafts[session.id] ??
            String(Math.max(0, toNumber(session.bill_to_customer_amount)));

    const parsedValue = parseSessionFieldInput(field, rawValue);
    if (parsedValue === null || parsedValue <= 0) {
      setSessionEditErrorId(session.id);
      setSessionEditError(getSessionFieldValidationMessage(field));
      return;
    }

    setSessionEditError("");
    setSessionEditErrorId("");
    const oldValue = getSessionFieldNumericValue(session, field);
    if (parsedValue === oldValue) {
      syncSessionDraftValue(session, field, oldValue);
      return;
    }

    setPendingSessionEditConfirm({
      session,
      field,
      oldValue,
      newValue: parsedValue,
    });
  }

  async function confirmSessionFieldChange() {
    const pending = pendingSessionEditConfirm;
    if (!pending) return;

    const { session, field, newValue } = pending;
    setSessionEditError("");
    setSessionEditErrorId("");
    const workedMinutes = field === "worked_minutes" ? newValue : sessionWorkedMinutes(session);
    const clockOut =
      field === "worked_minutes" ? addMinutesToIso(session.clock_in, workedMinutes) : session.clock_out;
    const laborCost =
      field === "labor_cost"
        ? newValue
        : field === "worked_minutes"
          ? null
          : Math.max(0, toNumber(session.labor_cost));
    const billToCustomerAmount =
      field === "bill_to_customer_amount"
        ? newValue
        : session.is_billable_to_customer
          ? Math.max(0, toNumber(session.bill_to_customer_amount))
          : null;

    startTransition(async () => {
      try {
        const response = await fetch("/api/profile/session/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session_id: session.id,
            user_id: session.user_id,
            business_domain: session.business_domain,
            project_id: session.project_id,
            property_id: session.property_id,
            notes: session.notes,
            clock_in: session.clock_in,
            clock_out: clockOut,
            labor_cost: laborCost,
            is_billable_to_customer: session.is_billable_to_customer === true,
            bill_to_customer_amount: billToCustomerAmount,
            billing_status: session.billing_status,
          }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setSessionEditErrorId(session.id);
          setSessionEditError(toHebrewError(json.error, getSessionFieldUpdateErrorMessage(field)));
          return;
        }
        syncSessionDraftValue(session, field, newValue);
        setPendingSessionEditConfirm(null);
        router.refresh();
      } catch (error: unknown) {
        setSessionEditErrorId(session.id);
        setSessionEditError(toHebrewError(error, "Unknown error"));
      }
    });
  }

  async function deleteSession(session: WorkSessionRow) {
    if (deletingSessionId) return;
    setPendingDeletion({ session });
  }

  async function confirmDeleteSession() {
    const session = pendingDeletion?.session;
    if (!session || deletingSessionId) return;

    setDeleteSessionError("");
    setDeleteSessionErrorId("");
    setDeletingSessionId(session.id);
    startTransition(async () => {
      try {
        const response = await fetch("/api/profile/session/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session_id: session.id,
            project_id: session.project_id,
          }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setDeleteSessionErrorId(session.id);
          setDeleteSessionError(toHebrewError(json.error, "מחיקת המשמרת נכשלה."));
          return;
        }
        if (pendingSessionEditConfirm?.session.id === session.id) {
          setPendingSessionEditConfirm(null);
        }
        setSessionLaborCostDrafts((current) => {
          const next = { ...current };
          delete next[session.id];
          return next;
        });
        setSessionDurationDrafts((current) => {
          const next = { ...current };
          delete next[session.id];
          return next;
        });
        setSessionBillableAmountDrafts((current) => {
          const next = { ...current };
          delete next[session.id];
          return next;
        });
        setPendingDeletion(null);
        router.refresh();
      } catch (error: unknown) {
        setDeleteSessionErrorId(session.id);
        setDeleteSessionError(toHebrewError(error, "Unknown error"));
      } finally {
        setDeletingSessionId("");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="חיפוש עובד לפי שם, אימייל או טלפון"
          className="max-w-sm"
        />
        <div className="flex flex-wrap gap-2">
          {canManageSessions ? (
            <Button
              variant="outline"
              onClick={() => {
                resetCreateSessionForm();
                setCreateSessionOpen(true);
              }}
              disabled={isPending}
            >
              {"הוספת משמרת"}
            </Button>
          ) : null}
          {canCreateUsers ? (
            <Button variant="outline" onClick={() => setCreateUserOpen(true)} disabled={isPending}>
              {"הוספת עובד"}
            </Button>
          ) : null}
          {canViewSalary ? (
            <Button variant="outline" onClick={() => void lockCenter()} disabled={isPending}>
              {"נעילת מרכז השכר"}
            </Button>
          ) : null}
        </div>
      </div>

      {viewerRole === "admin" && !hasPasswordConfigured ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <div className="text-lg font-semibold">{"הגדרת סיסמת מנהל חסרה"}</div>
            <div className="text-sm text-muted-foreground">
              {"כדי לצפות בנתוני השכר צריך להגדיר בשרת את `PAYROLL_ADMIN_PASSWORD`."}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {viewerRole === "admin" && hasPasswordConfigured && !unlocked ? (
        <Card>
          <CardContent className="space-y-4 py-6">
            <div>
              <div className="text-lg font-semibold">{"פתיחת נתוני השכר"}</div>
              <div className="text-sm text-muted-foreground">
                {"משמרות עובדים זמינות כבר עכשיו. כדי לצפות או לעדכן שכר בפועל צריך להזין את סיסמת השכר."}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,320px)_140px]">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="סיסמת מנהל"
              />
              <Button disabled={!password || isPending} onClick={() => void unlock()}>
                {"כניסה"}
              </Button>
            </div>
            {unlockError ? <div className="text-sm text-destructive">{unlockError}</div> : null}
          </CardContent>
        </Card>
      ) : null}

      {saveError ? <div className="text-sm text-destructive">{saveError}</div> : null}
      {saveMessage ? <div className="text-sm text-success-strong">{saveMessage}</div> : null}

      <div className="grid gap-4">
        {filteredUsers.map((user) => {
          const userAgreements = agreementsByUserId.get(user.id) ?? [];
          const userSessions = sessionsByUserId.get(user.id) ?? [];
          const currentAgreement = getCurrentSalaryAgreement(userAgreements);
          const latestPayslip = latestPayslipByUserId.get(user.id) ?? null;
          const latestPeriod = latestPayslip ? periodsById.get(latestPayslip.payroll_period_id) ?? null : null;
          const isExpanded = expandedUserId === user.id;
          const isEditing = editingUserId === user.id;
          const totalWorkedMinutes = userSessions.reduce(
            (sum, session) => sum + sessionWorkedMinutes(session),
            0
          );
          const totalLaborCost = userSessions.reduce(
            (sum, session) => sum + Math.max(0, toNumber(session.labor_cost)),
            0
          );

          return (
            <Card
              key={user.id}
              className={dragOverUserId === user.id ? "border-primary/60 bg-primary/5" : undefined}
              onDragOver={(event) => {
                if (!draggingUserId || draggingUserId === user.id) return;
                event.preventDefault();
                if (dragOverUserId !== user.id) {
                  setDragOverUserId(user.id);
                }
              }}
              onDragLeave={() => {
                if (dragOverUserId === user.id) {
                  setDragOverUserId("");
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                moveUserBefore(user.id);
                setDraggingUserId("");
              }}
              onDragEnd={() => {
                setDraggingUserId("");
                setDragOverUserId("");
              }}
            >
              <CardContent className="space-y-4 py-5">
                <div
                  role="button"
                  tabIndex={0}
                  className="flex w-full flex-wrap items-start justify-between gap-3 rounded-2xl text-right transition-colors hover:bg-muted/20"
                  onClick={() => setExpandedUserId((current) => (current === user.id ? "" : user.id))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setExpandedUserId((current) => (current === user.id ? "" : user.id));
                    }
                  }}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <button
                      type="button"
                      draggable
                      className="mt-0.5 cursor-grab rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
                      onClick={(event) => event.stopPropagation()}
                      onDragStart={(event) => {
                        event.stopPropagation();
                        setDraggingUserId(user.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", user.id);
                      }}
                      onDragEnd={() => {
                        setDraggingUserId("");
                        setDragOverUserId("");
                      }}
                      aria-label="גרירת עובד לשינוי סדר"
                      title="גרירת עובד לשינוי סדר"
                    >
                      <DragIcon className="h-4 w-4" />
                    </button>
                    <div className="min-w-0 flex-1">
                    <div className="text-lg font-semibold">{user.full_name ?? user.email ?? "עובד"}</div>
                    <div className="text-sm text-muted-foreground">
                      {user.email ?? "-"} | {user.phone ?? "-"} | {"תפקיד:"} {getRoleLabel(user.role)}
                    </div>
                  </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canViewSalary ? (
                      <Button
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          openFormForUser(user.id, currentAgreement);
                        }}
                      >
                        {"עדכון שכר"}
                      </Button>
                    ) : null}
                    <div className="flex items-center text-muted-foreground">
                      <ChevronDownIcon
                        className={`h-5 w-5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </div>
                  </div>
                </div>

                {isExpanded ? <div className={`grid gap-3 ${canViewSalary ? "lg:grid-cols-5" : "lg:grid-cols-2"}`}>
                  {canViewSalary ? (
                    <>
                      <MiniStat
                        label="שכר נוכחי"
                        value={
                          currentAgreement
                            ? currentAgreement.salary_type === "hourly"
                              ? `${formatCurrency(currentAgreement.hourly_rate)} לשעה`
                              : formatCurrency(currentAgreement.monthly_salary)
                            : "-"
                        }
                      />
                      <MiniStat
                        label="בתוקף מ"
                        value={currentAgreement ? formatDate(currentAgreement.valid_from) : "-"}
                      />
                    </>
                  ) : null}
                  <MiniStat label={"סה\"כ שעות"} value={formatMinutes(totalWorkedMinutes)} />
                  {canViewSalary ? <MiniStat label="עלות עבודה" value={formatCurrency(totalLaborCost)} /> : null}
                  {canViewSalary ? (
                    <MiniStat
                      label="תלוש אחרון"
                      value={latestPayslip ? formatCurrency(latestPayslip.gross_salary) : "-"}
                    />
                  ) : null}
                </div> : null}

                {isExpanded && canViewSalary && latestPayslip && latestPeriod ? (
                  <div className="rounded-2xl border bg-muted/20 p-4 text-sm">
                    <div className="font-medium">{"תלוש אחרון:"} {latestPeriod.period_month}</div>
                    <div className="mt-1 text-muted-foreground">
                      {"סטטוס:"} {getPayrollStatusLabel(latestPeriod.status)} | {"שעות:"}{" "}
                      {formatMinutes(latestPayslip.total_work_minutes)} | {"צפי תשלום:"}{" "}
                      {getNextMonthDueText(latestPeriod.end_date)}
                    </div>
                  </div>
                ) : null}

                {isExpanded ? <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{"פירוט עבודה"}</div>
                    <div className="text-xs text-muted-foreground">
                      {userSessions.length > 0
                        ? canViewSalary
                          ? `${userSessions.length} משמרות | ${formatMinutes(totalWorkedMinutes)} | ${formatCurrency(totalLaborCost)}`
                          : `${userSessions.length} משמרות | ${formatMinutes(totalWorkedMinutes)}`
                        : "אין משמרות מדווחות"}
                    </div>
                  </div>
                  {userSessions.length === 0 ? (
                    <EmptyState dense>
                      {"אין פירוט עבודה מדווח לעובד הזה כרגע."}
                    </EmptyState>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                      {userSessions.map((session) => {
                        const workedMinutes = sessionWorkedMinutes(session);
                        const laborCost = Math.max(0, toNumber(session.labor_cost));
                        const billableAmount =
                          session.is_billable_to_customer
                            ? Math.max(0, toNumber(session.bill_to_customer_amount))
                            : 0;
                        const sessionCostValue =
                          sessionLaborCostDrafts[session.id] ?? String(Math.max(0, toNumber(session.labor_cost)));
                        const sessionDurationValue =
                          sessionDurationDrafts[session.id] ?? formatDurationInput(workedMinutes);
                        const sessionBillableAmountValue =
                          sessionBillableAmountDrafts[session.id] ??
                          String(Math.max(0, toNumber(session.bill_to_customer_amount)));

                        return (
                          <div key={session.id} className="relative rounded-2xl border bg-muted/10 p-4 text-sm">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="absolute left-3 top-3 h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                              disabled={Boolean(deletingSessionId) || isPending}
                              onClick={() => void deleteSession(session)}
                              aria-label="מחיקת משמרת"
                              title="מחיקת משמרת"
                            >
                              <DeleteIcon className="h-4 w-4" />
                            </Button>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="font-medium">
                                  {session.business_domain === "logistics_projects" && session.project_id ? (
                                    <Link
                                      href={`/projects/${session.project_id}`}
                                      className="underline-offset-4 hover:underline"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      {getSessionWorkLabel(session, projectLabelsById, propertyLabelsById)}
                                    </Link>
                                  ) : (
                                    getSessionWorkLabel(session, projectLabelsById, propertyLabelsById)
                                  )}
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  {getBusinessDomainLabel(session.business_domain)}
                                </div>
                              </div>
                              <div className="hidden" aria-hidden="true">
                                <div className="font-semibold">
                                  {canViewSalary ? formatCurrency(laborCost) : ""}
                                </div>
                                <div className="text-xs text-muted-foreground">{formatMinutes(workedMinutes)}</div>
                              </div>
                            </div>
                            <div className="mt-3 text-muted-foreground">
                              {formatDateTime(session.clock_in)}{" "}
                              {session.clock_out ? `- ${formatDateTime(session.clock_out)}` : "- פתוח"}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                              {canViewSalary ? (
                                <div className="flex items-center gap-2 rounded-full border px-2 py-1">
                                  <span>{"עלות:"}</span>
                                  <Input
                                    inputMode="decimal"
                                    value={sessionCostValue}
                                    onFocus={() => startEditingSessionField(session, "labor_cost")}
                                    onChange={(event) =>
                                      setSessionLaborCostDrafts((current) => ({
                                        ...current,
                                        [session.id]: event.target.value,
                                      }))
                                    }
                                    onBlur={() => void saveSessionField(session, "labor_cost")}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void saveSessionField(session, "labor_cost");
                                      }
                                    }}
                                    placeholder="עלות לעובד"
                                    className="h-7 w-28 border-0 bg-transparent px-1 text-right shadow-none focus-visible:ring-0"
                                  />
                                </div>
                              ) : null}
                              <div className="flex items-center gap-2 rounded-full border px-2 py-1">
                                <span>{"זמן:"}</span>
                                <Input
                                  inputMode="text"
                                  value={sessionDurationValue}
                                  onFocus={() => startEditingSessionField(session, "worked_minutes")}
                                  onChange={(event) =>
                                    setSessionDurationDrafts((current) => ({
                                      ...current,
                                      [session.id]: event.target.value,
                                    }))
                                  }
                                  onBlur={() => void saveSessionField(session, "worked_minutes")}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      void saveSessionField(session, "worked_minutes");
                                    }
                                  }}
                                  placeholder="5:00"
                                  className="h-7 w-24 border-0 bg-transparent px-1 text-right shadow-none focus-visible:ring-0"
                                />
                              </div>
                              <span className="hidden rounded-full border px-2 py-1">
                                {"זמן:"} {formatMinutes(workedMinutes)}
                              </span>
                              {session.is_billable_to_customer ? (
                                <>
                                <div className="flex items-center gap-2 rounded-full border px-2 py-1">
                                  <span>{"חיוב ללקוח:"}</span>
                                  <Input
                                    inputMode="decimal"
                                    value={sessionBillableAmountValue}
                                    onFocus={() => startEditingSessionField(session, "bill_to_customer_amount")}
                                    onChange={(event) =>
                                      setSessionBillableAmountDrafts((current) => ({
                                        ...current,
                                        [session.id]: event.target.value,
                                      }))
                                    }
                                    onBlur={() => void saveSessionField(session, "bill_to_customer_amount")}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void saveSessionField(session, "bill_to_customer_amount");
                                      }
                                    }}
                                    placeholder="חיוב ללקוח"
                                    className="h-7 w-28 border-0 bg-transparent px-1 text-right shadow-none focus-visible:ring-0"
                                  />
                                </div>
                                <span className="hidden rounded-full border px-2 py-1">
                                  {"חיוב ללקוח:"} {formatCurrency(billableAmount)}
                                </span>
                                </>
                              ) : null}
                            </div>
                            {sessionEditErrorId === session.id && sessionEditError ? (
                              <div className="mt-2 text-sm text-destructive">{sessionEditError}</div>
                            ) : null}
                            {deletingSessionId === session.id ? (
                              <div className="mt-2 text-sm text-muted-foreground">{"מוחק..."}</div>
                            ) : null}
                            {deleteSessionErrorId === session.id && deleteSessionError ? (
                              <div className="mt-2 text-sm text-destructive">{deleteSessionError}</div>
                            ) : null}
                            {session.notes ? <div className="mt-3 text-muted-foreground">{session.notes}</div> : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div> : null}

                {canViewSalary && isEditing ? (
                  <div className="rounded-2xl border p-4">
                    <div className="mb-3 text-base font-semibold">{"משכורת חדשה"}</div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <Field label="סוג שכר">
                        <NativeSelect
                          value={formState.salary_type}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              salary_type: event.target.value as "hourly" | "monthly",
                            }))
                          }
                        >
                          <option value="monthly">{"גלובלי"}</option>
                          <option value="hourly">{"שעתי"}</option>
                        </NativeSelect>
                      </Field>
                      <Field label="בתוקף מ">
                        <DateInput
                          value={formState.valid_from}
                          onChange={(event) =>
                            setFormState((current) => ({ ...current, valid_from: event.target.value }))
                          }
                        />
                      </Field>
                      <Field label="שעות תקן יומיות">
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          value={formState.standard_daily_hours}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              standard_daily_hours: event.target.value,
                            }))
                          }
                        />
                        {!standardDailyHoursValid ? (
                          <div className="mt-1 text-xs text-destructive">יש להזין ערך גדול מ-0 לפני שמירה.</div>
                        ) : null}
                      </Field>
                      <Field label="תעריף שעות נוספות">
                        <CurrencyInput
                          value={formState.overtime_rate}
                          onChange={(event) =>
                            setFormState((current) => ({ ...current, overtime_rate: event.target.value }))
                          }
                          placeholder="למשל 85"
                        />
                      </Field>
                      {formState.salary_type === "hourly" ? (
                        <Field label="תעריף שעתי">
                          <CurrencyInput
                            value={formState.hourly_rate}
                            onChange={(event) =>
                              setFormState((current) => ({ ...current, hourly_rate: event.target.value }))
                            }
                            placeholder="למשל 55"
                          />
                        </Field>
                      ) : (
                        <Field label="שכר חודשי">
                          <CurrencyInput
                            value={formState.monthly_salary}
                            onChange={(event) =>
                              setFormState((current) => ({ ...current, monthly_salary: event.target.value }))
                            }
                            placeholder="למשל 12000"
                          />
                        </Field>
                      )}
                      <Field label="הערות">
                        <Input
                          value={formState.notes}
                          onChange={(event) =>
                            setFormState((current) => ({ ...current, notes: event.target.value }))
                          }
                          placeholder="הערת מנהל"
                        />
                      </Field>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button disabled={isPending || !standardDailyHoursValid} onClick={() => void saveAgreement(user.id)}>
                        {"שמירת המשכורת"}
                      </Button>
                      <Button variant="outline" onClick={() => setEditingUserId("")}>
                        {"ביטול"}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {canViewSalary && isExpanded ? <div className="space-y-2">
                  <div className="text-sm font-semibold">{"היסטוריית שכר"}</div>
                  {userAgreements.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{"אין משכורות קודמות."}</div>
                  ) : (
                    userAgreements.map((agreement) => (
                      <div key={agreement.id} className="rounded-2xl border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">{getSalaryTypeLabel(agreement.salary_type)}</div>
                          <div className="font-semibold">
                            {agreement.salary_type === "hourly"
                              ? `${formatCurrency(agreement.hourly_rate)} לשעה`
                              : formatCurrency(agreement.monthly_salary)}
                          </div>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {formatDate(agreement.valid_from)} - {formatDate(agreement.valid_to)} | {"שעות תקן:"}{" "}
                          {agreement.standard_daily_hours ?? "-"}
                        </div>
                        {agreement.notes ? <div className="mt-1">{agreement.notes}</div> : null}
                      </div>
                    ))
                  )}
                </div> : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <FormDialog
        open={createUserOpen}
        onOpenChange={(open) => {
          setCreateUserOpen(open);
          if (!open) resetCreateUserForm();
        }}
        title="הוספת עובד מתוך המערכת"
        description="העובד יתווסף למרכז השכר ויהיה זמין להגדרת שכר ולעבודה שוטפת."
        onSubmit={() => void createUser()}
        submitLabel="שמירת עובד"
        busyLabel="שומר..."
        busy={isPending}
        error={createUserError || undefined}
      >
          <div className="space-y-3">
            <Field label="שם מלא">
              <Input
                value={createUserForm.full_name}
                onChange={(event) =>
                  setCreateUserForm((current) => ({ ...current, full_name: event.target.value }))
                }
                placeholder="למשל ישראל ישראלי"
              />
            </Field>
            <Field label="אימייל">
              <Input
                type="email"
                value={createUserForm.email}
                onChange={(event) =>
                  setCreateUserForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </Field>
            <Field label="טלפון">
              <Input
                value={createUserForm.phone}
                onChange={(event) =>
                  setCreateUserForm((current) => ({ ...current, phone: event.target.value }))
                }
                placeholder="אופציונלי"
              />
            </Field>
            <Field label="סיסמה">
              <Input
                type="password"
                value={createUserForm.password}
                onChange={(event) =>
                  setCreateUserForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="יצירת סיסמה לעובד"
              />
            </Field>
            <Field label="סוג גישה">
              <NativeSelect
                value={createUserForm.role}
                onChange={(event) =>
                  setCreateUserForm((current) => ({
                    ...current,
                    role: event.target.value as "worker" | "worker_no_access",
                  }))
                }
              >
                <option value="worker">עובד</option>
                <option value="worker_no_access">עובד ללא גישה</option>
              </NativeSelect>
            </Field>
            <div className="text-xs text-muted-foreground">
              {"המסך הזה יוצר גם חשבון התחברות וגם את רשומת העובד, כך שאפשר להוסיף עובד ישירות מתוך מערכת השכר."}
            </div>
          </div>
      </FormDialog>

      <FormDialog
        open={createSessionOpen}
        onOpenChange={(next) => {
          if (!next) {
            clearDraft("session-create");
            resetCreateSessionForm();
          }
          setCreateSessionOpen(next);
        }}
        title="הוספת משמרת ידנית"
        description="מנהל או משרד יכולים להוסיף משמרת לעובד ולבחור איפה הוא עבד, בלי לבקש ממנו להיכנס או להזין סיסמה."
        size="form2xl"
        onSubmit={() => void createSession()}
        submitLabel="שמירת משמרת"
        busyLabel="שומר..."
        busy={isPending}
        error={createSessionError || undefined}
      >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="עובד">
              <NativeSelect
                value={createSessionForm.user_id}
                onChange={(event) =>
                  setCreateSessionForm((current) => ({ ...current, user_id: event.target.value }))
                }
              >
                <option value="">בחירה</option>
                {sessionAssignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name ?? user.email ?? "עובד"}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="תחום">
              <DomainSelect
                domains={WORK_SESSION_BUSINESS_DOMAINS}
                value={createSessionForm.business_domain}
                onChange={(value) =>
                  setCreateSessionForm((current) => ({
                    ...current,
                    business_domain: value,
                    project_id: value === "logistics_projects" ? current.project_id : "",
                    property_id: value === "property_management" ? current.property_id : "",
                  }))
                }
              />
            </Field>
            <div className="md:col-span-2 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="שעת התחלה">
                <DateTimeInput
                  value={createSessionForm.clock_in}
                  onChange={(event) =>
                    setCreateSessionForm((current) => ({ ...current, clock_in: event.target.value }))
                  }
                />
              </Field>
              <Field label="סה״כ שעות">
                <Input
                  inputMode="decimal"
                  value={createSessionDurationHours}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    if (!nextValue.trim()) {
                      setCreateSessionForm((current) => ({ ...current, clock_out: "" }));
                      return;
                    }
                    const parsedHours = Number(nextValue);
                    const start = new Date(createSessionForm.clock_in).getTime();
                    if (!Number.isFinite(parsedHours) || parsedHours <= 0 || !Number.isFinite(start)) return;
                    const nextClockOut = new Date(start + parsedHours * 60 * 60 * 1000);
                    if (Number.isNaN(nextClockOut.getTime())) return;
                    setCreateSessionForm((current) => ({ ...current, clock_out: toDateTimeLocalValue(nextClockOut) }));
                  }}
                  placeholder="למשל 8"
                />
              </Field>
              <Field label="שעת סיום">
                <DateTimeInput
                  value={createSessionForm.clock_out}
                  onChange={(event) =>
                    setCreateSessionForm((current) => ({ ...current, clock_out: event.target.value }))
                  }
                />
              </Field>
            </div>
            {createSessionForm.business_domain === "logistics_projects" ? (
              <Field label="פרויקט">
                <NativeSelect
                  value={createSessionForm.project_id}
                  onChange={(event) =>
                    setCreateSessionForm((current) => ({ ...current, project_id: event.target.value }))
                  }
                >
                  <option value="">בחירה</option>
                  {projectOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            {createSessionForm.business_domain === "property_management" ? (
              <Field label="נכס">
                <NativeSelect
                  value={createSessionForm.property_id}
                  onChange={(event) =>
                    setCreateSessionForm((current) => ({ ...current, property_id: event.target.value }))
                  }
                >
                  <option value="">בחירה</option>
                  {propertyOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            {canViewSalary ? (
              <Field label="עלות לעובד">
                <CurrencyInput
                  inputMode="decimal"
                  value={createSessionForm.labor_cost}
                  onChange={(event) =>
                    setCreateSessionForm((current) => ({ ...current, labor_cost: event.target.value }))
                  }
                  placeholder="אופציונלי"
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  {createSessionSuggestedAmount !== null
                    ? `סה״כ לתשלום עבור המשמרת: ${formatCurrency(createSessionSuggestedAmount)}`
                    : "הסכום שמגיע לעובד יוצג כאן אחרי הזנת שעות תקינות או עלות עבודה."}
                </div>
              </Field>
            ) : null}
            {createSessionForm.business_domain === "logistics_projects" ? (
              <div className="md:col-span-2 space-y-3 rounded-xl border bg-muted/30 p-4">
                <div className="text-sm font-semibold">חיוב הלקוח</div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={createSessionForm.is_billable_to_customer}
                    onChange={(event) =>
                      setCreateSessionForm((current) => ({
                        ...current,
                        is_billable_to_customer: event.target.checked,
                        bill_to_customer_amount: event.target.checked ? current.bill_to_customer_amount : "",
                      }))
                    }
                  />
                  <span>לחיוב לקוח</span>
                </label>
                {createSessionForm.is_billable_to_customer ? (
                  <Field label="סכום לחיוב לקוח">
                    <CurrencyInput
                      inputMode="decimal"
                      value={createSessionForm.bill_to_customer_amount}
                      onChange={(event) =>
                        setCreateSessionForm((current) => ({ ...current, bill_to_customer_amount: event.target.value }))
                      }
                      placeholder="למשל 650"
                    />
                  </Field>
                ) : null}
              </div>
            ) : null}
            <div className="md:col-span-2">
              <Field label="הערות">
                <Input
                  value={createSessionForm.notes}
                  onChange={(event) =>
                    setCreateSessionForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  placeholder="אופציונלי"
                />
              </Field>
            </div>
            <div className="md:col-span-2 text-xs text-muted-foreground">
              {`משך: ${formatMinutes(createSessionWorkedMinutes)}`}
            </div>
          </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(pendingSessionEditConfirm)}
        onOpenChange={(open) => {
          if (!open) cancelSessionFieldEdit();
        }}
        title="אישור עדכון משמרת"
        description="השינוי יישמר רק אחרי אישור."
        confirmLabel="אישור"
        loading={isPending}
        onConfirm={() => void confirmSessionCostChange()}
      >
          <div className="space-y-3 text-right">
            <div className="rounded-xl border p-3 text-sm">
              <div className="text-muted-foreground">{"סכום קודם"}</div>
              <div className="mt-1 font-semibold">
                {pendingSessionEditConfirm?.field === "worked_minutes"
                  ? formatMinutes(pendingSessionEditConfirm?.oldValue ?? 0)
                  : formatCurrency(pendingSessionEditConfirm?.oldValue ?? 0)}
              </div>
            </div>
            <div className="rounded-xl border p-3 text-sm">
              <div className="text-muted-foreground">{"סכום חדש"}</div>
              <div className="mt-1 font-semibold">
                {pendingSessionEditConfirm?.field === "worked_minutes"
                  ? formatMinutes(pendingSessionEditConfirm?.newValue ?? 0)
                  : formatCurrency(pendingSessionEditConfirm?.newValue ?? 0)}
              </div>
            </div>
          </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(pendingDeletion)}
        onOpenChange={(open) => {
          if (!open) setPendingDeletion(null);
        }}
        destructive
        title="מחיקת משמרת"
        description="הפעולה תמחק את המשמרת מרישומי הפרויקט והשכר."
        confirmLabel="מחיקה"
        loading={Boolean(deletingSessionId)}
        onConfirm={() => void confirmDeleteSession()}
      >
          <div className="space-y-2 text-right text-sm">
            <div>
              למחוק את המשמרת של{" "}
              <span className="font-medium">
                {usersById.get(pendingDeletion?.session.user_id ?? "")?.full_name ??
                  usersById.get(pendingDeletion?.session.user_id ?? "")?.email ??
                  "העובד"}
              </span>
              ?
            </div>
            <div className="text-muted-foreground">
              {pendingDeletion?.session.clock_in ? formatDateTime(pendingDeletion.session.clock_in) : ""}
            </div>
          </div>
      </ConfirmDialog>
    </div>
  );
}

function reorderIds(ids: string[], sourceId: string, targetId: string) {
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return ids;
  }

  const next = [...ids];
  const [movedId] = next.splice(sourceIndex, 1);
  const insertIndex = next.indexOf(targetId);
  next.splice(insertIndex, 0, movedId);
  return next;
}

function getSessionFieldNumericValue(session: WorkSessionRow, field: EditableSessionField) {
  if (field === "worked_minutes") return sessionWorkedMinutes(session);
  if (field === "bill_to_customer_amount") return Math.max(0, toNumber(session.bill_to_customer_amount));
  return Math.max(0, toNumber(session.labor_cost));
}

function getSessionFieldValidationMessage(field: EditableSessionField) {
  if (field === "worked_minutes") {
    return "יש להזין זמן תקין גדול מ-0.";
  }
  if (field === "bill_to_customer_amount") {
    return "יש להזין חיוב תקין גדול מ-0.";
  }
  return "יש להזין סכום תקין גדול מ-0.";
}

function getSessionFieldUpdateErrorMessage(field: EditableSessionField) {
  if (field === "worked_minutes") {
    return "עדכון הזמן נכשל.";
  }
  if (field === "bill_to_customer_amount") {
    return "עדכון החיוב ללקוח נכשל.";
  }
  return "עדכון עלות העובד נכשל.";
}

function parseSessionFieldInput(field: EditableSessionField, rawValue: string) {
  if (field === "worked_minutes") return parseDurationInput(rawValue);
  const parsed = Number(rawValue.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDurationInput(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function parseDurationInput(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  if (trimmed.includes(":")) {
    const [hoursPart, minutesPart] = trimmed.split(":");
    const hours = Number(hoursPart.trim());
    const minutes = Number(minutesPart.trim());
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes >= 60) {
      return null;
    }
    return hours * 60 + minutes;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function addMinutesToIso(startIso: string | null | undefined, minutes: number) {
  const start = startIso ? new Date(startIso) : null;
  if (!start || Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + minutes * 60_000).toISOString();
}

function toDateTimeLocalValue(date: Date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <div className="font-medium">{label}</div>
      {children}
    </label>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function getSessionWorkLabel(
  session: WorkSessionRow,
  projectLabelsById: Map<string, string>,
  propertyLabelsById: Map<string, string>
) {
  if (session.business_domain === "logistics_projects" && session.project_id) {
    return projectLabelsById.get(session.project_id) ?? "פרויקט";
  }
  if (session.business_domain === "property_management" && session.property_id) {
    return propertyLabelsById.get(session.property_id) ?? "נכס";
  }
  if (session.business_domain === "sales") return "מכירות";
  if (session.business_domain === "home") return "בית";
  if (session.business_domain === "charity") return "צדקה";
  return "עבודה שוטפת";
}

function getRoleLabel(value: string | null | undefined) {
  if (value === "admin") return "מנהל";
  if (value === "office") return "משרד";
  if (value === "worker") return "עובד";
  if (value === "worker_no_access") return "עובד ללא גישה";
  return value || "-";
}

