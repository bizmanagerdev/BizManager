"use client";

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Car,
  Loader2,
  Wallet,
  ArrowLeft,
  ArrowRight,
  Check,
  Delete,
  CalendarDays,
  Split,
  Upload,
  Paperclip,
  LayoutList,
  Rows3,
  Landmark,
  CreditCard,
  Banknote,
} from "lucide-react";
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
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_WORKER_WAGE_CATEGORY,
  EXPENSE_OTHER_CATEGORY,
  EXPENSE_CARS_CATEGORY,
  getBusinessDomainLabel,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { getBusinessDomainIcon } from "@/components/financial/DomainSelect";
import { offlineFetch } from "@/lib/offline-queue";
import { offlineUpload } from "@/lib/offline-upload";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_OPTIONS, type FinancialAttachment } from "@/lib/payments";
import AccountSelect, { loadAccounts } from "@/components/financial/AccountSelect";
import { DomainSelect } from "@/components/financial/DomainSelect";
import {
  InstallmentFields,
  buildInstallmentRows,
  validateInstallments,
  type InstallmentRow,
} from "@/components/expenses/InstallmentFields";
import { defaultAccountForMethod, getAccountKindLabel, type Account } from "@/lib/accounts";
import {
  calculateSessionLaborCost,
  getActiveSalaryAgreementForDate,
  type SalaryAgreementRow,
  type WorkSessionRow,
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
// Domains where a worker session can be billed back to a customer/tenant, so the
// "חיוב הלקוח" section is offered (form + express stay in sync via this list).
const WORKER_BILLABLE_DOMAINS: readonly string[] = ["logistics_projects", "sales", "property_management"];

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
  bill_to_customer_amount?: number | string | null;
  attachments?: FinancialAttachment[];
};

