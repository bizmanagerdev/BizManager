"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Car, Loader2 } from "lucide-react";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { TagPicker, fetchExistingTagIds } from "@/components/tags/TagPicker";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_WORKER_WAGE_CATEGORY,
  EXPENSE_OTHER_CATEGORY,
  EXPENSE_CARS_CATEGORY,
  DEFAULT_EXPENSE_CATEGORY,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { offlineFetch } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_OPTIONS, type FinancialAttachment } from "@/lib/payments";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import {
  calculateSessionLaborCost,
  getActiveSalaryAgreementForDate,
  type SalaryAgreementRow,
} from "@/lib/payroll";
import { shouldShowSessionHours, shouldShowSessionPrice, type PayrollWorkerType } from "@/lib/payroll-worker-type";
import type { UserRole } from "@/lib/auth/requireProfile";

type PaymentStatus = "paid" | "partial" | "not_paid";
type PaymentChoice = "none" | "paid" | "partial";

// Category picklist comes from lib/expenses (shared by every expense form).
// "שכר עובד" only appears when worker-session support is wired (see `users` prop)
// and turns the form into a worker-session creator.
const WORKER_WAGE_CATEGORY = EXPENSE_WORKER_WAGE_CATEGORY;
const OTHER_CATEGORY = EXPENSE_OTHER_CATEGORY;
const CARS_CATEGORY = EXPENSE_CARS_CATEGORY;
const BASE_EXPENSE_CATEGORIES = [...EXPENSE_CATEGORY_OPTIONS];
const KNOWN_CATEGORIES = new Set([WORKER_WAGE_CATEGORY, ...BASE_EXPENSE_CATEGORIES]);

export type ExpenseWorkerOption = {
  id: string;
  label: string;
  role?: UserRole;
  payroll_worker_type?: PayrollWorkerType | null;
  pay_tracking_mode?: string | null;
};

export type EditingExpenseData = {
  id: string;
  amount: number | string;
  category: string | null;
  description?: string | null;
  notes?: string | null;
  expense_date: string | null;
  business_domain: string | null;
  payment_status?: string | null;
  paid_amount?: number | string | null;
  payment_method?: string | null;
  account_id?: string | null;
  project_id?: string | null;
  order_id?: string | null;
  property_id?: string | null;
  billed_to_customer?: boolean | null;
  included_in_base_price?: boolean | null;
  attachments?: FinancialAttachment[];
};

