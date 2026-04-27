"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, GripVertical, Trash2 } from "lucide-react";
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
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMinutes,
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

const DEFAULT_FORM: FormState = {
  salary_type: "monthly",
  hourly_rate: "",
  monthly_salary: "",
  valid_from: new Date().toISOString().slice(0, 10),
  overtime_rate: "",
  standard_daily_hours: "8",
  notes: "",
};

export default function PayrollAdminClient({
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
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM);
  const sessionCostDrafts = sessionLaborCostDrafts;
  const setSessionCostDrafts = setSessionLaborCostDrafts;
  const setSessionCostError = setSessionEditError;
  const setSessionCostErrorId = setSessionEditErrorId;
  const pendingSessionCostConfirm = pendingSessionEditConfirm;
  const setPendingSessionCostConfirm = setPendingSessionEditConfirm;

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
          setUnlockError(json.error ?? "פתיחת מרכז השכר נכשלה.");
          return;
        }
        setPassword("");
        router.refresh();
      } catch (error: unknown) {
        setUnlockError(error instanceof Error ? error.message : "Unknown error");
      }
    });
  }

  async function lockCenter() {
    startTransition(async () => {
      await fetch("/api/payroll/admin/lock", { method: "POST" });
      router.refresh();
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
        : "8",
      notes: "",
    });
  }

  async function saveAgreement(userId: string) {
    setSaveError("");
    setSaveMessage("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/payroll/salary-agreements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_id: userId, ...formState }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setSaveError(json.error ?? "שמירת הסכם השכר נכשלה.");
          return;
        }
        setSaveMessage("הסכם השכר נשמר בהצלחה.");
        setEditingUserId("");
        setFormState(DEFAULT_FORM);
        router.refresh();
      } catch (error: unknown) {
        setSaveError(error instanceof Error ? error.message : "Unknown error");
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

  async function saveSessionCost(session: WorkSessionRow) {
    await saveSessionField(session, "labor_cost");
    return;
    const laborCost = Number(
      (sessionCostDrafts[session.id] ?? String(Math.max(0, toNumber(session.labor_cost)))).trim()
    );
    if (!Number.isFinite(laborCost) || laborCost <= 0) {
      setSessionCostError("יש להזין סכום תקין גדול מ-0.");
      return;
    }

    setSessionCostError("");
    setSessionCostErrorId("");
    const oldValue = Math.max(0, toNumber(session.labor_cost));
    if (laborCost === oldValue) {
      setSessionCostDrafts((current) => ({ ...current, [session.id]: String(oldValue) }));
      return;
    }
    setPendingSessionCostConfirm({
      session,
      oldValue,
      newValue: laborCost,
    });
    return;
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
            clock_out: session.clock_out,
            labor_cost: laborCost,
            is_billable_to_customer: session.is_billable_to_customer === true,
            bill_to_customer_amount: session.bill_to_customer_amount,
            billing_status: session.billing_status,
          }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setSessionCostError(json.error ?? "עדכון עלות העובד נכשל.");
          return;
        }
        cancelEditingSessionCost();
        router.refresh();
      } catch (error: unknown) {
        setSessionCostError(error instanceof Error ? error.message : "Unknown error");
      }
    });
  }

  async function confirmSessionCostChange() {
    await confirmSessionFieldChange();
    return;
    const pending = pendingSessionCostConfirm;
    if (!pending) return;

    const { session, newValue } = pending;
    setSessionCostError("");
    setSessionCostErrorId("");
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
            clock_out: session.clock_out,
            labor_cost: newValue,
            is_billable_to_customer: session.is_billable_to_customer === true,
            bill_to_customer_amount: session.bill_to_customer_amount,
            billing_status: session.billing_status,
          }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setSessionCostErrorId(session.id);
          setSessionCostError(json.error ?? "עדכון עלות העובד נכשל.");
          return;
        }
        setSessionCostDrafts((current) => ({
          ...current,
          [session.id]: String(newValue),
        }));
        setPendingSessionCostConfirm(null);
        router.refresh();
      } catch (error: unknown) {
        setSessionCostErrorId(session.id);
        setSessionCostError(error instanceof Error ? error.message : "Unknown error");
      }
    });
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
    const laborCost = field === "labor_cost" ? newValue : Math.max(0, toNumber(session.labor_cost));
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
          setSessionEditError(json.error ?? getSessionFieldUpdateErrorMessage(field));
          return;
        }
        syncSessionDraftValue(session, field, newValue);
        setPendingSessionEditConfirm(null);
        router.refresh();
      } catch (error: unknown) {
        setSessionEditErrorId(session.id);
        setSessionEditError(error instanceof Error ? error.message : "Unknown error");
      }
    });
  }

  async function deleteSession(session: WorkSessionRow) {
    if (deletingSessionId) return;
    const confirmed = window.confirm("למחוק את המשמרת הזאת לגמרי?");
    if (!confirmed) return;

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
          setDeleteSessionError(json.error ?? "מחיקת המשמרת נכשלה.");
          return;
        }
        if (pendingSessionCostConfirm?.session.id === session.id) {
          setPendingSessionCostConfirm(null);
        }
        setSessionCostDrafts((current) => {
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
        router.refresh();
      } catch (error: unknown) {
        setDeleteSessionErrorId(session.id);
        setDeleteSessionError(error instanceof Error ? error.message : "Unknown error");
      } finally {
        setDeletingSessionId("");
      }
    });
  }

  if (!hasPasswordConfigured) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <div className="text-lg font-semibold">{"הגדרת סיסמת מנהל חסרה"}</div>
          <div className="text-sm text-muted-foreground">
            {"כדי להשתמש במרכז השכר צריך להגדיר בשרת את `PAYROLL_ADMIN_PASSWORD`."}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!unlocked) {
    return (
      <Card>
        <CardContent className="space-y-4 py-6">
          <div>
            <div className="text-lg font-semibold">{"פתיחת מרכז השכר"}</div>
            <div className="text-sm text-muted-foreground">
              {"רק מנהל עם סיסמת השכר יכול לצפות ולעדכן את נתוני השכר של כל העובדים."}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_140px]">
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
    );
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
        <Button variant="outline" onClick={() => void lockCenter()} disabled={isPending}>
          {"נעילת מרכז השכר"}
        </Button>
      </div>

      {saveError ? <div className="text-sm text-destructive">{saveError}</div> : null}
      {saveMessage ? <div className="text-sm text-emerald-700">{saveMessage}</div> : null}

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
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <div className="min-w-0 flex-1">
                    <div className="text-lg font-semibold">{user.full_name ?? user.email ?? "עובד"}</div>
                    <div className="text-sm text-muted-foreground">
                      {user.email ?? "-"} | {user.phone ?? "-"} | {"תפקיד:"} {getRoleLabel(user.role)}
                    </div>
                  </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        openFormForUser(user.id, currentAgreement);
                      }}
                    >
                      {"עדכון שכר"}
                    </Button>
                    <div className="flex items-center text-muted-foreground">
                      <ChevronDown
                        className={`h-5 w-5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </div>
                  </div>
                </div>

                {isExpanded ? <div className="grid gap-3 lg:grid-cols-5">
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
                  <MiniStat label={"סה\"כ שעות"} value={formatMinutes(totalWorkedMinutes)} />
                  <MiniStat label="עלות עבודה" value={formatCurrency(totalLaborCost)} />
                  <MiniStat
                    label="תלוש אחרון"
                    value={latestPayslip ? formatCurrency(latestPayslip.gross_salary) : "-"}
                  />
                </div> : null}

                {isExpanded && latestPayslip && latestPeriod ? (
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
                        ? `${userSessions.length} משמרות | ${formatMinutes(totalWorkedMinutes)} | ${formatCurrency(totalLaborCost)}`
                        : "אין משמרות מדווחות"}
                    </div>
                  </div>
                  {userSessions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                      {"אין פירוט עבודה מדווח לעובד הזה כרגע."}
                    </div>
                  ) : (
                    <div className="grid gap-3 xl:grid-cols-2">
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
                              <Trash2 className="h-4 w-4" />
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
                                <div className="font-semibold">{formatCurrency(laborCost)}</div>
                                <div className="text-xs text-muted-foreground">{formatMinutes(workedMinutes)}</div>
                                {false ? <Input
                                    inputMode="decimal"
                                    value={sessionCostValue}
                                    onFocus={() => startEditingSessionCost(session)}
                                    onChange={(event) =>
                                      setSessionCostDrafts((current) => ({
                                        ...current,
                                        [session.id]: event.target.value,
                                      }))
                                    }
                                    onBlur={() => void saveSessionCost(session)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void saveSessionCost(session);
                                      }
                                    }}
                                    placeholder="עלות לעובד"
                                  /> : null}
                              </div>
                            </div>
                            <div className="mt-3 text-muted-foreground">
                              {formatDateTime(session.clock_in)}{" "}
                              {session.clock_out ? `- ${formatDateTime(session.clock_out)}` : "- פתוח"}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
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

                {isEditing ? (
                  <div className="rounded-2xl border p-4">
                    <div className="mb-3 text-base font-semibold">{"הסכם שכר חדש"}</div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <Field label="סוג שכר">
                        <select
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
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
                        </select>
                      </Field>
                      <Field label="בתוקף מ">
                        <Input
                          type="date"
                          value={formState.valid_from}
                          onChange={(event) =>
                            setFormState((current) => ({ ...current, valid_from: event.target.value }))
                          }
                        />
                      </Field>
                      <Field label="שעות תקן יומיות">
                        <Input
                          value={formState.standard_daily_hours}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              standard_daily_hours: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="תעריף שעות נוספות">
                        <Input
                          value={formState.overtime_rate}
                          onChange={(event) =>
                            setFormState((current) => ({ ...current, overtime_rate: event.target.value }))
                          }
                          placeholder="למשל 85"
                        />
                      </Field>
                      {formState.salary_type === "hourly" ? (
                        <Field label="תעריף שעתי">
                          <Input
                            value={formState.hourly_rate}
                            onChange={(event) =>
                              setFormState((current) => ({ ...current, hourly_rate: event.target.value }))
                            }
                            placeholder="למשל 55"
                          />
                        </Field>
                      ) : (
                        <Field label="שכר חודשי">
                          <Input
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
                      <Button disabled={isPending} onClick={() => void saveAgreement(user.id)}>
                        {"שמירת ההסכם"}
                      </Button>
                      <Button variant="outline" onClick={() => setEditingUserId("")}>
                        {"ביטול"}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {isExpanded ? <div className="space-y-2">
                  <div className="text-sm font-semibold">{"היסטוריית שכר"}</div>
                  {userAgreements.length === 0 ? (
                    <div className="text-sm text-muted-foreground">{"אין הסכמי שכר קודמים."}</div>
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

      <Dialog
        open={Boolean(pendingSessionEditConfirm)}
        onOpenChange={(open) => {
          if (!open) cancelSessionFieldEdit();
        }}
      >
        <DialogContent dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle>{"אישור עדכון סכום לעובד"}</DialogTitle>
            <DialogDescription>
              {"השינוי יישמר רק אחרי אישור."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-right">
            <div className="rounded-xl border p-3 text-sm">
              <div className="text-muted-foreground">{"סכום קודם"}</div>
              <div className="mt-1 font-semibold">
                {formatCurrency(pendingSessionCostConfirm?.oldValue ?? 0)}
              </div>
            </div>
            <div className="rounded-xl border p-3 text-sm">
              <div className="text-muted-foreground">{"סכום חדש"}</div>
              <div className="mt-1 font-semibold">
                {formatCurrency(pendingSessionCostConfirm?.newValue ?? 0)}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => cancelEditingSessionCost()}>
              {"ביטול"}
            </Button>
            <Button disabled={isPending} onClick={() => void confirmSessionCostChange()}>
              {"אישור"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  return "עבודה כללית";
}

function getBusinessDomainLabel(value: string | null | undefined) {
  if (value === "general_business") return "כללי";
  if (value === "property_management") return "ניהול נכסים";
  if (value === "sales") return "מכירות";
  if (value === "logistics_projects") return "פרויקטים";
  if (value === "home") return "בית";
  if (value === "charity") return "צדקה";
  return value || "כללי";
}

function getRoleLabel(value: string | null | undefined) {
  if (value === "admin") return "מנהל";
  if (value === "office") return "משרד";
  if (value === "worker") return "עובד";
  if (value === "worker_no_access") return "עובד ללא גישה";
  return value || "-";
}