export type ExpenseDialogSavedData = {
  expenseId: string;
  // "expense" | "session" | "installments" — lets a parent rebuild its list row.
  sourceType?: "expense" | "session" | "installments";
  expense: Record<string, unknown>;
  projectExpense: Record<string, unknown> | null;
  session?: WorkSessionRow | null;
  attachments: FinancialAttachment[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  // Edit mode — provide existing expense data
  editingExpense?: EditingExpenseData | null;
  // Edit mode for a worker SESSION (shift). Turns the dialog into a session editor
  // (worker/clock/labor-cost/payment). Requires `users` to be provided.
  editingSession?: WorkSessionRow | null;
  // Label shown in the source info banner when editing
  editingSourceLabel?: string | null;

  // Defaults for a NEW worker session (used in a project context).
  projectStartDate?: string | null;
  defaultSessionClockIn?: string | null;
  defaultSessionClockOut?: string | null;

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

// ISO/date → "YYYY-MM-DDTHH:mm" local value for DateTimeInput (hydrating a session).
function toLocalDateTimeValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateOnlyOf(value: string | null | undefined) {
  if (!value) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? m[1] : "";
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

// Matching glyph per account kind (bank / cash / card) — used in the express
// account picker so each account reads at a glance.
function accountKindIcon(kind: string | null | undefined) {
  if (kind === "bank") return <Landmark className="h-4 w-4" />;
  if (kind === "card") return <CreditCard className="h-4 w-4" />;
  return <Banknote className="h-4 w-4" />;
}

function isImageAttachment(attachment: Pick<FinancialAttachment, "file_name" | "document_type">) {
  const name = attachment.file_name?.toLowerCase() ?? "";
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(name) || attachment.document_type?.includes("photo");
}

async function uploadAttachment(
  entityType: "expense" | "session",
  entityId: string,
  file: File
): Promise<FinancialAttachment | null> {
  const result = await offlineUpload("/api/financial-attachments/upload", {
    fields: { entity_type: entityType, entity_id: entityId },
    file,
    label: file.name,
  });
  // Queued for later — the receipt syncs when the connection returns
  // (ConnectionToasts announces it); no attachment row to show yet.
  if (result.queued) return null;
  if (!result.ok) throw new Error(result.error || "העלאת הקובץ נכשלה.");
  const data = result.data as { attachment?: FinancialAttachment | null } | null;
  return data?.attachment ?? null;
}

export function ExpenseDialog({
  open,
  onOpenChange,
  editingExpense,
  editingSession,
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
  const isEditingSession = Boolean(editingSession);
  const isEditing = Boolean(editingExpense) || isEditingSession;
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  // Labor cost as originally saved on the session (edit) — drives whether we let
  // the server auto-recalculate it, and lets us detect a manual override.
  const originalLaborCostRef = useRef("");
  // Amount already paid to the worker for this session (edit) — new payments are a
  // delta on top of this, never a reduction.
  const existingWorkerPaidAmount = Math.max(
    0,
    editingSession && Number(editingSession.paid_amount) > 0 ? Number(editingSession.paid_amount) : 0
  );

  const [businessDomain, setBusinessDomain] = useState<ExpenseBusinessDomain | "">("");
  const [projectId, setProjectId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [category, setCategory] = useState(defaultCategory ?? "");
  const [categoryOther, setCategoryOther] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [includedInBasePrice, setIncludedInBasePrice] = useState(false);
  const [billedToCustomer, setBilledToCustomer] = useState(false);
  // Installments ("פריסה לתשלומים"): split this expense into N dated not_paid rows.
  const [installmentsMode, setInstallmentsMode] = useState(false);
  const [installmentRows, setInstallmentRows] = useState<InstallmentRow[]>([]);
  const [billToCustomerAmount, setBillToCustomerAmount] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<FinancialAttachment[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);

  // ── Two input modes (A/B) ────────────────────────────────────────────────
  // "form" = the full single-screen form; "express" = a guided one-question-per-
  // screen flow. Both are driven by the SAME state above, so toggling between
  // them preserves the in-progress entry with no serialization. Editing always
  // uses the form (express is a fast-create experience). Persisted per browser.
  const [viewMode, setViewMode] = useState<"form" | "express">("form");
  const [expStepId, setExpStepId] = useState<string>("amount");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("expenseDialogMode");
      if (saved === "express" || saved === "form") setViewMode(saved);
    } catch {
      /* localStorage unavailable — stay on the form default */
    }
  }, []);
  function chooseMode(mode: "form" | "express") {
    setViewMode(mode);
    try {
      window.localStorage.setItem("expenseDialogMode", mode);
    } catch {
      /* ignore persistence failures */
    }
  }
  // Preload accounts on open so the express flow can render one button per
  // account (the full form loads them lazily via <AccountSelect/>).
  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadAccounts().then((list) => {
      if (active) setAccountsList(list);
    });
    return () => { active = false; };
  }, [open]);

  // Worker-session state (only used when the worker category is selected).
  const [localUsers, setLocalUsers] = useState<ExpenseWorkerOption[]>(users ?? []);
  const [workerUserId, setWorkerUserId] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [laborCost, setLaborCost] = useState("");
  const [workerPaymentChoice, setWorkerPaymentChoice] = useState<PaymentChoice>("none");
  const [workerPaidAmount, setWorkerPaidAmount] = useState("");
  const [workerAccountId, setWorkerAccountId] = useState("");
  const [workerPaymentMethod, setWorkerPaymentMethod] = useState("");
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
  // Contractor/session workers have no clocked hours, so the labor cost is the
  // only way to set what they're owed — it's mandatory for them (unlike global
  // monthly workers, where the field stays optional and can auto-calculate).
  const sessionPriceRequired = selectedWorkerType === "session_only";
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
      {
        const rawBill = editingExpense.bill_to_customer_amount;
        setBillToCustomerAmount(rawBill != null && Number(rawBill) > 0 ? String(Number(rawBill)) : "");
      }
      const dom = editingExpense.business_domain;
      if (dom && (EXPENSE_BUSINESS_DOMAINS as readonly string[]).includes(dom)) {
        setBusinessDomain(dom as ExpenseBusinessDomain);
      }
      setExistingAttachments(
        Array.isArray(editingExpense.attachments) ? editingExpense.attachments : []
      );
      setTagIds([]);
      void fetchExistingTagIds("expense", editingExpense.id).then(setTagIds);
    } else if (editingSession) {
      const s = editingSession;
      setCategory(WORKER_WAGE_CATEGORY);
      setCategoryOther("");
      const dom = typeof s.business_domain === "string" ? s.business_domain : "";
      setBusinessDomain(
        dom && (EXPENSE_BUSINESS_DOMAINS as readonly string[]).includes(dom)
          ? (dom as ExpenseBusinessDomain)
          : (lockedDomain ?? "")
      );
      setWorkerUserId(s.user_id ?? "");
      setClockIn(toLocalDateTimeValue(s.clock_in));
      setClockOut(toLocalDateTimeValue(s.clock_out));
      const lc = s.labor_cost != null ? String(Number(s.labor_cost)) : "";
      setLaborCost(lc);
      originalLaborCostRef.current = lc;
      setNotes(s.notes ?? "");
      setBilledToCustomer(Boolean(s.is_billable_to_customer));
      setBillToCustomerAmount(
        s.bill_to_customer_amount != null && Number(s.bill_to_customer_amount) > 0
          ? String(Number(s.bill_to_customer_amount))
          : ""
      );
      setWorkerPaymentChoice(
        existingWorkerPaidAmount > 0 ? (s.payment_status === "partial" ? "partial" : "paid") : "none"
      );
      setWorkerPaidAmount(existingWorkerPaidAmount > 0 ? String(existingWorkerPaidAmount) : "");
      setWorkerAccountId("");
      // Non-session fields default (this row is a session, not a plain expense).
      setAmount("");
      setExpenseDate(dateOnlyOf(s.clock_in) || todayIso());
      setPaymentStatus("paid");
      setPaidAmount("");
      setPaymentMethod("");
      setAccountId("");
      setDescription("");
      setIncludedInBasePrice(false);
      setProjectId("");
      setOrderId("");
      setPropertyId("");
      setExistingAttachments(Array.isArray(s.attachments) ? s.attachments : []);
      setTagIds([]);
    } else {
      setAmount("");
      setExpenseDate(todayIso());
      setPaymentStatus("paid");
      setPaidAmount("");
      setPaymentMethod("");
      setAccountId("");
      setCategory(defaultCategory ?? "");
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
      setBillToCustomerAmount("");
    }
    setInstallmentsMode(false);
    setInstallmentRows([]);
    if (!editingSession) {
      setWorkerUserId("");
      setClockIn("");
      setClockOut("");
      setLaborCost("");
      setWorkerPaymentChoice("paid");
      setWorkerAccountId("");
      setWorkerPaymentMethod("");
      setWorkerPaidAmount("");
      originalLaborCostRef.current = "";
    }
    setNewWorkerOpen(false);
    setNewWorkerError(null);
    setNewWorkerName("");
    setNewWorkerPhone("");
    setAttachmentFiles([]);
    setErrorMessage("");
    setExpStepId("amount");
    setWorkerSearch("");
    setSourceSearch("");
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
    const laborCostInput = laborCost.trim();
    const laborCostNumber = laborCostInput === "" ? null : Number(laborCostInput);
    if (sessionPriceRequired && laborCostNumber === null) {
      setErrorMessage("יש להזין עלות עבודה.");
      return;
    }
    if (laborCostInput !== "" && (laborCostNumber === null || !Number.isFinite(laborCostNumber) || laborCostNumber <= 0)) {
      setErrorMessage("יש להזין עלות עבודה תקינה.");
      return;
    }
    // Entered amount only required for a PARTIAL payment; "paid" uses the session's
    // (possibly recalculated) labor cost.
    const enteredPaid = workerPaidAmount.trim() ? Number(workerPaidAmount) : null;
    if (
      canManageWorkerSessions &&
      workerPaymentChoice === "partial" &&
      (enteredPaid === null || !Number.isFinite(enteredPaid) || enteredPaid <= 0)
    ) {
      setErrorMessage("יש להזין סכום ששולם לעובד.");
      return;
    }
    if (canManageWorkerSessions && workerPaymentChoice !== "none" && accountsList.length > 0 && !workerAccountId) {
      setErrorMessage("יש לבחור חשבון לתשלום לעובד.");
      return;
    }
    const billAmountNumber = !billedToCustomer || !billToCustomerAmount.trim() ? null : Number(billToCustomerAmount);
    if (billedToCustomer && (billAmountNumber === null || !Number.isFinite(billAmountNumber) || billAmountNumber <= 0)) {
      setErrorMessage("יש להזין סכום לחיוב לקוח.");
      return;
    }

    // Let the server recalc labor cost when it's blank, or (on edit) when the
    // timing changed and the cost wasn't manually overridden.
    const sessionTimingChanged =
      isEditingSession && editingSession != null &&
      (targetUserId !== (editingSession.user_id ?? "") ||
        clockInIso !== (editingSession.clock_in ?? "") ||
        clockOutIso !== (editingSession.clock_out ?? ""));
    const shouldAutoCalcLabor =
      clockOutIso !== "" &&
      ((!isEditingSession && !laborCostInput) ||
        (isEditingSession && (!laborCostInput || (sessionTimingChanged && laborCostInput === originalLaborCostRef.current.trim()))));

    setSaving(true);
    try {
      const endpoint = isEditingSession
        ? (canManageWorkerSessions ? "/api/payroll/sessions/update" : "/api/profile/session/update")
        : (canManageWorkerSessions ? "/api/payroll/sessions/create" : "/api/profile/session/create");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: isEditingSession ? editingSession?.id : undefined,
          user_id: targetUserId,
          business_domain: effectiveDomain,
          project_id: effectiveProjectId || null,
          property_id: effectivePropertyId || null,
          notes: notes.trim() || null,
          clock_in: clockInIso,
          clock_out: clockOutIso,
          labor_cost: shouldAutoCalcLabor ? null : laborCostNumber,
          recalculate_labor_cost: shouldAutoCalcLabor,
          is_billable_to_customer: billedToCustomer,
          bill_to_customer_amount: billedToCustomer ? billAmountNumber : null,
          billing_status: billedToCustomer ? "billable" : "not_billable",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; session?: WorkSessionRow };
      const savedSession = json.session;
      if (!res.ok || !savedSession?.id) {
        setErrorMessage(toHebrewError(json.error, "שמירת המשמרת נכשלה."));
        return;
      }
      const sessionId = savedSession.id;

      // Worker payment (managers): pay only the DELTA on top of what's already paid,
      // never a reduction.
      if (canManageWorkerSessions && workerPaymentChoice !== "none") {
        const sessionLaborCost = savedSession.labor_cost != null ? Number(savedSession.labor_cost) : null;
        const payDate = (savedSession.clock_out || savedSession.clock_in || new Date().toISOString()).slice(0, 10);
        const desired = workerPaymentChoice === "paid" ? sessionLaborCost : enteredPaid;
        const existingPaid = isEditingSession ? existingWorkerPaidAmount : 0;

        if (sessionLaborCost === null || sessionLaborCost <= 0) {
          toast.error("לא ניתן לרשום תשלום לעובד", {
            description: "יש להזין עלות עבודה או לחשב עלות אוטומטית לפני רישום תשלום.",
          });
        } else if (desired == null || !Number.isFinite(desired) || desired <= 0) {
          setErrorMessage("יש להזין סכום ששולם לעובד.");
          return;
        } else if (desired + 0.009 < existingPaid) {
          toast.error("לא ניתן להפחית תשלום קיים מהמסך הזה", {
            description: "כדי להקטין או לבטל תשלום שכבר נרשם, יש לערוך או למחוק אותו במסך השכר.",
          });
        } else {
          const paymentAmount = Math.round(Math.max(0, desired - existingPaid) * 100) / 100;
          if (paymentAmount > 0.009) {
            const payRes = await fetch("/api/payroll/worker-payments", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                user_id: savedSession.user_id ?? targetUserId,
                payment_date: payDate,
                amount: paymentAmount,
                payment_method: workerPaymentMethod || null,
                account_id: workerAccountId || null,
                reference_number: null,
                notes: `תשלום שסומן מתוך טופס הוצאה עבור משמרת ${payDate}`,
                allocations: [{ source_type: "session", source_id: sessionId, amount: paymentAmount }],
              }),
            });
            if (!payRes.ok) {
              const payJson = (await payRes.json().catch(() => ({}))) as { error?: string };
              throw new Error(toHebrewError(payJson.error, "שמירת התשלום לעובד נכשלה."));
            }
          }
        }
      }

      const uploaded: FinancialAttachment[] = [];
      for (const file of attachmentFiles) {
        if (!sessionId) break;
        const att = await uploadAttachment("session", sessionId, file);
        if (att) uploaded.push(att);
      }

      toast.success(
        isEditingSession
          ? "המשמרת עודכנה"
          : canManageWorkerSessions && workerPaymentChoice !== "none"
            ? "המשמרת נשמרה והתשלום לעובד נרשם."
            : "המשמרת נשמרה."
      );
      const savedResult = onSaved({
        expenseId: "",
        sourceType: "session",
        expense: {},
        projectExpense: null,
        session: { ...savedSession, attachments: [...existingAttachments, ...uploaded] },
        attachments: [...existingAttachments, ...uploaded],
      });
      if (savedResult instanceof Promise) await savedResult;
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(toHebrewError(error, "שמירת המשמרת נכשלה."));
    } finally {
      setSaving(false);
    }
  }

  async function submitInstallments(totalAmount: number) {
    const validationError = validateInstallments(installmentRows, totalAmount);
    if (validationError) {
      setErrorMessage(validationError);
      toast.error(validationError);
      return;
    }
    // Any installment marked "already paid" is a real outflow now → it must land in
    // an account, same as any other payment (when accounts are configured).
    const anyPaidInstallment = installmentRows.some((r) => r.paid);
    if (anyPaidInstallment && accountsList.length > 0 && !accountId) {
      setErrorMessage("יש לבחור חשבון עבור התשלומים ששולמו.");
      toast.error("יש לבחור חשבון");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/expenses/split", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_domain: effectiveDomain,
          category: finalCategory,
          description: description.trim() || null,
          notes: notes.trim() || null,
          project_id: effectiveProjectId || null,
          order_id: effectiveOrderId || null,
          property_id: effectivePropertyId || null,
          account_id: accountId || null,
          payment_method: paymentMethod || null,
          installments: installmentRows.map((r) => ({ expense_date: r.date, amount: Number(r.amount), paid: !!r.paid })),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = toHebrewError(json.error, "פיצול ההוצאה לתשלומים נכשל.");
        setErrorMessage(msg);
        toast.error("שגיאה בפיצול ההוצאה", { description: msg });
        return;
      }
      toast.success("ההוצאה פוצלה לתשלומים");
      const savedResult = onSaved({ expenseId: "", sourceType: "installments", expense: {}, projectExpense: null, attachments: [] });
      if (savedResult instanceof Promise) await savedResult;
      onOpenChange(false);
    } catch (error) {
      const msg = toHebrewError(error, "פיצול ההוצאה לתשלומים נכשל.");
      setErrorMessage(msg);
      toast.error("שגיאה בפיצול ההוצאה", { description: msg });
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

    // Installments → split into N dated not_paid rows instead of one expense.
    if (installmentsMode) {
      await submitInstallments(amountNumber);
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
          onSaved({ expenseId: "", sourceType: "expense", expense: {}, projectExpense: null, attachments: [] });
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
        sourceType: "expense",
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

  // ── Express mode (guided, one-question-per-screen) ───────────────────────
  // Only offered for NEW expenses; editing an expense/session always uses the
  // full form. Both modes share the state above, so a half-filled entry carries
  // over when toggling. Worker-wage ("שכר עובד") hands off to the full form.
  const showModeToggle = !isEditing && !isEditingSession;
  const activeMode: "form" | "express" = showModeToggle ? viewMode : "form";

  const needsSourcePicker =
    !isEditing &&
    !isSourceLocked &&
    ((effectiveDomain === "logistics_projects" && recurringProjects.length > 0) ||
      (effectiveDomain === "sales" && recurringOrders.length > 0) ||
      (effectiveDomain === "property_management" && recurringProperties.length > 0));

  const expressSteps = useMemo<string[]>(() => {
    // Worker wage ("שכר עובד") → the flow becomes a work-session builder handled
    // entirely inside express (no hand-off to the full form).
    if (isWorkerPayment) {
      // Keep the same opening steps as a normal expense (amount→domain→source→
      // category) so back-navigation stays consistent and the user can always
      // return to earlier steps; the worker-specific steps follow the category.
      const s: string[] = ["amount"];
      if (!isSourceLocked) s.push("domain");
      if (needsSourcePicker) s.push("source");
      s.push("category");
      if (canManageWorkerSessions) s.push("worker");
      s.push(showSessionTimingFields ? "wtiming" : "wdate");
      // Amount-based (session_only) workers: the opening amount step already
      // captured their pay → the labor step would just re-ask, so skip it.
      if (showSessionPriceField && selectedWorkerType !== "session_only") s.push("wlabor");
      if (WORKER_BILLABLE_DOMAINS.includes(effectiveDomain)) s.push("wbilling");
      if (canManageWorkerSessions) {
        s.push("wpayment");
        // A recorded worker payment gets its own method + account steps (same as
        // a regular expense) instead of cramming them onto the status screen.
        if (workerPaymentChoice !== "none") s.push("wmethod", "waccount");
      }
      s.push("notes");
      if (showAttachments) s.push("files");
      s.push("review");
      return s;
    }
    const s: string[] = ["amount"];
    if (!isSourceLocked) s.push("domain");
    if (needsSourcePicker) s.push("source");
    if (effectiveDomain) s.push("category");
    if (category === OTHER_CATEGORY) s.push("otherCategory");
    if (finalCategory === CARS_CATEGORY && !presetTagLabel) s.push("tags");
    s.push("date");
    // Installments come BEFORE the payment questions: splitting turns the expense
    // into dated not-paid rows, so paid/method/account don't apply once you split.
    if (!isEditing) s.push("installments");
    if (installmentsMode) {
      s.push("instcount");
      // If some installments were marked already-paid, collect where they were paid.
      if (installmentRows.some((r) => r.paid)) s.push("method", "account");
    } else {
      s.push("status");
      if (paymentStatus === "partial") s.push("paidamt");
      if (paymentStatus === "paid" || paymentStatus === "partial") s.push("method", "account");
      if (showBillingOptions) s.push("billing");
    }
    s.push("description", "notes");
    if (showAttachments) s.push("files");
    s.push("review");
    return s;
  }, [
    isSourceLocked, needsSourcePicker, effectiveDomain, category, isWorkerPayment,
    finalCategory, presetTagLabel, paymentStatus, isEditing, installmentsMode,
    showBillingOptions, showAttachments, canManageWorkerSessions,
    showSessionTimingFields, showSessionPriceField, selectedWorkerType,
    workerPaymentChoice, installmentRows,
  ]);

  const rawIndex = expressSteps.indexOf(expStepId);
  const expIndex = rawIndex < 0 ? 0 : rawIndex;
  const expStep = expressSteps[expIndex];
  const expProgress = ((expIndex + 1) / expressSteps.length) * 100;

  // Navigation reads the LATEST step list via refs, never a captured closure —
  // otherwise a step that reshapes the list (e.g. picking שכר עובד drops the
  // amount step) would advance against the old list and land on the wrong screen.
  const expressStepsRef = useRef<string[]>(expressSteps);
  const expStepRef = useRef(expStep);
  useEffect(() => {
    expressStepsRef.current = expressSteps;
    expStepRef.current = expStep;
  });

  function expressGo(d: 1 | -1) {
    const steps = expressStepsRef.current;
    const cur = steps.indexOf(expStepRef.current);
    const base = cur < 0 ? 0 : cur;
    const next = Math.max(0, Math.min(steps.length - 1, base + d));
    setExpStepId(steps[next]);
  }
  function expressAdvance() {
    // brief delay so the selection highlight registers before sliding on
    window.setTimeout(() => expressGo(1), 160);
  }
  function applyKey(cur: string, ch: string) {
    let v = cur || "";
    if (ch === "del") v = v.slice(0, -1);
    else if (ch === ".") { if (!v.includes(".")) v = (v || "0") + "."; }
    else v = v === "0" ? ch : v + ch;
    const parts = v.split(".");
    if (parts[1] && parts[1].length > 2) v = parts[0] + "." + parts[1].slice(0, 2);
    return v;
  }
  const ils = (n: number) => "₪" + Number(n || 0).toLocaleString("en-US");

  // Amount-based (session_only) workers in express skip the labor step, so the
  // opening amount IS their pay — mirror it into laborCost for submit/payment.
  useEffect(() => {
    if (activeMode === "express" && isWorkerPayment && selectedWorkerType === "session_only") {
      setLaborCost(amount);
    }
  }, [activeMode, isWorkerPayment, selectedWorkerType, amount]);

  // Physical keyboard in express: type the amount directly (digits / "." /
  // backspace / Enter), and press 1-9 on option screens to pick that card.
  useEffect(() => {
    if (activeMode !== "express") return;
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName ?? "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (expStep === "amount" || expStep === "paidamt") {
        const setter = expStep === "amount" ? setAmount : setPaidAmount;
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setter((c) => applyKey(c, e.key)); return; }
        if (e.key === ".") { e.preventDefault(); setter((c) => applyKey(c, ".")); return; }
        if (e.key === "Backspace") { e.preventDefault(); setter((c) => applyKey(c, "del")); return; }
        if (e.key === "Enter") {
          if (expStep === "amount" && !(Number(amount) > 0)) return;
          e.preventDefault();
          expressGo(1);
          return;
        }
        return;
      }
      if (!typing && /^[1-9]$/.test(e.key)) {
        const btns = document.querySelectorAll<HTMLButtonElement>("[data-exp-option]");
        const target = btns[Number(e.key) - 1];
        if (target) { e.preventDefault(); target.click(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeMode, expStep, expressSteps, amount]);

  function expEyebrow(icon: ReactNode, text: string) {
    return (
      <div className="flex items-center justify-center gap-2 text-xs font-bold text-primary">
        {icon}
        <span>{text}</span>
      </div>
    );
  }
  function expTitle(title: string, sub?: string) {
    return (
      <>
        <h2 className="mt-1 text-center text-xl font-semibold leading-tight tracking-tight">{title}</h2>
        {sub ? <p className="mt-0.5 mb-3 text-center text-sm text-muted-foreground">{sub}</p> : <div className="mb-2" />}
      </>
    );
  }
  function expCard(o: {
    key?: string; icon?: ReactNode; title: string; sub?: string; selected?: boolean;
    tone?: "brand" | "paid" | "partial" | "unpaid"; badge?: number; onClick: () => void;
  }) {
    const tone = o.tone ?? "brand";
    const sel = o.selected
      ? tone === "paid" ? "border-success bg-success/10"
        : tone === "partial" ? "border-warning bg-warning/15"
          : tone === "unpaid" ? "border-destructive bg-destructive/10"
            : "border-primary bg-primary/5 ring-2 ring-primary/15"
      : "border-input bg-background hover:border-primary/60 hover:bg-primary/5";
    return (
      <button
        key={o.key}
        type="button"
        data-exp-option
        onClick={o.onClick}
        className={cn("flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-right transition-colors", sel)}
      >
        {o.icon ? (
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-muted text-primary">{o.icon}</span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{o.title}</span>
          {o.sub ? <span className="block text-xs text-muted-foreground">{o.sub}</span> : null}
        </span>
        {o.badge != null ? (
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded border text-[11px] font-bold tabular-nums text-muted-foreground">{o.badge}</span>
        ) : null}
      </button>
    );
  }
  function expKeypad(setter: (updater: (c: string) => string) => void, confirmDisabled = false) {
    const tap = (ch: string) => setter((c) => applyKey(c, ch));
    const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const keyCls = "flex h-11 items-center justify-center rounded-xl border border-input bg-background text-xl font-bold tabular-nums transition-colors hover:bg-muted active:scale-95";
    return (
      <div dir="ltr" className="mt-2 grid grid-cols-3 gap-2">
        {digits.map((k) => (
          <button key={k} type="button" onClick={() => tap(k)} className={keyCls}>{k}</button>
        ))}
        <button type="button" onClick={() => tap(".")} className={keyCls}>.</button>
        <button type="button" onClick={() => tap("0")} className={keyCls}>0</button>
        <button type="button" onClick={() => tap("del")} className={keyCls} aria-label="מחק"><Delete className="h-5 w-5" /></button>
        <button
          type="button"
          onClick={() => expressGo(1)}
          disabled={confirmDisabled}
          className="col-span-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          <ArrowLeft className="h-5 w-5" />המשך
        </button>
      </div>
    );
  }
  function expAmountHero(value: string, filledTone = true) {
    const n = Number(value) || 0;
    return (
      <div
        dir="ltr"
        className={cn(
          "flex items-baseline justify-center gap-3 border-b-2 pb-1 transition-colors",
          n > 0 && filledTone ? "border-success" : "border-input"
        )}
      >
        <span className="text-3xl font-bold text-muted-foreground">₪</span>
        <span className="text-center text-4xl font-bold leading-none tabular-nums">
          {n > 0 ? n.toLocaleString("en-US") : "0"}
        </span>
      </div>
    );
  }
  function expContinue(onClick?: () => void, label = "המשך", skip?: () => void, disabled = false) {
    return (
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button type="button" onClick={onClick ?? (() => expressGo(1))} disabled={disabled}>
          <ArrowLeft className="ml-1 h-4 w-4" />{label}
        </Button>
        {skip ? (
          <button type="button" onClick={skip} className="mr-auto text-sm font-semibold text-muted-foreground hover:text-foreground">
            דלג
          </button>
        ) : null}
      </div>
    );
  }
  function shiftDate(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function expressStageContent(): ReactNode {
    switch (expStep) {
      case "amount":
        return (
          <>
            {expEyebrow(<Wallet className="h-4 w-4" />, "סכום")}
            {expTitle("כמה עלתה ההוצאה?")}
            {expAmountHero(amount)}
            {expKeypad(setAmount, !(Number(amount) > 0))}
          </>
        );
      case "domain":
        return (
          <>
            {expEyebrow(<LayoutList className="h-4 w-4" />, "סיווג")}
            {expTitle("לאיזה תחום שייכת ההוצאה?", "בחירה תעביר אותך אוטומטית לשלב הבא")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EXPENSE_BUSINESS_DOMAINS.map((d, i) => {
                const Icon = getBusinessDomainIcon(d);
                return expCard({
                  key: d,
                  badge: i + 1,
                  icon: Icon ? <Icon className="h-4 w-4" /> : null,
                  title: getBusinessDomainLabel(d),
                  selected: businessDomain === d,
                  onClick: () => {
                    setBusinessDomain(d);
                    setProjectId("");
                    setOrderId("");
                    setPropertyId("");
                    expressAdvance();
                  },
                });
              })}
            </div>
          </>
        );
      case "source": {
        const q = sourceSearch.trim().toLowerCase();
        const searchBox = (placeholder: string) => (
          <Input value={sourceSearch} onChange={(e) => setSourceSearch(e.target.value)} placeholder={placeholder} className="mb-2" />
        );
        if (effectiveDomain === "logistics_projects") {
          const list = recurringProjects.filter((p) => p.label.toLowerCase().includes(q));
          return (
            <>
              {expEyebrow(<LayoutList className="h-4 w-4" />, "פרויקט")}
              {expTitle("לאיזה פרויקט לשייך?")}
              {searchBox("חיפוש פרויקט...")}
              <div className="grid gap-2">
                {list.map((p, i) =>
                  expCard({ key: p.id, badge: i + 1, title: p.label, selected: projectId === p.id, onClick: () => { setProjectId(p.id); expressAdvance(); } })
                )}
              </div>
            </>
          );
        }
        if (effectiveDomain === "sales") {
          const list = recurringOrders.filter((o) => o.label.toLowerCase().includes(q));
          return (
            <>
              {expEyebrow(<LayoutList className="h-4 w-4" />, "הזמנה")}
              {expTitle("לאיזו הזמנה לשייך?", "אפשר גם בלי הזמנה")}
              {searchBox("חיפוש הזמנה...")}
              <div className="grid gap-2">
                {expCard({ key: "__none", badge: 1, title: "ללא הזמנה", selected: orderId === "", onClick: () => { setOrderId(""); expressAdvance(); } })}
                {list.map((o, i) =>
                  expCard({ key: o.id, badge: i + 2, title: o.label, selected: orderId === o.id, onClick: () => { setOrderId(o.id); expressAdvance(); } })
                )}
              </div>
            </>
          );
        }
        const list = recurringProperties.filter((p) => p.label.toLowerCase().includes(q));
        return (
          <>
            {expEyebrow(<LayoutList className="h-4 w-4" />, "נכס")}
            {expTitle("לאיזה נכס לשייך?")}
            {searchBox("חיפוש נכס...")}
            <div className="grid gap-2">
              {list.map((p, i) =>
                expCard({ key: p.id, badge: i + 1, title: p.label, selected: propertyId === p.id, onClick: () => { setPropertyId(p.id); expressAdvance(); } })
              )}
            </div>
          </>
        );
      }
      case "category": {
        const domIcon = getBusinessDomainIcon(effectiveDomain);
        return (
          <>
            {expEyebrow(domIcon ? (() => { const I = domIcon; return <I className="h-4 w-4" />; })() : null, getBusinessDomainLabel(effectiveDomain))}
            {expTitle("איזו קטגוריה?", "קטגוריות מתוך התחום שבחרת")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {categoryOptions.map((c, i) =>
                expCard({
                  key: c,
                  badge: i + 1,
                  title: c,
                  selected: category === c,
                  onClick: () => {
                    setCategory(c);
                    if (c !== CARS_CATEGORY) setTagIds(presetTagLabel ? tagIds : []);
                    expressAdvance();
                  },
                })
              )}
            </div>
          </>
        );
      }
      case "otherCategory":
        return (
          <>
            {expEyebrow(null, "קטגוריה")}
            {expTitle("איזו קטגוריה?")}
            <Input value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} autoFocus />
            {expContinue(undefined, "המשך", undefined, !categoryOther.trim())}
          </>
        );
      case "tags":
        return (
          <>
            {expEyebrow(<Car className="h-4 w-4" />, "רכב")}
            {expTitle("לשייך לרכב?", "אפשר לדלג")}
            <TagPicker value={tagIds} onChange={setTagIds} />
            {expContinue()}
          </>
        );
      case "date":
        return (
          <>
            {expEyebrow(<CalendarDays className="h-4 w-4" />, "תאריך")}
            {expTitle("מתי בוצעה ההוצאה?")}
            <DateInput value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {[["היום", 0], ["אתמול", -1], ["שלשום", -2]].map(([label, days]) => (
                <button
                  key={label as string}
                  type="button"
                  onClick={() => { setExpenseDate(shiftDate(days as number)); expressAdvance(); }}
                  className="rounded-full border border-input bg-background px-4 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {label}
                </button>
              ))}
            </div>
            {expContinue()}
          </>
        );
      case "status":
        return (
          <>
            {expEyebrow(<Wallet className="h-4 w-4" />, "סטטוס תשלום")}
            {expTitle("מה סטטוס התשלום?", `סכום ${ils(Number(amount) || 0)}`)}
            <div className="grid gap-2">
              {expCard({ badge: 1, title: "לא שולם", sub: "ההוצאה עדיין ממתינה לתשלום", tone: "unpaid", selected: paymentStatus === "not_paid", onClick: () => { setPaymentStatus("not_paid"); expressAdvance(); } })}
              {expCard({ badge: 2, title: "שולם חלקית", sub: "שולם חלק מהסכום", tone: "partial", selected: paymentStatus === "partial", onClick: () => { setPaymentStatus("partial"); expressAdvance(); } })}
              {expCard({ badge: 3, title: "שולם", sub: "ההוצאה שולמה במלואה", tone: "paid", selected: paymentStatus === "paid", onClick: () => { setPaymentStatus("paid"); expressAdvance(); } })}
            </div>
          </>
        );
      case "paidamt":
        return (
          <>
            {expEyebrow(<Wallet className="h-4 w-4" />, "תשלום חלקי")}
            {expTitle("כמה שולם עד כה?", `מתוך ${ils(Number(amount) || 0)}`)}
            {expAmountHero(paidAmount)}
            {expKeypad(setPaidAmount)}
          </>
        );
      case "method":
        return (
          <>
            {expEyebrow(<Wallet className="h-4 w-4" />, "אמצעי תשלום")}
            {expTitle("איך שילמת?", "לא חובה — אפשר לדלג")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PAYMENT_METHOD_OPTIONS.map((m, i) =>
                expCard({
                  key: m.value,
                  badge: i + 1,
                  title: m.label,
                  selected: paymentMethod === m.value,
                  onClick: () => {
                    setPaymentMethod(m.value);
                    setAccountId((prev) => prev || defaultAccountForMethod(accountsList, m.value));
                    expressAdvance();
                  },
                })
              )}
            </div>
            {expContinue(() => expressGo(1), "המשך", () => { setPaymentMethod(""); expressGo(1); })}
          </>
        );
      case "account":
        return (
          <>
            {expEyebrow(<Wallet className="h-4 w-4" />, "חשבון")}
            {expTitle("מאיזה חשבון?")}
            {accountsList.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">לא הוגדרו חשבונות — אפשר להמשיך בלי שיוך.</p>
                {expContinue()}
              </>
            ) : (
              <div className="grid gap-2">
                {accountsList.map((a, i) =>
                  expCard({
                    key: a.id,
                    badge: i + 1,
                    icon: accountKindIcon(a.kind),
                    title: a.name,
                    sub: getAccountKindLabel(a.kind),
                    selected: accountId === a.id,
                    onClick: () => { setAccountId(a.id); expressAdvance(); },
                  })
                )}
              </div>
            )}
          </>
        );
      case "installments":
        return (
          <>
            {expEyebrow(<Split className="h-4 w-4" />, "אופן חיוב")}
            {expTitle("תשלום אחד או פריסה?")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {expCard({ badge: 1, icon: <Wallet className="h-4 w-4" />, title: "תשלום אחד", selected: !installmentsMode, onClick: () => { setInstallmentsMode(false); expressAdvance(); } })}
              {expCard({
                badge: 2,
                icon: <Split className="h-4 w-4" />,
                title: "פריסה לתשלומים",
                selected: installmentsMode,
                onClick: () => {
                  const total = Number(amount);
                  setInstallmentRows(buildInstallmentRows(Number.isFinite(total) && total > 0 ? total : 0, expenseDate || todayIso(), 2));
                  setInstallmentsMode(true);
                  expressAdvance();
                },
              })}
            </div>
          </>
        );
      case "instcount":
        return (
          <>
            {expEyebrow(<Split className="h-4 w-4" />, "פריסה")}
            {expTitle("לכמה תשלומים לפרוס?")}
            <InstallmentFields
              total={Number(amount) || 0}
              startDate={expenseDate || todayIso()}
              rows={installmentRows}
              onChange={setInstallmentRows}
            />
            {expContinue()}
          </>
        );
      case "billing":
        return (
          <>
            {expEyebrow(<LayoutList className="h-4 w-4" />, "חיוב לקוח")}
            {expTitle("שיוך לפרויקט")}
            <div className="grid gap-2">
              {expCard({ badge: 1, title: "לחיוב לקוח", sub: "ההוצאה תתווסף לחיוב הלקוח", selected: billedToCustomer, onClick: () => { setBilledToCustomer(true); setIncludedInBasePrice(false); expressAdvance(); } })}
              {expCard({ badge: 2, title: "כלול במחיר הבסיס", sub: "ההוצאה מכוסה במחיר הפרויקט", selected: includedInBasePrice, onClick: () => { setIncludedInBasePrice(true); setBilledToCustomer(false); expressAdvance(); } })}
            </div>
          </>
        );
      case "description": {
        const sugg = [finalCategory || "הוצאה שוטפת", "תשלום לספק", "רכישה חד-פעמית"].filter(Boolean);
        return (
          <>
            {expEyebrow(<Paperclip className="h-4 w-4" />, "תיאור")}
            {expTitle("על מה ההוצאה?", "בחרו הצעה או כתבו חופשי")}
            <div className="mb-3 flex flex-wrap justify-center gap-2">
              {sugg.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setDescription(c); expressGo(1); }}
                  className="rounded-full border border-input bg-background px-4 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {c}
                </button>
              ))}
            </div>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="על מה ההוצאה? לדוגמה: חומרי ניקוי לרבעון" />
            {expContinue(undefined, "המשך", () => expressGo(1))}
          </>
        );
      }
      case "notes":
        return (
          <>
            {expEyebrow(<Paperclip className="h-4 w-4" />, "הערות")}
            {expTitle("הערות פנימיות?", "לא חובה")}
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            {expContinue(undefined, "המשך", () => expressGo(1))}
          </>
        );
      case "files":
        return (
          <>
            {expEyebrow(<Upload className="h-4 w-4" />, "קבצים מצורפים")}
            {expTitle("לצרף חשבונית או קבלה?", "לא חובה")}
            <div className="flex items-center gap-2">
              <FileUploadActions
                files={attachmentFiles}
                multiple
                onFilesSelected={setAttachmentFiles}
                chooseLabel={attachmentFiles.length > 0 ? "הוסף קבצים" : "העלה קבצים"}
                chooseVariant="outline"
                size="sm"
              />
              {attachmentFiles.length > 0 ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setAttachmentFiles([])}>נקה</Button>
              ) : null}
            </div>
            {expContinue()}
          </>
        );
      case "worker":
        return (
          <>
            {expEyebrow(<Wallet className="h-4 w-4" />, "עובד")}
            {expTitle("מי העובד?")}
            <Input
              value={workerSearch}
              onChange={(e) => setWorkerSearch(e.target.value)}
              placeholder="חיפוש עובד..."
              className="mb-2"
            />
            <div className="grid gap-2">
              {workerList
                .filter((u) => u.label.toLowerCase().includes(workerSearch.trim().toLowerCase()))
                .map((u, i) =>
                  expCard({
                    key: u.id,
                    badge: i + 1,
                    title: u.label,
                    selected: workerUserId === u.id,
                    onClick: () => { setWorkerUserId(u.id); expressAdvance(); },
                  })
                )}
            </div>
            {!newWorkerOpen ? (
              <button type="button" onClick={() => setNewWorkerOpen(true)} className="mt-3 text-sm font-semibold text-primary hover:underline">
                + עובד חדש
              </button>
            ) : (
              <div className="mt-3 space-y-2 rounded-xl border bg-muted/20 p-3">
                <div className="text-sm font-medium">הוספת עובד חדש</div>
                <Input value={newWorkerName} onChange={(e) => setNewWorkerName(e.target.value)} placeholder="שם עובד" />
                <Input value={newWorkerPhone} onChange={(e) => setNewWorkerPhone(e.target.value)} placeholder="טלפון עובד" />
                {newWorkerError ? <div className="text-sm text-destructive">{newWorkerError}</div> : null}
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => void createWorker()} disabled={newWorkerSubmitting || !newWorkerName.trim() || !newWorkerPhone.trim()}>
                    {newWorkerSubmitting ? "שומר..." : "הוסף עובד"}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" disabled={newWorkerSubmitting} onClick={() => { setNewWorkerOpen(false); setNewWorkerError(null); setNewWorkerName(""); setNewWorkerPhone(""); }}>
                    ביטול
                  </Button>
                </div>
              </div>
            )}
            {workerUserId ? expContinue() : null}
          </>
        );
      case "wtiming":
        return (
          <>
            {expEyebrow(<CalendarDays className="h-4 w-4" />, "שעות עבודה")}
            {expTitle("מתי עבד/ה?")}
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
            {expContinue(undefined, "המשך", undefined, !(Boolean(toIso(clockIn)) && Boolean(toIso(clockOut)) && new Date(toIso(clockOut)) > new Date(toIso(clockIn))))}
          </>
        );
      case "wdate":
        return (
          <>
            {expEyebrow(<CalendarDays className="h-4 w-4" />, "תאריך")}
            {expTitle("מתי עבד/ה?")}
            <DateInput
              value={sessionDateOnly}
              onChange={(e) => {
                const next = e.target.value;
                if (!next) return;
                setClockIn(`${next}T09:00`);
                setClockOut(`${next}T10:00`);
              }}
            />
            {expContinue()}
          </>
        );
      case "wlabor":
        return (
          <>
            {expEyebrow(<Wallet className="h-4 w-4" />, "עלות עבודה")}
            {expTitle(sessionPriceRequired ? "כמה מגיע לעובד?" : "עלות עבודה")}
            <CurrencyInput value={laborCost} onChange={(e) => setLaborCost(e.target.value)} />
            <div className="mt-1.5 text-xs text-muted-foreground">
              {suggestedWorkerAmount !== null
                ? `סה״כ לתשלום עבור המשמרת: ${formatIls(suggestedWorkerAmount)}`
                : "יחושב אוטומטית לפי הסכם השכר אם יישאר ריק."}
            </div>
            {expContinue(undefined, "המשך", undefined, sessionPriceRequired && !(Number(laborCost) > 0))}
          </>
        );
      case "wbilling":
        return (
          <>
            {expEyebrow(<LayoutList className="h-4 w-4" />, "חיוב לקוח")}
            {expTitle("לחייב את הלקוח?", "אפשר לדלג")}
            <label className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={billedToCustomer}
                onChange={(e) => { setBilledToCustomer(e.target.checked); if (!e.target.checked) setBillToCustomerAmount(""); }}
              />
              <span>לחיוב לקוח</span>
            </label>
            {billedToCustomer ? (
              <div className="mt-2 space-y-1">
                <div className="text-sm font-medium">סכום לחיוב לקוח</div>
                <CurrencyInput value={billToCustomerAmount} onChange={(e) => setBillToCustomerAmount(e.target.value)} placeholder="למשל 650" />
              </div>
            ) : null}
            {expContinue()}
          </>
        );
      case "wpayment":
        return (
          <>
            {expEyebrow(<Wallet className="h-4 w-4" />, "תשלום לעובד")}
            {expTitle("שולם לעובד?")}
            {isEditingSession && existingWorkerPaidAmount > 0 ? (
              <div className="mb-2 text-xs text-muted-foreground">שולם עד עכשיו: {formatIls(existingWorkerPaidAmount)} — תשלום חדש נרשם כתוספת בלבד.</div>
            ) : null}
            <div className="grid gap-2">
              {expCard({ badge: 1, title: "לא שולם", tone: "unpaid", selected: workerPaymentChoice === "none", onClick: () => { setWorkerPaymentChoice("none"); expressAdvance(); } })}
              {expCard({ badge: 2, title: "שולם חלקית", tone: "partial", selected: workerPaymentChoice === "partial", onClick: () => setWorkerPaymentChoice("partial") })}
              {expCard({ badge: 3, title: "שולם במלואו", tone: "paid", selected: workerPaymentChoice === "paid", onClick: () => setWorkerPaymentChoice("paid") })}
            </div>
            {workerPaymentChoice !== "none" ? (
              <div className="mt-3 space-y-2">
                <div className="space-y-1">
                  <div className="text-sm font-medium">כמה שולם</div>
                  <CurrencyInput
                    value={workerPaymentChoice === "paid" ? String(suggestedWorkerAmount ?? workerPaidAmount) : workerPaidAmount}
                    readOnly={workerPaymentChoice === "paid"}
                    onChange={(e) => setWorkerPaidAmount(e.target.value)}
                    placeholder={workerPaymentChoice === "paid" ? "מחושב אוטומטית" : "למשל 300"}
                  />
                </div>
                {expContinue(
                  undefined,
                  "המשך",
                  undefined,
                  workerPaymentChoice === "partial" && !(Number(workerPaidAmount) > 0)
                )}
              </div>
            ) : null}
          </>
        );
      case "wmethod":
        return (
          <>
            {expEyebrow(<Wallet className="h-4 w-4" />, "אמצעי תשלום")}
            {expTitle("איך שולם לעובד?", "לא חובה — אפשר לדלג")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PAYMENT_METHOD_OPTIONS.map((m, i) =>
                expCard({
                  key: m.value,
                  badge: i + 1,
                  title: m.label,
                  selected: workerPaymentMethod === m.value,
                  onClick: () => {
                    setWorkerPaymentMethod(m.value);
                    setWorkerAccountId((prev) => prev || defaultAccountForMethod(accountsList, m.value));
                    expressAdvance();
                  },
                })
              )}
            </div>
            {expContinue(() => expressGo(1), "המשך", () => { setWorkerPaymentMethod(""); expressGo(1); })}
          </>
        );
      case "waccount":
        return (
          <>
            {expEyebrow(<Wallet className="h-4 w-4" />, "חשבון")}
            {expTitle("מאיזה חשבון שולם לעובד?")}
            {accountsList.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">לא הוגדרו חשבונות — אפשר להמשיך בלי שיוך.</p>
                {expContinue()}
              </>
            ) : (
              <div className="grid gap-2">
                {accountsList.map((a, i) =>
                  expCard({
                    key: a.id,
                    badge: i + 1,
                    icon: accountKindIcon(a.kind),
                    title: a.name,
                    sub: getAccountKindLabel(a.kind),
                    selected: workerAccountId === a.id,
                    onClick: () => { setWorkerAccountId(a.id); expressAdvance(); },
                  })
                )}
              </div>
            )}
          </>
        );
      case "review":
      default: {
        const rows: Array<[string, string]> = isWorkerPayment
          ? [
              ["עובד", localUsers.find((u) => u.id === targetUserId)?.label ?? "—"],
              ["תחום", getBusinessDomainLabel(effectiveDomain)],
              ["שעות", sessionDuration || "—"],
              ["עלות עבודה", laborCost ? ils(Number(laborCost)) : suggestedWorkerAmount !== null ? formatIls(suggestedWorkerAmount) : "יחושב"],
              ["תשלום לעובד", workerPaymentChoice === "none" ? "לא שולם" : workerPaymentChoice === "paid" ? "שולם במלואו" : "שולם חלקית"],
            ]
          : installmentsMode
            ? [
                ["סכום", ils(Number(amount) || 0)],
                ["תחום", getBusinessDomainLabel(effectiveDomain)],
                ["קטגוריה", finalCategory || "—"],
                ["פריסה", `${installmentRows.length} תשלומים`],
                ...(installmentRows.some((r) => r.paid)
                  ? ([["שולם כבר", `${installmentRows.filter((r) => r.paid).length} מתוך ${installmentRows.length}`]] as Array<[string, string]>)
                  : []),
              ]
            : [
                ["סכום", ils(Number(amount) || 0)],
                ["תחום", getBusinessDomainLabel(effectiveDomain)],
                ["קטגוריה", finalCategory || "—"],
                ["תאריך", expenseDate || "—"],
                ["סטטוס", paymentStatusLabel(paymentStatus)],
              ];
        return (
          <>
            {expEyebrow(<Check className="h-4 w-4" />, "סיכום")}
            {expTitle("הכול מוכן?", "אפשר לחזור אחורה לתקן")}
            <div className="divide-y rounded-xl border">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <Button type="button" onClick={() => void handleSubmit()} disabled={saving} className="w-full">
                {saving ? (<><Loader2 className="ml-2 h-4 w-4 animate-spin" />שומר...</>) : (<><Check className="ml-2 h-4 w-4" />{isWorkerPayment ? "שמור משמרת" : "שמור הוצאה"}</>)}
              </Button>
            </div>
          </>
        );
      }
    }
  }

  function renderExpress(): ReactNode {
    return (
      <form className="mt-2 flex flex-col" onSubmit={(e) => e.preventDefault()}>
        {/* Back button inline with the progress bar — the bar alone conveys
            progress, so no separate "N / total" counter row is needed. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => expressGo(-1)}
            disabled={expIndex === 0}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-muted disabled:opacity-0"
            aria-label="חזרה"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${expProgress}%` }} />
          </div>
        </div>

        {isSourceLocked ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-xs">
            <LayoutList className="h-3.5 w-3.5 text-muted-foreground" />
            <span>משויך ל: <span className="font-medium text-foreground">{editingSourceLabel ?? (lockedProjectId ? "פרויקט" : lockedOrderId ? "הזמנה" : "נכס")}</span></span>
          </div>
        ) : null}
        {presetTagLabel ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-xs">
            <Car className="h-3.5 w-3.5 text-muted-foreground" />
            <span>משויך לרכב: <span className="font-medium text-foreground">{presetTagLabel}</span></span>
          </div>
        ) : null}

        {/* Fixed-height stage so the dialog doesn't resize between steps; tall
            steps (long worker/category lists) scroll inside this box. */}
        <div key={expStep} className="mt-2 flex h-[min(25rem,64vh)] flex-col [justify-content:safe_center] overflow-y-auto">
          {expressStageContent()}
        </div>

        {errorMessage ? (
          <div role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {errorMessage}
          </div>
        ) : null}
      </form>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <DialogTitle>
                {isEditingSession ? "עריכת שכר עובד" : isEditing ? "עריכת הוצאה" : "הוספת הוצאה"}
              </DialogTitle>
              <DialogDescription className={activeMode === "express" ? "sr-only" : undefined}>
                {isEditingSession
                  ? "עדכון פרטי משמרת העובד."
                  : isEditing
                    ? "עדכון פרטי הוצאה קיימת."
                    : "יצירת הוצאה חדשה."}
              </DialogDescription>
            </div>
            {showModeToggle ? (
              <div className="flex flex-wrap items-center gap-1 self-start rounded-full border bg-muted/40 p-1 sm:flex-none">
                <button
                  type="button"
                  onClick={() => chooseMode("form")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                    activeMode === "form" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Rows3 className="h-3.5 w-3.5" />מסך מלא
                </button>
                <button
                  type="button"
                  onClick={() => chooseMode("express")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
                    activeMode === "express" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <LayoutList className="h-3.5 w-3.5" />שלב אחר שלב
                </button>
              </div>
            ) : null}
          </div>
        </DialogHeader>

        {activeMode === "express" ? renderExpress() : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
        >
          {/* Amount hero — first, like the mockup (normal expenses) */}
          {!isWorkerPayment ? (
            <div className={cn("rounded-xl border p-3 transition-colors", (Number(amount) || 0) > 0 ? "border-success/50 bg-success/5" : "bg-muted/20")}>
              <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" />סכום ההוצאה <span className="text-destructive">*</span>
              </div>
              <div className="mt-2">
                <CurrencyInput type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="h-12 text-2xl font-bold" />
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {(Number(amount) || 0) > 0 ? `סכום: ${ils(Number(amount))}` : "הקלד את הסכום ששולם עבור ההוצאה"}
              </div>
            </div>
          ) : null}

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
                <DomainSelect
                  value={businessDomain}
                  onChange={(value) => {
                    const next = value as ExpenseBusinessDomain | "";
                    setBusinessDomain(next);
                    setProjectId("");
                    setOrderId("");
                    setPropertyId("");
                  }}
                />
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
              disabled={isEditingSession}
              onChange={(e) => {
                setCategory(e.target.value);
                if (e.target.value !== CARS_CATEGORY) setTagIds(presetTagLabel ? tagIds : []);
              }}
            >
              <option value=""></option>
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
                    <option value=""></option>
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
                  <div className="text-sm font-medium">עלות עבודה{sessionPriceRequired ? " *" : ""}</div>
                  <CurrencyInput value={laborCost} onChange={(e) => setLaborCost(e.target.value)} />
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

              {WORKER_BILLABLE_DOMAINS.includes(effectiveDomain) ? (
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
                  {isEditingSession && existingWorkerPaidAmount > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      שולם עד עכשיו: {formatIls(existingWorkerPaidAmount)} — תשלום חדש נרשם כתוספת בלבד.
                    </div>
                  ) : null}
                  {workerPaymentChoice !== "none" ? (
                    <>
                      <div className="space-y-1">
                        <div className="text-sm font-medium">כמה שולם</div>
                        <CurrencyInput
                          value={workerPaymentChoice === "paid" ? String(suggestedWorkerAmount ?? workerPaidAmount) : workerPaidAmount}
                          readOnly={workerPaymentChoice === "paid"}
                          onChange={(e) => setWorkerPaidAmount(e.target.value)}
                          placeholder={workerPaymentChoice === "paid" ? "מחושב אוטומטית" : "למשל 300"}
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="text-sm font-medium">אמצעי תשלום</div>
                        <select
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={workerPaymentMethod}
                          onChange={(e) => {
                            const m = e.target.value;
                            setWorkerPaymentMethod(m);
                            setWorkerAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
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
              <div className="space-y-1">
                <div className="text-sm font-medium">תאריך</div>
                <DateInput value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
              </div>

              {/* Installments toggle — split into N dated payments (new expenses only) */}
              {!isEditing ? (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors",
                    installmentsMode ? "border-primary bg-primary/5" : "hover:border-primary/60"
                  )}
                >
                  <span className={cn("flex h-8 w-8 flex-none items-center justify-center rounded-lg transition-colors", installmentsMode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    <Split className="h-4 w-4" />
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold">פריסה לתשלומים</span>
                    <span className="block text-xs text-muted-foreground">חלוקת ההוצאה למספר תשלומים חודשיים</span>
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={installmentsMode}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setInstallmentsMode(on);
                      if (on) {
                        const total = Number(amount);
                        setInstallmentRows(
                          buildInstallmentRows(
                            Number.isFinite(total) && total > 0 ? total : 0,
                            expenseDate || new Date().toISOString().slice(0, 10),
                            2
                          )
                        );
                      }
                    }}
                  />
                  <span className={cn("relative h-6 w-11 flex-none rounded-full transition-colors", installmentsMode ? "bg-primary" : "bg-muted-foreground/30")}>
                    <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", installmentsMode ? "right-0.5" : "right-[22px]")} />
                  </span>
                </label>
              ) : null}

              {installmentsMode ? (
                <InstallmentFields
                  total={Number(amount) || 0}
                  startDate={expenseDate || new Date().toISOString().slice(0, 10)}
                  rows={installmentRows}
                  onChange={setInstallmentRows}
                />
              ) : null}

              {installmentsMode && installmentRows.some((r) => r.paid) ? (
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
                </div>
              ) : null}

              {/* Payment Status */}
              {!installmentsMode ? (
              <>
              <div className="flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-bold tracking-wider text-muted-foreground">תשלום</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">סטטוס תשלום</div>
                <div className="grid grid-cols-3 gap-2">
                  {(["paid", "partial", "not_paid"] as const).map((s) => {
                    const on = paymentStatus === s;
                    const dot = s === "paid" ? "bg-success" : s === "partial" ? "bg-warning" : "bg-destructive";
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setPaymentStatus(s)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors",
                          on
                            ? s === "paid"
                              ? "border-success bg-success/10 text-success"
                              : s === "partial"
                                ? "border-warning bg-warning/15 text-warning-strong"
                                : "border-destructive bg-destructive/10 text-destructive"
                            : "border-input bg-background text-muted-foreground hover:bg-muted/40"
                        )}
                      >
                        <span className={cn("h-2.5 w-2.5 rounded-full transition-colors", on ? dot : "bg-muted-foreground/30")} />
                        {paymentStatusLabel(s)}
                      </button>
                    );
                  })}
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
              </>
              ) : null}

              {/* Description */}
              <div className="flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-bold tracking-wider text-muted-foreground">פרטים</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">תיאור</div>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="על מה ההוצאה? לדוגמה: חומרי ניקוי לרבעון" />
              </div>

              {/* Project billing options */}
              {!installmentsMode && showBillingOptions && (
                <div className="flex flex-col gap-2 rounded-xl border px-3 py-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={includedInBasePrice} onChange={(e) => setIncludedInBasePrice(e.target.checked)} />
                    <span>כלול במחיר הבסיס</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={billedToCustomer}
                      onChange={(e) => setBilledToCustomer(e.target.checked)}
                    />
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
                <div className="space-y-2">
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
                  <div className="flex flex-wrap gap-2">
                    {existingAttachments
                      .filter((att) => att.url && isImageAttachment(att))
                      .map((att) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={`${att.document_id}-preview`}
                          src={att.url ?? ""}
                          alt={att.file_name ?? "קובץ"}
                          className="h-20 w-20 rounded-lg border object-cover"
                        />
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
            {!isWorkerPayment ? (
              <div className="me-auto text-sm text-muted-foreground">
                סה״כ: <b className="font-bold tabular-nums text-foreground">{ils(Number(amount) || 0)}</b>
              </div>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
              ביטול
            </Button>
            <Button type="submit" disabled={saving}>
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
        )}
      </AdaptiveDialog>
    </Dialog>
  );
}