export type ExpenseDialogSavedData = {
  expenseId: string;
  expense: Record<string, unknown>;
  projectExpense: Record<string, unknown> | null;
  attachments: FinancialAttachment[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  // Edit mode — provide existing expense data
  editingExpense?: EditingExpenseData | null;
  // Label shown in the source info banner when editing
  editingSourceLabel?: string | null;

  // Lock to a specific source (project/order/property context)
  lockedProjectId?: string | null;
  lockedOrderId?: string | null;
  lockedPropertyId?: string | null;

  // Selectors shown when the source is not locked
  recurringProjects?: Array<{ id: string; label: string }>;
  recurringOrders?: Array<{ id: string; label: string }>;
  recurringProperties?: Array<{ id: string; label: string }>;

  // Attachment support
  showAttachments?: boolean;

  // Default category for a NEW expense (e.g. "רכבים" from a car's page).
  defaultCategory?: string;
  // Pre-select tags (e.g. a vehicle) for a NEW expense.
  presetTagIds?: string[];
  // When set, the expense is locked to this tag (e.g. opened from a car's page):
  // show a read-only "linked to car X" banner instead of the editable picker.
  presetTagLabel?: string;

  // ── Worker-session support (opt-in) ───────────────────────────────────────
  // When `users` is provided, the category list gains "שכר עובד", which turns
  // this dialog into a worker-session creator (clock in/out, labor cost, inline
  // new worker, worker payment) instead of recording a plain expense.
  users?: ExpenseWorkerOption[];
  salaryAgreements?: SalaryAgreementRow[];
  currentUserId?: string;
  currentUserRole?: UserRole;

  onSaved: (data: ExpenseDialogSavedData) => void | Promise<void>;
};

function normalizePaymentStatus(value: string | null | undefined): PaymentStatus {
  if (value === "paid" || value === "partial" || value === "not_paid") return value;
  return "not_paid";
}

function paymentStatusLabel(s: PaymentStatus) {
  if (s === "paid") return "שולם";
  if (s === "partial") return "חלקית";
  return "לא שולם";
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function durationHours(clockIn: string, clockOut: string) {
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "";
  const hours = (end - start) / 3600000;
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

function formatIls(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
}

async function uploadAttachment(
  entityType: "expense" | "session",
  entityId: string,
  file: File
): Promise<FinancialAttachment | null> {
  const form = new FormData();
  form.set("entity_type", entityType);
  form.set("entity_id", entityId);
  form.set("file", file);
  const res = await fetch("/api/financial-attachments/upload", { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "העלאת הקובץ נכשלה.");
  return (json?.attachment ?? null) as FinancialAttachment | null;
}

export function ExpenseDialog({
  open,
  onOpenChange,
  editingExpense,
  editingSourceLabel,
  lockedProjectId,
  lockedOrderId,
  lockedPropertyId,
  recurringProjects = [],
  recurringOrders = [],
  recurringProperties = [],
  showAttachments = false,
  defaultCategory,
  presetTagIds,
  presetTagLabel,
  users,
  salaryAgreements = [],
  currentUserId,
  currentUserRole,
  onSaved,
}: Props) {
  const isEditing = Boolean(editingExpense);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [businessDomain, setBusinessDomain] = useState<ExpenseBusinessDomain | "">("");
  const [projectId, setProjectId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("not_paid");
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [category, setCategory] = useState(DEFAULT_EXPENSE_CATEGORY);
  const [categoryOther, setCategoryOther] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [includedInBasePrice, setIncludedInBasePrice] = useState(false);
  const [billedToCustomer, setBilledToCustomer] = useState(false);
  const [billToCustomerAmount, setBillToCustomerAmount] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<FinancialAttachment[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);

  // Worker-session state (only used when the worker category is selected).
  const [localUsers, setLocalUsers] = useState<ExpenseWorkerOption[]>(users ?? []);
  const [workerUserId, setWorkerUserId] = useState("");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [laborCost, setLaborCost] = useState("");
  const [workerPaymentChoice, setWorkerPaymentChoice] = useState<PaymentChoice>("none");
  const [workerPaidAmount, setWorkerPaidAmount] = useState("");
  const [workerAccountId, setWorkerAccountId] = useState("");
  const [newWorkerOpen, setNewWorkerOpen] = useState(false);
  const [newWorkerSubmitting, setNewWorkerSubmitting] = useState(false);
  const [newWorkerError, setNewWorkerError] = useState<string | null>(null);
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerPhone, setNewWorkerPhone] = useState("");

  useEffect(() => {
    if (Array.isArray(users)) setLocalUsers(users);
  }, [users]);

  const workerSupport = Array.isArray(users);
  const categoryOptions = workerSupport ? [WORKER_WAGE_CATEGORY, ...BASE_EXPENSE_CATEGORIES] : BASE_EXPENSE_CATEGORIES;
  const finalCategory = category === OTHER_CATEGORY ? categoryOther.trim() : category;
  const canManageWorkerSessions = currentUserRole === "admin" || currentUserRole === "office";
  const isWorkerPayment = workerSupport && category === WORKER_WAGE_CATEGORY;

  const lockedDomain: ExpenseBusinessDomain | null = lockedProjectId
    ? "logistics_projects"
    : lockedOrderId
      ? "sales"
      : lockedPropertyId
        ? "property_management"
        : null;
  const isSourceLocked = Boolean(lockedProjectId || lockedOrderId || lockedPropertyId);
  const effectiveDomain: ExpenseBusinessDomain | "" = lockedDomain ?? businessDomain;
  const effectiveProjectId = lockedProjectId ?? (effectiveDomain === "logistics_projects" ? projectId : "");
  const effectiveOrderId = lockedOrderId ?? (effectiveDomain === "sales" ? orderId : "");
  const effectivePropertyId = lockedPropertyId ?? (effectiveDomain === "property_management" ? propertyId : "");
  const showBillingOptions = Boolean(effectiveProjectId);

  // Worker-session computed values.
  const targetUserId = canManageWorkerSessions ? workerUserId : currentUserId ?? "";
  const workerList = useMemo(
    () => localUsers.filter((u) => u.role === "worker" || u.role === "worker_no_access"),
    [localUsers]
  );
  const selectedWorkerType = useMemo<PayrollWorkerType | null>(() => {
    if (!targetUserId) return null;
    return localUsers.find((u) => u.id === targetUserId)?.payroll_worker_type ?? null;
  }, [localUsers, targetUserId]);
  const showSessionTimingFields = shouldShowSessionHours(selectedWorkerType);
  const showSessionPriceField = shouldShowSessionPrice(selectedWorkerType);
  const sessionDateOnly = useMemo(() => {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(clockIn);
    return match ? match[1] : new Date().toISOString().slice(0, 10);
  }, [clockIn]);
  const sessionDuration = useMemo(() => durationHours(clockIn, clockOut), [clockIn, clockOut]);
  const sessionWorkedMinutes = useMemo(() => {
    const start = new Date(clockIn).getTime();
    const end = new Date(clockOut).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.round((end - start) / 60000);
  }, [clockIn, clockOut]);
  const activeAgreement = useMemo(() => {
    if (!isWorkerPayment || !targetUserId) return null;
    const ref = toIso(clockIn);
    if (!ref) return null;
    return getActiveSalaryAgreementForDate(
      salaryAgreements.filter((a) => a.user_id === targetUserId),
      new Date(ref)
    );
  }, [clockIn, isWorkerPayment, salaryAgreements, targetUserId]);
  const suggestedWorkerAmount = useMemo(() => {
    if (!isWorkerPayment) return null;
    if (laborCost.trim()) {
      const parsed = Number(laborCost);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (sessionWorkedMinutes <= 0) return null;
    return calculateSessionLaborCost(activeAgreement, sessionWorkedMinutes);
  }, [activeAgreement, isWorkerPayment, laborCost, sessionWorkedMinutes]);

  useEffect(() => {
    if (!open) return;
    if (editingExpense) {
      const raw = editingExpense.amount;
      setAmount(typeof raw === "number" ? String(raw) : raw ?? "");
      setExpenseDate(editingExpense.expense_date || todayIso());
      setPaymentStatus(normalizePaymentStatus(editingExpense.payment_status));
      const rawPaid = editingExpense.paid_amount;
      setPaidAmount(rawPaid != null ? String(rawPaid) : "");
      setPaymentMethod(typeof editingExpense.payment_method === "string" ? editingExpense.payment_method : "");
      setAccountId(typeof editingExpense.account_id === "string" ? editingExpense.account_id : "");
      const cat = editingExpense.category ?? "";
      if (cat && KNOWN_CATEGORIES.has(cat)) {
        setCategory(cat);
        setCategoryOther("");
      } else {
        setCategory(OTHER_CATEGORY);
        setCategoryOther(cat);
      }
      setDescription(editingExpense.description ?? "");
      setNotes(editingExpense.notes ?? "");
      setBilledToCustomer(Boolean(editingExpense.billed_to_customer));
      setIncludedInBasePrice(Boolean(editingExpense.included_in_base_price));
      const dom = editingExpense.business_domain;
      if (dom && (EXPENSE_BUSINESS_DOMAINS as readonly string[]).includes(dom)) {
        setBusinessDomain(dom as ExpenseBusinessDomain);
      }
      setExistingAttachments(
        Array.isArray(editingExpense.attachments) ? editingExpense.attachments : []
      );
      setTagIds([]);
      void fetchExistingTagIds("expense", editingExpense.id).then(setTagIds);
    } else {
      setAmount("");
      setExpenseDate(todayIso());
      setPaymentStatus("not_paid");
      setPaidAmount("");
      setPaymentMethod("");
      setAccountId("");
      setCategory(defaultCategory ?? DEFAULT_EXPENSE_CATEGORY);
      setCategoryOther("");
      setDescription("");
      setNotes("");
      setBusinessDomain(lockedDomain ?? "");
      setProjectId("");
      setOrderId("");
      setPropertyId("");
      setIncludedInBasePrice(false);
      setBilledToCustomer(false);
      setExistingAttachments([]);
      setTagIds(presetTagIds ?? []);
    }
    setBillToCustomerAmount("");
    setWorkerUserId("");
    setClockIn("");
    setClockOut("");
    setLaborCost("");
    setWorkerPaymentChoice("none");
    setWorkerAccountId("");
    setWorkerPaidAmount("");
    setNewWorkerOpen(false);
    setNewWorkerError(null);
    setNewWorkerName("");
    setNewWorkerPhone("");
    setAttachmentFiles([]);
    setErrorMessage("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Single-session workers have no real clock — normalize to a 09:00–10:00 stub.
  useEffect(() => {
    if (selectedWorkerType !== "session_only") return;
    const normIn = `${sessionDateOnly}T09:00`;
    const normOut = `${sessionDateOnly}T10:00`;
    if (clockIn !== normIn) setClockIn(normIn);
    if (clockOut !== normOut) setClockOut(normOut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkerType]);

  async function createWorker() {
    setNewWorkerError(null);
    const fullName = newWorkerName.trim();
    const phone = newWorkerPhone.trim();
    if (!fullName || !phone) {
      setNewWorkerError("יש למלא שם וטלפון לעובד החדש.");
      return;
    }
    setNewWorkerSubmitting(true);
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
      const created = json.user;
      if (!res.ok || !created?.id) {
        setNewWorkerError(toHebrewError(json.error, "שגיאה ביצירת עובד."));
        return;
      }
      const label = created.full_name?.trim() || created.email?.trim() || "עובד חדש";
      setLocalUsers((current) => [
        { id: created.id ?? "", label, role: created.role ?? "worker_no_access" },
        ...current.filter((u) => u.id !== created.id),
      ]);
      setWorkerUserId(created.id);
      setNewWorkerOpen(false);
      setNewWorkerName("");
      setNewWorkerPhone("");
      toast.success("העובד נוסף ונבחר.");
    } catch (error) {
      setNewWorkerError(toHebrewError(error, "שגיאה ביצירת עובד."));
    } finally {
      setNewWorkerSubmitting(false);
    }
  }

  async function submitWorkerSession() {
    if (!targetUserId) {
      setErrorMessage("יש לבחור עובד.");
      return;
    }
    const clockInIso = toIso(clockIn);
    const clockOutIso = toIso(clockOut);
    if (!clockInIso || !clockOutIso || new Date(clockOutIso) <= new Date(clockInIso)) {
      setErrorMessage("שעת הסיום חייבת להיות אחרי שעת ההתחלה.");
      return;
    }
    if (effectiveDomain === "logistics_projects" && !effectiveProjectId) {
      setErrorMessage("יש לבחור פרויקט לתחום פרויקטים.");
      return;
    }
    if (effectiveDomain === "property_management" && !effectivePropertyId) {
      setErrorMessage("יש לבחור נכס לתחום ניהול נכסים.");
      return;
    }
    const laborCostNumber = laborCost.trim() === "" ? null : Number(laborCost);
    if (laborCost.trim() !== "" && (laborCostNumber === null || !Number.isFinite(laborCostNumber) || laborCostNumber <= 0)) {
      setErrorMessage("יש להזין עלות עבודה תקינה.");
      return;
    }
    const workerPaidNumber =
      workerPaymentChoice === "none" || !workerPaidAmount.trim() ? suggestedWorkerAmount : Number(workerPaidAmount);
    if (
      canManageWorkerSessions &&
      workerPaymentChoice !== "none" &&
      (workerPaidNumber === null || !Number.isFinite(workerPaidNumber) || workerPaidNumber <= 0)
    ) {
      setErrorMessage("יש להזין סכום ששולם לעובד.");
      return;
    }
    if (workerPaymentChoice !== "none" && accountsList.length > 0 && !workerAccountId) {
      setErrorMessage("יש לבחור חשבון לתשלום לעובד.");
      return;
    }
    const billAmountNumber = !billedToCustomer || !billToCustomerAmount.trim() ? null : Number(billToCustomerAmount);
    if (billedToCustomer && (billAmountNumber === null || !Number.isFinite(billAmountNumber) || billAmountNumber <= 0)) {
      setErrorMessage("יש להזין סכום לחיוב לקוח.");
      return;
    }

    setSaving(true);
    try {
      const endpoint = canManageWorkerSessions ? "/api/payroll/sessions/create" : "/api/profile/session/create";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: targetUserId,
          business_domain: effectiveDomain,
          project_id: effectiveProjectId || null,
          property_id: effectivePropertyId || null,
          notes: notes.trim() || null,
          clock_in: clockInIso,
          clock_out: clockOutIso,
          labor_cost: laborCostNumber,
          is_billable_to_customer: billedToCustomer,
          bill_to_customer_amount: billedToCustomer ? billAmountNumber : null,
          billing_status: billedToCustomer ? "billable" : "not_billable",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        session?: { id?: string; user_id?: string; clock_in?: string; clock_out?: string };
      };
      if (!res.ok || !json.session) {
        setErrorMessage(toHebrewError(json.error, "שמירת המשמרת נכשלה."));
        return;
      }
      const sessionId = typeof json.session.id === "string" ? json.session.id : "";

      if (
        canManageWorkerSessions &&
        workerPaymentChoice !== "none" &&
        sessionId &&
        json.session.user_id &&
        workerPaidNumber !== null &&
        Number.isFinite(workerPaidNumber) &&
        workerPaidNumber > 0
      ) {
        const payDate = (json.session.clock_out || json.session.clock_in || new Date().toISOString()).slice(0, 10);
        const payRes = await fetch("/api/payroll/worker-payments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            user_id: json.session.user_id,
            payment_date: payDate,
            amount: workerPaidNumber,
            payment_method: null,
            account_id: workerAccountId || null,
            reference_number: null,
            notes: `תשלום שסומן מתוך טופס הוצאה עבור משמרת ${payDate}`,
            allocations: [{ source_type: "session", source_id: sessionId, amount: workerPaidNumber }],
          }),
        });
        if (!payRes.ok) {
          const payJson = (await payRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(toHebrewError(payJson.error, "שמירת התשלום לעובד נכשלה."));
        }
      }

      for (const file of attachmentFiles) {
        if (!sessionId) break;
        await uploadAttachment("session", sessionId, file);
      }

      toast.success(
        canManageWorkerSessions && workerPaymentChoice !== "none"
          ? "המשמרת נשמרה והתשלום לעובד נרשם."
          : "המשמרת נשמרה."
      );
      const savedResult = onSaved({ expenseId: "", expense: {}, projectExpense: null, attachments: [] });
      if (savedResult instanceof Promise) await savedResult;
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(toHebrewError(error, "שמירת המשמרת נכשלה."));
    } finally {
      setSaving(false);
    }
  }

  const handleSubmit = async () => {
    setErrorMessage("");
    if (!effectiveDomain) {
      setErrorMessage("יש לבחור תחום עסקי.");
      toast.error("יש לבחור תחום");
      return;
    }

    // Worker-payment category → create a work session instead of an expense.
    if (isWorkerPayment) {
      await submitWorkerSession();
      return;
    }

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setErrorMessage("יש להזין סכום תקין (גדול מאפס).");
      toast.error("יש להזין סכום תקין");
      return;
    }
    if (!expenseDate) {
      setErrorMessage("יש לבחור תאריך.");
      toast.error("יש לבחור תאריך");
      return;
    }
    if (!finalCategory) {
      setErrorMessage("יש להזין קטגוריה.");
      toast.error("יש להזין קטגוריה");
      return;
    }
    // When options are offered for a project/property domain, one must be chosen.
    if (!isEditing && effectiveDomain === "logistics_projects" && recurringProjects.length > 0 && !effectiveProjectId) {
      setErrorMessage("יש לבחור פרויקט.");
      toast.error("יש לבחור פרויקט");
      return;
    }
    if (!isEditing && effectiveDomain === "property_management" && recurringProperties.length > 0 && !effectivePropertyId) {
      setErrorMessage("יש לבחור נכס.");
      toast.error("יש לבחור נכס");
      return;
    }
    if ((paymentStatus === "paid" || paymentStatus === "partial") && accountsList.length > 0 && !accountId) {
      setErrorMessage("יש לבחור חשבון לתנועה.");
      toast.error("יש לבחור חשבון");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        project_id: effectiveProjectId || null,
        order_id: effectiveOrderId || null,
        property_id: effectivePropertyId || null,
        business_domain: effectiveDomain,
        amount: amountNumber,
        category: finalCategory,
        expense_date: expenseDate,
        description: description.trim() || null,
        notes: notes.trim() || null,
        included_in_base_price: showBillingOptions ? includedInBasePrice : false,
        billed_to_customer: showBillingOptions ? billedToCustomer : false,
        payment_status: paymentStatus,
        paid_amount: paymentStatus === "partial" ? (Number(paidAmount) || null) : null,
        payment_method: (paymentStatus === "paid" || paymentStatus === "partial") ? (paymentMethod || null) : null,
        account_id: accountId || null,
        tag_ids: tagIds,
      };

      let expenseId: string;
      let expenseData: Record<string, unknown>;
      let projectExpenseData: Record<string, unknown> | null = null;

      if (isEditing && editingExpense) {
        const result = await offlineFetch(
          "/api/expenses/update",
          { id: editingExpense.id, ...payload },
          "עדכון הוצאה"
        );
        if (!result.queued && !result.ok) {
          const hebrewMessage = toHebrewError(result.error, "עדכון ההוצאה נכשל.");
          setErrorMessage(hebrewMessage);
          toast.error("שגיאה בעדכון ההוצאה", { description: hebrewMessage });
          return;
        }
        const json = result.queued
          ? null
          : (result.data as {
              expense?: Record<string, unknown>;
              projectExpense?: Record<string, unknown>;
            } | null);
        expenseData = json?.expense ?? { id: editingExpense.id };
        expenseId = (expenseData.id as string) ?? editingExpense.id;
        projectExpenseData = json?.projectExpense ?? null;
        if (!result.queued) toast.success("ההוצאה עודכנה");
      } else {
        const result = await offlineFetch("/api/expenses/create", payload, "הוצאה חדשה", { idempotent: true });
        if (result.queued) {
          onOpenChange(false);
          onSaved({ expenseId: "", expense: {}, projectExpense: null, attachments: [] });
          return;
        }
        if (!result.ok) {
          const hebrewMessage = toHebrewError(result.error, "יצירת ההוצאה נכשלה.");
          setErrorMessage(hebrewMessage);
          toast.error("שגיאה ביצירת ההוצאה", { description: hebrewMessage });
          return;
        }
        const json = result.data as {
          expense?: Record<string, unknown>;
          projectExpense?: Record<string, unknown>;
        } | null;
        expenseData = json?.expense ?? {};
        expenseId = (expenseData.id as string) ?? "";
        projectExpenseData = json?.projectExpense ?? null;
        toast.success("ההוצאה נוספה");
      }

      const uploadedAttachments: FinancialAttachment[] = [];
      if (showAttachments && expenseId) {
        for (const file of attachmentFiles) {
          const att = await uploadAttachment("expense", expenseId, file);
          if (att) uploadedAttachments.push(att);
        }
      }

      const savedResult = onSaved({
        expenseId,
        expense: {
          ...expenseData,
          attachments: [...existingAttachments, ...uploadedAttachments],
        },
        projectExpense: projectExpenseData,
        attachments: [...existingAttachments, ...uploadedAttachments],
      });
      if (savedResult instanceof Promise) await savedResult;
      onOpenChange(false);
    } catch (error) {
      const hebrewMessage = toHebrewError(
        error,
        isEditing ? "עדכון ההוצאה נכשל." : "יצירת ההוצאה נכשלה."
      );
      setErrorMessage(hebrewMessage);
      toast.error(isEditing ? "שגיאה בעדכון ההוצאה" : "שגיאה ביצירת ההוצאה", {
        description: hebrewMessage,
      });
    } finally {
      setSaving(false);
    }
  };

  const canSubmit =
    !saving &&
    Boolean(effectiveDomain) &&
    Boolean(finalCategory) &&
    (isWorkerPayment ? true : amount.trim() !== "" && Boolean(expenseDate));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "עריכת הוצאה" : "הוספת הוצאה"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "עדכון פרטי הוצאה קיימת." : "יצירת הוצאה חדשה."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
        >
          {/* Source info / selectors */}
          {isSourceLocked ? (
            <div className="rounded-xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">
                {editingSourceLabel ?? (lockedProjectId ? "פרויקט" : lockedOrderId ? "הזמנה" : "נכס")}
              </div>
              <div>השיוך למקור נשמר כמו שהוא — ניתן לעדכן רק את פרטי ההוצאה.</div>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <div className="text-sm font-medium">תחום עסקי *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={businessDomain}
                  onChange={(e) => {
                    const next = e.target.value as ExpenseBusinessDomain | "";
                    setBusinessDomain(next);
                    setProjectId("");
                    setOrderId("");
                    setPropertyId("");
                  }}
                >
                  <option value="">בחרו תחום</option>
                  {EXPENSE_BUSINESS_DOMAINS.map((d) => (
                    <option key={d} value={d}>{getBusinessDomainLabel(d)}</option>
                  ))}
                </select>
              </div>

              {!isEditing && effectiveDomain === "logistics_projects" && recurringProjects.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">פרויקט *</div>
                  <ProjectPicker
                    projects={recurringProjects}
                    value={projectId}
                    onChange={setProjectId}
                    emptyLabel="בחרו פרויקט"
                  />
                </div>
              )}

              {!isEditing && effectiveDomain === "sales" && recurringOrders.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">הזמנה</div>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                  >
                    <option value="">ללא הזמנה</option>
                    {recurringOrders.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {!isEditing && effectiveDomain === "property_management" && recurringProperties.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">נכס *</div>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                  >
                    <option value="">בחרו נכס</option>
                    {recurringProperties.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {effectiveDomain ? (
            <>
          {/* Category (dropdown; "אחר" reveals a free-text field) */}
          <div className="space-y-1">
            <div className="text-sm font-medium">קטגוריה *</div>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                if (e.target.value !== CARS_CATEGORY) setTagIds(presetTagLabel ? tagIds : []);
              }}
            >
              {categoryOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          {category === OTHER_CATEGORY ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">איזו קטגוריה? *</div>
              <Input value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} />
            </div>
          ) : null}

          {/* Vehicle / tag link — sits right under the category. Locked banner from
              a car's page; otherwise the editable picker shows for the "רכבים"
              category or when the expense already carries a car tag. */}
          {presetTagLabel ? (
            <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-sm">
              <Car className="h-4 w-4 text-muted-foreground" />
              <span>
                ההוצאה משויכת לרכב: <span className="font-medium text-foreground">{presetTagLabel}</span>
              </span>
            </div>
          ) : !isWorkerPayment && (finalCategory === CARS_CATEGORY || tagIds.length > 0) ? (
            <TagPicker value={tagIds} onChange={setTagIds} />
          ) : null}

          {isWorkerPayment ? (
            /* ── Worker-session branch ───────────────────────────────────── */
            <>
              {canManageWorkerSessions ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium">עובד *</div>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={workerUserId}
                    onChange={(e) => setWorkerUserId(e.target.value)}
                  >
                    <option value="">בחרו עובד</option>
                    {workerList.map((u) => (
                      <option key={u.id} value={u.id}>{u.label}</option>
                    ))}
                  </select>
                </div>
              ) : null}

              {canManageWorkerSessions ? (
                !newWorkerOpen ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setNewWorkerOpen(true)}>
                    עובד חדש
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
                    <div className="text-sm font-medium">הוספת עובד חדש</div>
                    <Input value={newWorkerName} onChange={(e) => setNewWorkerName(e.target.value)} placeholder="שם עובד" />
                    <Input value={newWorkerPhone} onChange={(e) => setNewWorkerPhone(e.target.value)} placeholder="טלפון עובד" />
                    <div className="text-xs text-muted-foreground">עובד חדש ייווצר כרשומת עובד בלבד, בלי גישה למערכת.</div>
                    {newWorkerError ? <div className="text-sm text-destructive">{newWorkerError}</div> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void createWorker()}
                        disabled={newWorkerSubmitting || !newWorkerName.trim() || !newWorkerPhone.trim()}
                      >
                        {newWorkerSubmitting ? "שומר..." : "הוסף עובד"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={newWorkerSubmitting}
                        onClick={() => {
                          setNewWorkerOpen(false);
                          setNewWorkerError(null);
                          setNewWorkerName("");
                          setNewWorkerPhone("");
                        }}
                      >
                        ביטול
                      </Button>
                    </div>
                  </div>
                )
              ) : null}

              {showSessionTimingFields ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">כניסה *</div>
                    <DateTimeInput value={clockIn} onChange={(e) => setClockIn(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium">סה״כ שעות</div>
                    <Input
                      inputMode="decimal"
                      value={sessionDuration}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        if (!nextValue.trim()) {
                          setClockOut("");
                          return;
                        }
                        const parsedHours = Number(nextValue);
                        const clockInIso = toIso(clockIn);
                        if (!Number.isFinite(parsedHours) || parsedHours <= 0 || !clockInIso) return;
                        const next = new Date(new Date(clockInIso).getTime() + parsedHours * 3600000);
                        if (Number.isNaN(next.getTime())) return;
                        const pad = (n: number) => String(n).padStart(2, "0");
                        setClockOut(
                          `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`
                        );
                      }}
                      placeholder="למשל 8"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium">יציאה *</div>
                    <DateTimeInput value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-sm font-medium">תאריך *</div>
                  <DateInput
                    value={sessionDateOnly}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (!next) return;
                      setClockIn(`${next}T09:00`);
                      setClockOut(`${next}T10:00`);
                    }}
                  />
                </div>
              )}

              {showSessionPriceField ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium">עלות עבודה</div>
                  <CurrencyInput value={laborCost} onChange={(e) => setLaborCost(e.target.value)} placeholder="אופציונלי" />
                  <span className="block text-xs text-muted-foreground">
                    {suggestedWorkerAmount !== null
                      ? `סה״כ לתשלום עבור המשמרת: ${formatIls(suggestedWorkerAmount)}`
                      : "הסכום שמגיע לעובד יוצג כאן אחרי הזנת שעות תקינות או עלות עבודה."}
                  </span>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {suggestedWorkerAmount !== null
                    ? `סה״כ לתשלום עבור המשמרת (חישוב אוטומטי): ${formatIls(suggestedWorkerAmount)}`
                    : "העלות תחושב אוטומטית לפי הסכם השכר לאחר שמירה."}
                </div>
              )}

              {effectiveDomain === "logistics_projects" ? (
                <section className="space-y-2 rounded-xl border bg-muted/30 p-3">
                  <h4 className="text-sm font-semibold">חיוב הלקוח</h4>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={billedToCustomer}
                      onChange={(e) => {
                        setBilledToCustomer(e.target.checked);
                        if (!e.target.checked) setBillToCustomerAmount("");
                      }}
                    />
                    <span>לחיוב לקוח</span>
                  </label>
                  {billedToCustomer ? (
                    <div className="space-y-1">
                      <div className="text-sm font-medium">סכום לחיוב לקוח</div>
                      <CurrencyInput value={billToCustomerAmount} onChange={(e) => setBillToCustomerAmount(e.target.value)} placeholder="למשל 650" />
                    </div>
                  ) : null}
                </section>
              ) : null}

              {canManageWorkerSessions ? (
                <section className="space-y-2 rounded-xl border bg-muted/30 p-3">
                  <h4 className="text-sm font-semibold">תשלום לעובד</h4>
                  <div className="space-y-1">
                    <div className="text-sm font-medium">סטטוס תשלום לעובד</div>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={workerPaymentChoice}
                      onChange={(e) => setWorkerPaymentChoice(e.target.value as PaymentChoice)}
                    >
                      <option value="none">לא שולם</option>
                      <option value="paid">שולם במלואו</option>
                      <option value="partial">שולם חלקית</option>
                    </select>
                  </div>
                  {workerPaymentChoice !== "none" ? (
                    <>
                      <div className="space-y-1">
                        <div className="text-sm font-medium">כמה שולם</div>
                        <CurrencyInput
                          value={workerPaidAmount}
                          onChange={(e) => setWorkerPaidAmount(e.target.value)}
                          placeholder="אם ריק, יירשם מלוא סכום המשמרת"
                        />
                      </div>
                      <AccountSelect
                        required
                        value={workerAccountId}
                        onChange={setWorkerAccountId}
                        onLoaded={setAccountsList}
                      />
                    </>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : (
            /* ── Normal expense branch ───────────────────────────────────── */
            <>
              {/* Amount + Date */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-sm font-medium">סכום *</div>
                  <CurrencyInput type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium">תאריך</div>
                  <DateInput value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
                </div>
              </div>

              {/* Payment Status */}
              <div className="space-y-1">
                <div className="text-sm font-medium">סטטוס תשלום</div>
                <div className="grid grid-cols-3 gap-2">
                  {(["not_paid", "partial", "paid"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setPaymentStatus(s)}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                        paymentStatus === s
                          ? s === "paid"
                            ? "border-success bg-success/10 text-success"
                            : s === "partial"
                              ? "border-warning bg-warning/15 text-warning-strong"
                              : "border-destructive bg-destructive/10 text-destructive"
                          : "border-input bg-background text-muted-foreground hover:bg-muted/40"
                      )}
                    >
                      {paymentStatusLabel(s)}
                    </button>
                  ))}
                </div>
              </div>

              {(paymentStatus === "paid" || paymentStatus === "partial") && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">אמצעי תשלום</div>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={paymentMethod}
                      onChange={(e) => {
                        const m = e.target.value;
                        setPaymentMethod(m);
                        setAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
                      }}
                    >
                      <option value="">בחר אמצעי</option>
                      {PAYMENT_METHOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <AccountSelect
                    required
                    value={accountId}
                    onChange={setAccountId}
                    onLoaded={(list) => {
                      setAccountsList(list);
                      setAccountId((prev) => prev || defaultAccountForMethod(list, paymentMethod));
                    }}
                  />
                  {paymentStatus === "partial" && (
                    <div className="space-y-1">
                      <div className="text-sm font-medium">סכום ששולם</div>
                      <CurrencyInput type="number" min="0" step="0.01" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} placeholder="0.00" />
                    </div>
                  )}
                </div>
              )}

              {/* Description */}
              <div className="space-y-1">
                <div className="text-sm font-medium">תיאור</div>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>

              {/* Project billing options */}
              {showBillingOptions && (
                <div className="flex flex-col gap-2 rounded-xl border px-3 py-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={includedInBasePrice} onChange={(e) => setIncludedInBasePrice(e.target.checked)} />
                    <span>כלול במחיר הבסיס</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={billedToCustomer} onChange={(e) => setBilledToCustomer(e.target.checked)} />
                    <span>לחיוב לקוח</span>
                  </label>
                </div>
              )}
            </>
          )}

          {/* Notes */}
          <div className="space-y-1">
            <div className="text-sm font-medium">הערות</div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {/* Attachments */}
          {showAttachments && (
            <div className="space-y-2">
              <div className="text-sm font-medium">קבצים מצורפים</div>
              <div className="flex items-center gap-2">
                <FileUploadActions
                  files={attachmentFiles}
                  multiple
                  onFilesSelected={setAttachmentFiles}
                  chooseLabel={
                    attachmentFiles.length > 0 || existingAttachments.length > 0
                      ? "הוסף קבצים"
                      : "העלה קבצים"
                  }
                  chooseVariant="outline"
                  size="sm"
                />
                {attachmentFiles.length > 0 && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setAttachmentFiles([])}>
                    נקה
                  </Button>
                )}
              </div>
              {existingAttachments.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">קבצים קיימים</div>
                  <div className="flex flex-wrap gap-2">
                    {existingAttachments.map((att) => (
                      <a
                        key={att.document_id}
                        href={att.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent"
                      >
                        {att.file_name ?? "קובץ"}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
            </>
          ) : null}

          {errorMessage ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
            >
              {errorMessage}
            </div>
          ) : null}

          <DialogFooter className="mt-6">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              ביטול
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {saving ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  שומר...
                </>
              ) : (
                "שמירה"
              )}
            </Button>
          </DialogFooter>
        </form>
      </AdaptiveDialog>
    </Dialog>
  );
}
