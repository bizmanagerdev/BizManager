"use client";

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BackspaceIcon, BankIcon, CardIcon, CashIcon, RecurringIcon, SpinnerIcon, SplitIcon, VehicleIcon, WalletIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { StepWizard, WizardTitle } from "@/components/ui/step-wizard";
import { OptionRow, StepHeading } from "@/components/ui/option-row";
import { DIALOG_CHROME_CONTENT_PAGE, useSwipeToDismiss } from "@/components/ui/dialog-chrome";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { TagPicker, fetchExistingTagIds } from "@/components/tags/TagPicker";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FullScreenDialogContent,
} from "@/components/ui/dialog";
import {
  EXPENSE_BUSINESS_DOMAINS,
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_PROPERTY_CATEGORIES,
  EXPENSE_WORKER_WAGE_CATEGORY,
  EXPENSE_OTHER_CATEGORY,
  EXPENSE_CARS_CATEGORY,
  getBusinessDomainLabel,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { getBusinessDomainIcon } from "@/components/financial/DomainSelect";
import { offlineFetch } from "@/lib/offline-queue";
import { registerReversibleCreate } from "@/lib/undo-engine";
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
const PROPERTY_EXPENSE_CATEGORIES = [...EXPENSE_PROPERTY_CATEGORIES];
const KNOWN_CATEGORIES = new Set([WORKER_WAGE_CATEGORY, ...BASE_EXPENSE_CATEGORIES, ...PROPERTY_EXPENSE_CATEGORIES]);
// Domains where a worker session can be billed back to a customer/tenant, so the
// "חיוב הלקוח" section is offered (form + express stay in sync via this list).
const WORKER_BILLABLE_DOMAINS: readonly string[] = ["logistics_projects", "sales", "property_management"];

// Recurrence cadence choices (monthly intervals + yearly). Yearly keeps its own
// month picker; the monthly ones set interval_months.
const RECURRENCE_CHOICES = [
  { key: "m1", label: "כל חודש", frequency: "monthly" as const, interval: 1 },
  { key: "m2", label: "כל חודשיים", frequency: "monthly" as const, interval: 2 },
  { key: "m3", label: "כל 3 חודשים", frequency: "monthly" as const, interval: 3 },
  { key: "m6", label: "כל 6 חודשים", frequency: "monthly" as const, interval: 6 },
  { key: "y", label: "כל שנה", frequency: "yearly" as const, interval: 1 },
] as const;

function recurrenceKeyOf(freq: "monthly" | "yearly", interval: number): string {
  if (freq === "yearly") return "y";
  if (interval >= 6) return "m6";
  if (interval >= 3) return "m3";
  if (interval >= 2) return "m2";
  return "m1";
}

// Hebrew month labels for the yearly-recurring picker.
const MONTH_OPTIONS = [
  { value: "1", label: "ינואר" },
  { value: "2", label: "פברואר" },
  { value: "3", label: "מרץ" },
  { value: "4", label: "אפריל" },
  { value: "5", label: "מאי" },
  { value: "6", label: "יוני" },
  { value: "7", label: "יולי" },
  { value: "8", label: "אוגוסט" },
  { value: "9", label: "ספטמבר" },
  { value: "10", label: "אוקטובר" },
  { value: "11", label: "נובמבר" },
  { value: "12", label: "דצמבר" },
] as const;

// The months an every-N-months bill lands on, starting from the start date's
// month — so the user can see (and shift, by changing the date) whether it's on
// odd months (1,3,5…) or even (2,4,6…).
function occurrenceMonths(startIso: string, interval: number): string[] {
  const startMonth = Number(startIso.slice(5, 7)) || 1;
  const step = Math.max(1, interval);
  const out: string[] = [];
  for (let m = 0; m < 12; m += step) {
    const monthNum = ((startMonth - 1 + m) % 12) + 1;
    out.push(MONTH_OPTIONS.find((x) => x.value === String(monthNum))?.label ?? "");
  }
  return out;
}

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

// Edit mode for a RECURRING EXPENSE TEMPLATE (the הוצאות קבועות tab). Turns the
// dialog into a template editor: recurring is forced on, and the schedule/name/
// active fields hydrate from the template. Structurally a subset of
// RecurringExpenseTemplateItem, so that item can be passed directly.
export type EditingRecurringTemplateData = {
  id: string;
  template_name: string | null;
  category: string | null;
  amount: number | string | null;
  is_variable_amount: boolean;
  auto_paid?: boolean;
  reminder_work_days_before?: number | null;
  description_template: string | null;
  notes_template: string | null;
  business_domain: string | null;
  project_id: string | null;
  order_id: string | null;
  property_id: string | null;
  account_id: string | null;
  included_in_base_price: boolean;
  billed_to_customer: boolean;
  project_expense_notes_template: string | null;
  frequency: "monthly" | "yearly";
  interval_months: number;
  expense_day_of_month: number;
  expense_month_of_year: number | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
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
  // Edit mode for a recurring-expense TEMPLATE (forces recurring on + hydrates it).
  editingRecurringTemplate?: EditingRecurringTemplateData | null;
  // Open a NEW expense with recurring pre-selected (e.g. the הוצאות קבועות tab's
  // "new" button, where no date is supplied and the user picks one).
  defaultRecurring?: boolean;
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

  // Prefill the expense date for a NEW expense (e.g. a day clicked on the
  // payments calendar). Falls back to today when omitted.
  defaultDate?: string;

  // Default category for a NEW expense (e.g. "רכבים" from a car's page).
  defaultCategory?: string;
  // Pre-select the account the money leaves from (opened from that account's
  // page on /financial/bank). Only applies to a NEW expense.
  defaultAccountId?: string;
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
  if (kind === "bank") return <BankIcon className="h-4 w-4" />;
  if (kind === "card") return <CardIcon className="h-4 w-4" />;
  return <CashIcon className="h-4 w-4" />;
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
  editingRecurringTemplate,
  defaultRecurring = false,
  editingSourceLabel,
  lockedProjectId,
  lockedOrderId,
  lockedPropertyId,
  recurringProjects = [],
  recurringOrders = [],
  recurringProperties = [],
  showAttachments = false,
  defaultDate,
  defaultCategory,
  defaultAccountId,
  presetTagIds,
  presetTagLabel,
  users,
  salaryAgreements = [],
  currentUserId,
  currentUserRole,
  onSaved,
}: Props) {
  const router = useRouter();
  const isEditingSession = Boolean(editingSession);
  const isEditingTemplate = Boolean(editingRecurringTemplate);
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
  // Recurring ("חוזר"): turn this NEW expense into a recurring template instead of
  // a one-off row. The chosen expense date supplies the day-of-month (and, for
  // yearly, the default month) + the template start date. Mutually exclusive with
  // installments and only offered for a new, non-worker expense.
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurFrequency, setRecurFrequency] = useState<"monthly" | "yearly">("monthly");
  const [recurInterval, setRecurInterval] = useState(1); // monthly: every N months (1/2/3/6)
  const [recurMonth, setRecurMonth] = useState(""); // yearly: month it recurs, "1".."12"
  const [recurEndDate, setRecurEndDate] = useState("");
  // Recurring template extras (parity with the old bespoke template form).
  const [templateName, setTemplateName] = useState(""); // optional; defaults to description/category
  const [recurActive, setRecurActive] = useState(true); // is_active (template edit)
  // Editing a template's amount: what happens to the rows it ALREADY generated.
  // Default "unpaid" — a bill that hasn't been paid yet should follow the new
  // price; one that was already paid recorded real money and is left alone.
  const [amountPropagation, setAmountPropagation] = useState<"unpaid" | "none" | "all">("unpaid");
  // The amount box now holds something other than what the template was saved
  // with — the only case where the propagation choice below means anything.
  const templateAmountChanged = (() => {
    if (!isEditingTemplate) return false;
    const next = Number(amount);
    const prev = Number(editingRecurringTemplate?.amount);
    return Number.isFinite(next) && Number.isFinite(prev) && next !== prev;
  })();
  const [projectNotesTemplate, setProjectNotesTemplate] = useState(""); // project domain only
  const [recurVariable, setRecurVariable] = useState(false); // amount known only at pay time (taxes)
  const [recurAutoPaid, setRecurAutoPaid] = useState(false); // bank standing order (הוראת קבע) → auto-marked paid
  const [recurReminderDays, setRecurReminderDays] = useState(""); // monthly reminder: N work-days before ("" = off)
  const [billToCustomerAmount, setBillToCustomerAmount] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<FinancialAttachment[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);

  // "" is a sentinel that isn't any step id → the index clamps to 0, so the flow
  // always opens on the FIRST step of the current express list (which is no longer
  // always "amount" now that steps are grouped).
  const [expStepId, setExpStepId] = useState<string>("");
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
  // Worker step tabs, matching the existing/new pattern used to add a customer
  // from the order/project wizards — "new" replaces the old inline reveal so
  // the create form doesn't collapse (and lose what was typed) when a card list
  // re-renders.
  const [workerTab, setWorkerTab] = useState<"existing" | "new">("existing");
  const [newWorkerSubmitting, setNewWorkerSubmitting] = useState(false);
  const [newWorkerError, setNewWorkerError] = useState<string | null>(null);
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerPhone, setNewWorkerPhone] = useState("");

  useEffect(() => {
    if (Array.isArray(users)) setLocalUsers(users);
  }, [users]);

  const workerSupport = Array.isArray(users);
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
  const categoryOptions = workerSupport
    ? [WORKER_WAGE_CATEGORY, ...BASE_EXPENSE_CATEGORIES]
    : effectiveDomain === "property_management"
      ? [...PROPERTY_EXPENSE_CATEGORIES, ...BASE_EXPENSE_CATEGORIES]
      : BASE_EXPENSE_CATEGORIES;
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
    if (editingRecurringTemplate) {
      const t = editingRecurringTemplate;
      const rawAmt = t.amount;
      setAmount(rawAmt != null ? String(rawAmt) : "");
      // Seed the date so its DAY = the template's expense day (its month/year come
      // from the start date when present, else the current month). The chosen date
      // drives day-of-month + start_date on save (create-day = expense-day).
      const day = Number(t.expense_day_of_month) || 1;
      const baseYm = t.start_date && /^\d{4}-\d{2}/.test(t.start_date) ? t.start_date.slice(0, 7) : todayIso().slice(0, 7);
      const [by, bm] = baseYm.split("-").map(Number);
      const lastDay = new Date(by, bm, 0).getDate();
      const clampedDay = Math.min(Math.max(1, day), lastDay);
      setExpenseDate(`${baseYm}-${String(clampedDay).padStart(2, "0")}`);
      setPaymentStatus("paid");
      setPaidAmount("");
      setPaymentMethod("");
      setAccountId(typeof t.account_id === "string" ? t.account_id : "");
      const cat = t.category ?? "";
      if (cat && KNOWN_CATEGORIES.has(cat)) {
        setCategory(cat);
        setCategoryOther("");
      } else {
        setCategory(cat ? OTHER_CATEGORY : "");
        setCategoryOther(cat);
      }
      setDescription(t.description_template ?? "");
      setNotes(t.notes_template ?? "");
      setBusinessDomain(
        t.business_domain && (EXPENSE_BUSINESS_DOMAINS as readonly string[]).includes(t.business_domain)
          ? (t.business_domain as ExpenseBusinessDomain)
          : ""
      );
      setProjectId(t.project_id ?? "");
      setOrderId(t.order_id ?? "");
      setPropertyId(t.property_id ?? "");
      setIncludedInBasePrice(Boolean(t.included_in_base_price));
      setBilledToCustomer(Boolean(t.billed_to_customer));
      setBillToCustomerAmount("");
      setExistingAttachments([]);
      setTagIds([]);
    } else if (editingExpense) {
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
      // Only meaningful when the source isn't locked (see isSourceLocked) — a
      // locked edit shows these read-only instead — but harmless to always set:
      // the project/order/property picker below is what actually reads them.
      setProjectId(editingExpense.project_id ?? "");
      setOrderId(editingExpense.order_id ?? "");
      setPropertyId(editingExpense.property_id ?? "");
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
      setExpenseDate(defaultDate || todayIso());
      setPaymentStatus("paid");
      setPaidAmount("");
      setPaymentMethod("");
      setAccountId(defaultAccountId ?? "");
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
    setIsRecurring(false);
    setRecurFrequency("monthly");
    setRecurInterval(1);
    setRecurMonth("");
    setRecurEndDate("");
    setTemplateName("");
    setRecurActive(true);
    setProjectNotesTemplate("");
    setRecurVariable(false);
    setRecurAutoPaid(false);
    setRecurReminderDays("");
    setAmountPropagation("unpaid");
    // Recurring override: template edit forces recurring on + hydrates its schedule;
    // a NEW expense opened with defaultRecurring starts on the recurring path.
    if (editingRecurringTemplate) {
      const t = editingRecurringTemplate;
      setIsRecurring(true);
      setRecurFrequency(t.frequency === "yearly" ? "yearly" : "monthly");
      setRecurInterval(Math.max(1, Number(t.interval_months) || 1));
      setRecurMonth(t.expense_month_of_year ? String(t.expense_month_of_year) : "");
      setRecurEndDate(t.end_date ?? "");
      setTemplateName(t.template_name ?? "");
      setRecurActive(t.is_active !== false);
      setProjectNotesTemplate(t.project_expense_notes_template ?? "");
      setRecurVariable(t.is_variable_amount === true);
      setRecurAutoPaid(t.auto_paid === true);
      setRecurReminderDays(t.reminder_work_days_before ? String(t.reminder_work_days_before) : "");
    } else if (defaultRecurring) {
      setIsRecurring(true);
    }
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
    setWorkerTab("existing");
    setNewWorkerError(null);
    setNewWorkerName("");
    setNewWorkerPhone("");
    setAttachmentFiles([]);
    setErrorMessage("");
    setExpStepId("");
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
        user?: {
          id?: string;
          full_name?: string | null;
          email?: string | null;
          role?: UserRole;
          payroll_worker_type?: PayrollWorkerType | null;
          pay_tracking_mode?: string | null;
        };
      };
      const created = json.user;
      if (!res.ok || !created?.id) {
        setNewWorkerError(toHebrewError(json.error, "שגיאה ביצירת עובד."));
        return;
      }
      const label = created.full_name?.trim() || created.email?.trim() || "עובד חדש";
      setLocalUsers((current) => [
        {
          id: created.id ?? "",
          label,
          role: created.role ?? "worker_no_access",
          payroll_worker_type: created.payroll_worker_type ?? "session_only",
          pay_tracking_mode: created.pay_tracking_mode ?? "session",
        },
        ...current.filter((u) => u.id !== created.id),
      ]);
      setWorkerUserId(created.id);
      setWorkerTab("existing");
      setNewWorkerName("");
      setNewWorkerPhone("");
      toast.success("העובד נוסף ונבחר.");
      // Express: behave exactly like picking an existing worker card — move on.
      if (activeMode === "express") expressAdvance();
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

  // Recurring → save a recurring_expense_template instead of a one-off expense.
  // The generator (generate_recurring_expenses_for_date) then materializes a
  // not_paid expense each period; the account/domain/link carry through.
  async function submitRecurring(amountNumber: number) {
    const startDate = expenseDate || todayIso();
    const day = Number(startDate.slice(8, 10)) || 1;
    const monthOfYear =
      recurFrequency === "yearly"
        ? Number(recurMonth) || Number(startDate.slice(5, 7)) || 1
        : null;
    setSaving(true);
    try {
      const res = await fetch("/api/recurring-expenses/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editingRecurringTemplate?.id ?? undefined,
          template_name: templateName.trim() || finalCategory,
          category: finalCategory,
          // For a variable bill this is the ESTIMATE (base) used for planning; the
          // real amount is captured when it's paid.
          amount: amountNumber,
          is_variable_amount: recurVariable,
          auto_paid: recurAutoPaid && !recurVariable,
          reminder_work_days_before: recurReminderDays ? Number(recurReminderDays) : null,
          description_template: description.trim() || null,
          notes_template: notes.trim() || null,
          business_domain: effectiveDomain,
          project_id: effectiveProjectId || null,
          order_id: effectiveOrderId || null,
          property_id: effectivePropertyId || null,
          account_id: accountId || null,
          included_in_base_price: showBillingOptions ? includedInBasePrice : false,
          billed_to_customer: showBillingOptions ? billedToCustomer : false,
          project_expense_notes_template: showBillingOptions ? (projectNotesTemplate.trim() || null) : null,
          frequency: recurFrequency,
          interval_months: recurFrequency === "yearly" ? 1 : recurInterval,
          create_day_of_month: day,
          expense_day_of_month: day,
          create_month_of_year: monthOfYear,
          expense_month_of_year: monthOfYear,
          start_date: startDate,
          end_date: recurEndDate || null,
          is_active: isEditingTemplate ? recurActive : true,
          // Only meaningful when the amount actually changed on an existing template.
          amount_propagation: templateAmountChanged ? amountPropagation : "none",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        repricedCount?: number;
        generatedCount?: number;
      };
      if (!res.ok) {
        const msg = toHebrewError(json.error, "שמירת ההוצאה הקבועה נכשלה.");
        setErrorMessage(msg);
        toast.error("שגיאה בשמירת הוצאה קבועה", { description: msg });
        return;
      }
      const repriced = Number(json.repricedCount) || 0;
      // Say what happened to the existing rows either way — "0 updated" is the
      // answer to "I changed the amount and nothing moved".
      const repriceNote =
        !templateAmountChanged || amountPropagation === "none"
          ? undefined
          : repriced > 0
            ? `${repriced} חיובים קיימים עודכנו לסכום החדש.`
            : "לא נמצאו חיובים קיימים לעדכון — הסכום החדש יחול על חיובים חדשים בלבד.";
      const generated = Number(json.generatedCount) || 0;
      toast.success(isEditingTemplate ? "ההוצאה הקבועה עודכנה" : "ההוצאה הקבועה נשמרה ותיווצר בכל תקופה", {
        description: [generated > 0 ? `נוצרו ${generated} חיובים.` : null, repriceNote]
          .filter(Boolean)
          .join(" ") || undefined,
      });
      const savedResult = onSaved({ expenseId: "", sourceType: "expense", expense: {}, projectExpense: null, attachments: [] });
      if (savedResult instanceof Promise) await savedResult;
      onOpenChange(false);
    } catch (error) {
      const msg = toHebrewError(error, "שמירת ההוצאה הקבועה נכשלה.");
      setErrorMessage(msg);
      toast.error("שגיאה בשמירת הוצאה קבועה", { description: msg });
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
    // Variable-amount recurring templates (taxes etc.) have no amount yet.
    const skipAmountCheck = isRecurring && recurVariable;
    if (!skipAmountCheck && (!Number.isFinite(amountNumber) || amountNumber <= 0)) {
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
    // Project stays !isEditing-gated (matches its picker being hidden in edit
    // mode, above) — property does NOT, since its picker is genuinely editable
    // in edit mode now, and this check was the one place that gap survived
    // fixing the render gate (2026-08-27, "look around for more places with
    // this issue" — a user could switch domain to property_management during
    // an edit, leave the (now-visible) picker unset, and hit no client-side
    // validation at all before this fix).
    if (!isEditing && effectiveDomain === "logistics_projects" && !effectiveProjectId) {
      setErrorMessage("יש לבחור פרויקט.");
      toast.error("יש לבחור פרויקט");
      return;
    }
    if (effectiveDomain === "property_management" && !effectivePropertyId) {
      setErrorMessage("יש לבחור נכס.");
      toast.error("יש לבחור נכס");
      return;
    }

    // Recurring → save a template instead of a one-off (or installments) expense.
    if (isRecurring) {
      await submitRecurring(amountNumber);
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
      if (isEditing) {
        toast.success("ההוצאה עודכנה");
      } else if (expenseId) {
        // Undo = a real reverse delete call, not a deferred commit — this create
        // already went through (attachments needed the real server id to upload
        // to), so "undo" replays the existing delete path instead of holding
        // anything back.
        const undoProjectId = effectiveProjectId || undefined;
        const undoOrderId = effectiveOrderId || undefined;
        const undoPropertyId = effectivePropertyId || undefined;
        registerReversibleCreate({
          scope: "expense",
          id: expenseId,
          message: "ההוצאה נוספה",
          onUndo: async () => {
            const res = await fetch("/api/expenses/delete", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                id: expenseId,
                project_id: undoProjectId,
                order_id: undoOrderId,
                property_id: undoPropertyId,
              }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "ביטול נכשל.") };
            router.refresh();
            return { ok: true };
          },
        });
      }
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
  // Always on for a NEW expense — the form/express toggle is gone (user request,
  // 2026-08-25). EDITING (an expense, a session, or a recurring template) always
  // uses the full form: express has never been exercised against an edit and is
  // missing edit-only pieces (a category lock for session edits, plus template-only
  // controls — active toggle, amount-propagation choice, project notes), so
  // widening it to cover edits too is future work, not this change.
  const activeMode: "form" | "express" = isEditing || isEditingTemplate ? "form" : "express";

  const needsSourcePicker =
    !isEditing &&
    !isSourceLocked &&
    (effectiveDomain === "logistics_projects" ||
      (effectiveDomain === "sales" && recurringOrders.length > 0) ||
      effectiveDomain === "property_management");

  // "חוזר" (recurring) is offered only for a NEW, non-worker expense. Turning it
  // on saves a recurring template instead of a one-off; it's mutually exclusive
  // with installments.
  const canRecur = !isEditing && !isWorkerPayment;

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
    // Steps are GROUPED by theme so related screens stay together:
    //   WHAT IS IT (domain → category → name → description)
    //   → WHEN (schedule)
    //   → HOW MUCH (all the money screens in one run)
    //   → details (notes, files) → review.
    // Same shape for one-time and recurring, so money never gets scattered.
    // Amount opens the flow (quick capture) — the rest is grouped by theme.
    const s: string[] = ["amount"];

    // — What is it — classification + identity
    if (!isSourceLocked) s.push("domain");
    if (needsSourcePicker) s.push("source");
    if (effectiveDomain) s.push("category");
    if (category === OTHER_CATEGORY) s.push("otherCategory");
    if (finalCategory === CARS_CATEGORY && !presetTagLabel) s.push("tags");
    s.push("description");
    // One-time vs recurring: the choice reshapes the rest of the flow. Hidden when
    // the entry point already fixes it (template edit, or the "new recurring" creator).
    // Kept BEFORE every isRecurring-dependent step so switching adds them AHEAD.
    if (canRecur && !isEditingTemplate && !defaultRecurring) s.push("recurrence");
    if (isRecurring) s.push("recurname"); // the template's name (identity)

    // — When — the schedule
    s.push("date");
    if (isRecurring) {
      s.push("recurfreq");
      if (recurFrequency === "yearly") s.push("recurmonth");
      s.push("recurrange");
      s.push("recurremind");
    }

    // — How much — the rest of the money screens (amount was captured first)
    if (isRecurring) {
      s.push("recurvariable");
      s.push("account");
      // Fixed-amount bills can be a bank standing order (auto-paid); variable can't.
      if (!recurVariable) s.push("recurpay");
      if (showBillingOptions) s.push("billing");
    } else {
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
    }

    // — Details —
    s.push("notes");
    if (showAttachments) s.push("files");
    s.push("review");
    return s;
  }, [
    isSourceLocked, needsSourcePicker, effectiveDomain, category, isWorkerPayment,
    finalCategory, presetTagLabel, paymentStatus, isEditing, installmentsMode,
    showBillingOptions, showAttachments, canManageWorkerSessions,
    showSessionTimingFields, showSessionPriceField, selectedWorkerType,
    workerPaymentChoice, installmentRows, canRecur, isRecurring, recurFrequency,
    isEditingTemplate, recurVariable, defaultRecurring,
  ]);

  const rawIndex = expressSteps.indexOf(expStepId);
  const expIndex = rawIndex < 0 ? 0 : rawIndex;
  const expStep = expressSteps[expIndex];
  // Progress bar % is StepWizard's own job now (progressVariant="bar" derives
  // it from stepNumber/steps.length) — this file no longer computes it.

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
    // Only while THIS dialog is actually open. Otherwise a mounted-but-closed
    // ExpenseDialog (e.g. the project page's "add project expense" dialog,
    // which defaults to express/amount) would keep this global window listener
    // attached and swallow every digit keypress across the whole page —
    // breaking unrelated number fields (base price, etc.) while letters passed.
    if (!open || activeMode !== "express") return;
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName ?? "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (expStep === "amount" || expStep === "paidamt") {
        const setter = expStep === "amount" ? setAmount : setPaidAmount;
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setter((c) => applyKey(c, e.key)); return; }
        if (e.key === ".") { e.preventDefault(); setter((c) => applyKey(c, ".")); return; }
        if (e.key === "Backspace") { e.preventDefault(); setter((c) => applyKey(c, "del")); return; }
        if (e.key === "Enter") {
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
  }, [open, activeMode, expStep, expressSteps, amount]);

  // Both delegate entirely to the same shared components Income/CollectPayment
  // use (components/ui/option-row.tsx) — kept as thin wrappers, not re-copied
  // markup, so this dialog's ~65 call sites didn't need to change shape.
  function expTitle(title: string, sub?: string) {
    return <StepHeading title={title} sub={sub} />;
  }
  function expCard(o: {
    key?: string; icon?: ReactNode; title: string; sub?: string; selected?: boolean;
    tone?: "brand" | "paid" | "partial" | "unpaid"; badge?: number; onClick: () => void;
  }) {
    return (
      <OptionRow
        key={o.key}
        data-exp-option
        icon={o.icon}
        label={o.title}
        sub={o.sub}
        selected={Boolean(o.selected)}
        tone={o.tone}
        badge={o.badge}
        onClick={o.onClick}
      />
    );
  }
  // Digit grid only — the confirm action lives in the pinned nav bar at the
  // bottom of the dialog (one "המשך" button per step, not one per widget).
  function expKeypad(setter: (updater: (c: string) => string) => void) {
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
        <button type="button" onClick={() => tap("del")} className={keyCls} aria-label="מחק"><BackspaceIcon className="h-5 w-5" /></button>
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
  // One pinned nav bar handles EVERY step's forward action (see renderExpress).
  // A step only needs an entry here when it must block/skip that default —
  // pure-selection steps (cards that auto-advance on click) need nothing.
  function stepNavConfig(step: string): { disabled?: boolean; skip?: () => void } {
    switch (step) {
      case "otherCategory":
        return { disabled: !categoryOther.trim() };
      case "method":
        return { skip: () => { setPaymentMethod(""); expressGo(1); } };
      case "worker":
        return { disabled: workerTab === "new" || !workerUserId };
      case "wtiming":
        return {
          disabled: !(Boolean(toIso(clockIn)) && Boolean(toIso(clockOut)) && new Date(toIso(clockOut)) > new Date(toIso(clockIn))),
        };
      case "wlabor":
        return { disabled: sessionPriceRequired && !(Number(laborCost) > 0) };
      case "wpayment":
        return { disabled: workerPaymentChoice === "partial" && !(Number(workerPaidAmount) > 0) };
      case "wmethod":
        return { skip: () => { setWorkerPaymentMethod(""); expressGo(1); } };
      default:
        return {};
    }
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
            {expTitle("כמה עלתה ההוצאה?", "אפשר להשאיר 0 ולקבוע אחר כך")}
            {expAmountHero(amount)}
            {/* Allow proceeding at 0 — a recurring bill whose amount changes each
                time (mortgage/CC) keeps this as an ESTIMATE for planning; the real
                amount is entered when it's paid. One-offs must have a real amount. */}
            {expKeypad(setAmount)}
          </>
        );
      case "domain":
        return (
          <>
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
              {expTitle("לאיזה פרויקט לשייך?")}
              {recurringProjects.length === 0 ? (
                <div className="rounded-xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                  אין פרויקטים זמינים — יש להוסיף פרויקט תחילה.
                </div>
              ) : (
                <>
                  {searchBox("חיפוש פרויקט...")}
                  <div className="grid gap-2">
                    {list.map((p, i) =>
                      expCard({ key: p.id, badge: i + 1, title: p.label, selected: projectId === p.id, onClick: () => { setProjectId(p.id); expressAdvance(); } })
                    )}
                  </div>
                </>
              )}
            </>
          );
        }
        if (effectiveDomain === "sales") {
          const list = recurringOrders.filter((o) => o.label.toLowerCase().includes(q));
          return (
            <>
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
            {expTitle("לאיזה נכס לשייך?")}
            {recurringProperties.length === 0 ? (
              <div className="rounded-xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                אין נכסים זמינים — יש להוסיף נכס תחילה.
              </div>
            ) : (
              <>
                {searchBox("חיפוש נכס...")}
                <div className="grid gap-2">
                  {list.map((p, i) =>
                    expCard({ key: p.id, badge: i + 1, title: p.label, selected: propertyId === p.id, onClick: () => { setPropertyId(p.id); expressAdvance(); } })
                  )}
                </div>
              </>
            )}
          </>
        );
      }
      case "category": {
        return (
          <>
            {expTitle("איזו קטגוריה?", isRecurring ? "לסיווג ולדוחות — לא השם שיוצג" : "קטגוריות מתוך התחום שבחרת")}
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
            {expTitle("איזו קטגוריה?")}
            <Input value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} autoFocus />
          </>
        );
      case "tags":
        return (
          <>
            {expTitle("לשייך לרכב?", "אפשר לדלג")}
            <TagPicker value={tagIds} onChange={setTagIds} />
          </>
        );
      case "date":
        return (
          <>
            {expTitle(isRecurring ? "ממתי מתחיל?" : "מתי בוצעה ההוצאה?", isRecurring ? "התאריך שממנו נספרים החיובים (וקובע את יום החיוב)" : undefined)}
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
          </>
        );
      case "recurrence":
        return (
          <>
            {expTitle("הוצאה חד-פעמית או חוזרת?", "חוזרת = תיווצר אוטומטית בכל תקופה")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {expCard({ badge: 1, icon: <WalletIcon className="h-4 w-4" />, title: "חד-פעמי", sub: "הוצאה אחת בתאריך שנבחר", selected: !isRecurring, onClick: () => { setIsRecurring(false); expressAdvance(); } })}
              {expCard({
                badge: 2,
                icon: <RecurringIcon className="h-4 w-4" />,
                title: "חוזר",
                sub: "כל חודש או כל שנה",
                selected: isRecurring,
                onClick: () => {
                  setIsRecurring(true);
                  setInstallmentsMode(false);
                  if (!recurMonth) setRecurMonth(String(Number((expenseDate || todayIso()).slice(5, 7)) || 1));
                  expressAdvance();
                },
              })}
            </div>
          </>
        );
      case "recurfreq": {
        const currentKey = recurrenceKeyOf(recurFrequency, recurInterval);
        return (
          <>
            {expTitle("כל כמה זמן חוזרת ההוצאה?")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {RECURRENCE_CHOICES.map((c, i) =>
                expCard({
                  key: c.key,
                  badge: i + 1,
                  title: c.label,
                  selected: currentKey === c.key,
                  onClick: () => {
                    setRecurFrequency(c.frequency);
                    setRecurInterval(c.interval);
                    if (c.frequency === "yearly" && !recurMonth) {
                      setRecurMonth(String(Number((expenseDate || todayIso()).slice(5, 7)) || 1));
                    }
                    expressAdvance();
                  },
                })
              )}
            </div>
          </>
        );
      }
      case "recurmonth":
        return (
          <>
            {expTitle("באיזה חודש?")}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MONTH_OPTIONS.map((m, i) =>
                expCard({ key: m.value, badge: i + 1, title: m.label, selected: recurMonth === m.value, onClick: () => { setRecurMonth(m.value); expressAdvance(); } })
              )}
            </div>
          </>
        );
      case "recurname": {
        const derivedName = finalCategory || description.trim() || "הוצאה קבועה";
        return (
          <>
            {expTitle("איך לקרוא להוצאה הקבועה?", "השם שיופיע ברשימת ההוצאות הקבועות")}
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={derivedName} autoFocus />
            <div className="mt-1.5 text-center text-xs text-muted-foreground">
              שם שיוצג: <span className="font-medium text-foreground">{templateName.trim() || derivedName}</span>
            </div>
          </>
        );
      }
      case "recurvariable":
        return (
          <>
            {expTitle("הסכום קבוע או משתנה?", "משתנה = ייקבע בעת התשלום, כמו מס")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {expCard({ badge: 1, title: "סכום קבוע", sub: Number(amount) > 0 ? ils(Number(amount)) : undefined, selected: !recurVariable, onClick: () => { setRecurVariable(false); expressAdvance(); } })}
              {expCard({ badge: 2, title: "סכום משתנה", sub: Number(amount) > 0 ? `הערכה ${ils(Number(amount))} · הסופי בתשלום` : "הזינו הערכה למעלה · הסופי בתשלום", selected: recurVariable, onClick: () => { setRecurVariable(true); setRecurAutoPaid(false); expressAdvance(); } })}
            </div>
          </>
        );
      case "recurremind":
        return (
          <>
            {expTitle("תזכורת חודשית לפני התשלום?", "כמה ימי עבודה לפני — שישי/שבת לא נספרים")}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {([["ללא", ""], ["יום 1", "1"], ["2 ימים", "2"], ["3 ימים", "3"], ["5 ימים", "5"]] as const).map(([label, val]) =>
                expCard({ key: val || "none", title: label, selected: recurReminderDays === val, onClick: () => { setRecurReminderDays(val); expressAdvance(); } })
              )}
            </div>
          </>
        );
      case "recurpay":
        return (
          <>
            {expTitle("איך משלמים?", "הוראת קבע = ייחשב כשולם אוטומטית ביום החיוב")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {expCard({ badge: 1, title: "אישור ידני", sub: "יופיע ביומן לאישור תשלום", selected: !recurAutoPaid, onClick: () => { setRecurAutoPaid(false); expressAdvance(); } })}
              {expCard({ badge: 2, title: "הוראת קבע", sub: "יסומן כשולם אוטומטית", selected: recurAutoPaid, onClick: () => { setRecurAutoPaid(true); expressAdvance(); } })}
            </div>
          </>
        );
      case "recurrange":
        return (
          <>
            {expTitle("עד מתי?", "אפשר לדלג — ימשיך ללא הגבלה")}
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך סיום (לא חובה)</div>
              <DateInput value={recurEndDate} onChange={(e) => setRecurEndDate(e.target.value)} />
            </div>
            {recurFrequency === "monthly" && recurInterval > 1 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                יחול בחודשים: <span className="font-medium text-foreground">{occurrenceMonths(expenseDate || todayIso(), recurInterval).join(" · ")}</span>
              </p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              {recurFrequency === "yearly"
                ? `ייווצר בכל שנה ב-${Number((expenseDate || todayIso()).slice(8, 10)) || 1}/${MONTH_OPTIONS.find((m) => m.value === (recurMonth || String(Number((expenseDate || todayIso()).slice(5, 7)))))?.label ?? ""}.`
                : recurInterval > 1
                  ? `ייווצר כל ${recurInterval} חודשים ביום ${Number((expenseDate || todayIso()).slice(8, 10)) || 1}.`
                  : `ייווצר בכל חודש ביום ${Number((expenseDate || todayIso()).slice(8, 10)) || 1}.`}
            </p>
          </>
        );
      case "status":
        return (
          <>
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
            {expTitle("כמה שולם עד כה?", `מתוך ${ils(Number(amount) || 0)}`)}
            {expAmountHero(paidAmount)}
            {expKeypad(setPaidAmount)}
          </>
        );
      case "method":
        return (
          <>
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
          </>
        );
      case "account":
        return (
          <>
            {expTitle("מאיזה חשבון?")}
            {accountsList.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">לא הוגדרו חשבונות — אפשר להמשיך בלי שיוך.</p>
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
            {expTitle("תשלום אחד או פריסה?")}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {expCard({ badge: 1, icon: <WalletIcon className="h-4 w-4" />, title: "תשלום אחד", selected: !installmentsMode, onClick: () => { setInstallmentsMode(false); expressAdvance(); } })}
              {expCard({
                badge: 2,
                icon: <SplitIcon className="h-4 w-4" />,
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
            {expTitle("לכמה תשלומים לפרוס?")}
            <InstallmentFields
              total={Number(amount) || 0}
              startDate={expenseDate || todayIso()}
              rows={installmentRows}
              onChange={setInstallmentRows}
            />
          </>
        );
      case "billing":
        return (
          <>
            {expTitle("שיוך לפרויקט")}
            <div className="grid gap-2">
              {expCard({ badge: 1, title: "לחיוב לקוח", sub: "ההוצאה תתווסף לחיוב הלקוח", selected: billedToCustomer, onClick: () => { setBilledToCustomer(true); setIncludedInBasePrice(false); expressAdvance(); } })}
              {expCard({ badge: 2, title: "כלול במחיר הבסיס", sub: "ההוצאה מכוסה במחיר הפרויקט", selected: includedInBasePrice, onClick: () => { setIncludedInBasePrice(true); setBilledToCustomer(false); expressAdvance(); } })}
            </div>
          </>
        );
      case "description": {
        // A recurring template already has a name + category; the description is
        // just optional extra detail — don't suggest the category (that's what led
        // to name = category = description all being the same).
        const sugg = isRecurring ? [] : [finalCategory || "הוצאה שוטפת", "תשלום לספק", "רכישה חד-פעמית"].filter(Boolean);
        return (
          <>
            {expTitle(isRecurring ? "פירוט נוסף?" : "על מה ההוצאה?", isRecurring ? "לא חובה — השם כבר מזהה את התבנית" : "בחרו הצעה או כתבו חופשי")}
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
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </>
        );
      }
      case "notes":
        return (
          <>
            {expTitle("הערות פנימיות?", "לא חובה")}
            <div className="relative">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="pe-11" />
              <DictateButton
                onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
                className="absolute bottom-1 end-1 h-8 w-8"
              />
            </div>
          </>
        );
      case "files":
        return (
          <>
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
          </>
        );
      case "worker":
        return (
          <>
            {expTitle("מי העובד?")}
            <div className="mb-3 inline-flex self-center rounded-2xl border border-border/60 bg-background/70 p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setWorkerTab("existing")}
                className={cn(
                  "rounded-xl px-4 py-1.5 text-sm font-medium transition-colors",
                  workerTab === "existing" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                עובד קיים
              </button>
              <button
                type="button"
                onClick={() => setWorkerTab("new")}
                className={cn(
                  "rounded-xl px-4 py-1.5 text-sm font-medium transition-colors",
                  workerTab === "new" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                עובד חדש
              </button>
            </div>
            {workerTab === "new" ? (
              <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
                <Input value={newWorkerName} onChange={(e) => setNewWorkerName(e.target.value)} placeholder="שם עובד" autoFocus />
                <Input value={newWorkerPhone} onChange={(e) => setNewWorkerPhone(e.target.value)} placeholder="טלפון עובד" />
                {newWorkerError ? <div className="text-sm text-destructive">{newWorkerError}</div> : null}
                <Button
                  type="button"
                  onClick={() => void createWorker()}
                  disabled={newWorkerSubmitting || !newWorkerName.trim() || !newWorkerPhone.trim()}
                  className="w-full"
                >
                  {newWorkerSubmitting ? "שומר..." : "הוסף עובד ובחר"}
                </Button>
              </div>
            ) : (
              <>
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
              </>
            )}
          </>
        );
      case "wtiming":
        return (
          <>
            {expTitle("מתי עבד/ה?")}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          </>
        );
      case "wdate":
        return (
          <>
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
          </>
        );
      case "wlabor":
        return (
          <>
            {expTitle(sessionPriceRequired ? "כמה מגיע לעובד?" : "עלות עבודה")}
            <CurrencyInput value={laborCost} onChange={(e) => setLaborCost(e.target.value)} />
            <div className="mt-1.5 text-xs text-muted-foreground">
              {suggestedWorkerAmount !== null
                ? `סה״כ לתשלום עבור המשמרת: ${formatIls(suggestedWorkerAmount)}`
                : "יחושב אוטומטית לפי הסכם השכר אם יישאר ריק."}
            </div>
          </>
        );
      case "wbilling":
        return (
          <>
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
          </>
        );
      case "wpayment":
        return (
          <>
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
              </div>
            ) : null}
          </>
        );
      case "wmethod":
        return (
          <>
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
          </>
        );
      case "waccount":
        return (
          <>
            {expTitle("מאיזה חשבון שולם לעובד?")}
            {accountsList.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">לא הוגדרו חשבונות — אפשר להמשיך בלי שיוך.</p>
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
        // Which project/order/property this expense is being saved to — resolved
        // from the locked context or the source the user picked in express.
        const sourceLabel: [string, string] | null = (() => {
          const labelFor = (type: "project" | "order" | "property") =>
            type === "project" ? "פרויקט" : type === "order" ? "הזמנה" : "נכס";
          if (isSourceLocked) {
            // Without a real name the row would read "פרויקט: פרויקט" — skip it.
            if (!editingSourceLabel) return null;
            const type = lockedProjectId ? "project" : lockedOrderId ? "order" : "property";
            return [labelFor(type), editingSourceLabel];
          }
          if (effectiveProjectId) {
            return ["פרויקט", recurringProjects.find((p) => p.id === effectiveProjectId)?.label ?? "—"];
          }
          if (effectiveOrderId) {
            return ["הזמנה", recurringOrders.find((o) => o.id === effectiveOrderId)?.label ?? "—"];
          }
          if (effectivePropertyId) {
            return ["נכס", recurringProperties.find((p) => p.id === effectivePropertyId)?.label ?? "—"];
          }
          return null;
        })();
        const rows: Array<[string, string]> = isWorkerPayment
          ? [
              ["עובד", localUsers.find((u) => u.id === targetUserId)?.label ?? "—"],
              ["תחום", getBusinessDomainLabel(effectiveDomain)],
              ...(sourceLabel ? [sourceLabel] : []),
              ["שעות", sessionDuration || "—"],
              ["עלות עבודה", laborCost ? ils(Number(laborCost)) : suggestedWorkerAmount !== null ? formatIls(suggestedWorkerAmount) : "יחושב"],
              ["תשלום לעובד", workerPaymentChoice === "none" ? "לא שולם" : workerPaymentChoice === "paid" ? "שולם במלואו" : "שולם חלקית"],
            ]
          : isRecurring
            ? [
                ["שם", templateName.trim() || description.trim() || finalCategory || "—"],
                ["סכום", recurVariable ? (Number(amount) > 0 ? `~${ils(Number(amount))} (משוער)` : "משתנה") : ils(Number(amount) || 0)],
                ...(recurAutoPaid ? [["תשלום", "הוראת קבע — יסומן כשולם אוטומטית"] as [string, string]] : []),
                ["תחום", getBusinessDomainLabel(effectiveDomain)],
                ...(sourceLabel ? [sourceLabel] : []),
                ["קטגוריה", finalCategory || "—"],
                ["תדירות", recurFrequency === "yearly" ? "כל שנה" : recurInterval > 1 ? `כל ${recurInterval} חודשים` : "כל חודש"],
                [
                  "מתי",
                  recurFrequency === "yearly"
                    ? `${Number((expenseDate || todayIso()).slice(8, 10)) || 1}/${MONTH_OPTIONS.find((m) => m.value === (recurMonth || String(Number((expenseDate || todayIso()).slice(5, 7)))))?.label ?? ""}`
                    : `יום ${Number((expenseDate || todayIso()).slice(8, 10)) || 1} בכל חודש`,
                ],
                ...(recurEndDate ? ([["עד", recurEndDate]] as Array<[string, string]>) : []),
              ]
            : installmentsMode
            ? [
                ["סכום", ils(Number(amount) || 0)],
                ["תחום", getBusinessDomainLabel(effectiveDomain)],
                ...(sourceLabel ? [sourceLabel] : []),
                ["קטגוריה", finalCategory || "—"],
                ["פריסה", `${installmentRows.length} תשלומים`],
                ...(installmentRows.some((r) => r.paid)
                  ? ([["שולם כבר", `${installmentRows.filter((r) => r.paid).length} מתוך ${installmentRows.length}`]] as Array<[string, string]>)
                  : []),
              ]
            : [
                ["סכום", ils(Number(amount) || 0)],
                ["תחום", getBusinessDomainLabel(effectiveDomain)],
                ...(sourceLabel ? [sourceLabel] : []),
                ["קטגוריה", finalCategory || "—"],
                ["תאריך", expenseDate || "—"],
                ["סטטוס", paymentStatusLabel(paymentStatus)],
              ];
        return (
          <>
            {expTitle("הכול מוכן?", "אפשר לחזור אחורה לתקן")}
            <div className="divide-y rounded-xl border">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </>
        );
      }
    }
  }

  // Label for the review step's confirm action, shown in the pinned nav bar
  // instead of the dialog body (so it sits exactly where "המשך" always is).
  const reviewSubmitLabel = isWorkerPayment ? "שמור משמרת" : isRecurring ? "שמור הוצאה קבועה" : "שמור הוצאה";
  const expNav = stepNavConfig(expStep);
  const isReviewStep = expStep === "review";
  const dialogTitleText = isEditingTemplate
    ? "עריכת הוצאה קבועה"
    : isEditingSession
      ? "עריכת שכר עובד"
      : isEditing
        ? "עריכת הוצאה"
        : "הוצאה חדשה";
  const dialogDescriptionText = isEditingTemplate
    ? "עדכון תבנית ההוצאה הקבועה."
    : isEditingSession
      ? "עדכון פרטי משמרת העובד."
      : isEditing
        ? "עדכון פרטי הוצאה קיימת."
        : "יצירת הוצאה חדשה.";

  // Shared between both render modes — express's StepWizard body and the full
  // form's own scrolling div — so ONE swipe-to-dismiss (see FormDialog/
  // StepWizardDialog for the same mechanism) covers whichever is mounted.
  const bodyRef = useRef<HTMLDivElement>(null);
  const swipeProps = useSwipeToDismiss({
    enabled: true,
    bodyRef,
    onDismiss: () => {
      if (!saving) onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      {/* hideClose only for express: StepWizard renders its own X there. Full-form
          edit mode has no header X of its own, so it keeps the primitive's default.
          className is the same flex-column shell every other full-screen dialog gets
          via StepWizardDialog/AdaptivePageDialog — without it the header/body/footer
          just stack in normal flow instead of the footer pinning to the bottom. */}
      <FullScreenDialogContent
        hideClose={activeMode === "express"}
        className={DIALOG_CHROME_CONTENT_PAGE}
        {...swipeProps}
      >
        {activeMode === "express" ? (
          <StepWizard
            variant="dialog"
            progressVariant="bar"
            showStepCounter={false}
            grabber
            bodyRef={bodyRef}
            title={<WizardTitle title={dialogTitleText} description={dialogDescriptionText} />}
            onClose={() => {
              if (!saving) onOpenChange(false);
            }}
            closeDisabled={saving}
            onBack={expIndex > 0 ? () => expressGo(-1) : undefined}
            onNext={() => (isReviewStep ? void handleSubmit() : expressGo(1))}
            nextLabel={isReviewStep ? (saving ? "שומר..." : reviewSubmitLabel) : "המשך"}
            nextDisabled={isReviewStep ? saving : expNav.disabled}
            isLastStep={isReviewStep}
            footerCenter={
              expNav.skip ? (
                <button
                  type="button"
                  onClick={expNav.skip}
                  className="text-sm font-semibold text-muted-foreground hover:text-foreground"
                >
                  דלג
                </button>
              ) : undefined
            }
            error={errorMessage || undefined}
            steps={expressSteps.map((id) => ({ n: id, label: id }))}
            current={expStep}
            // Not used in "bar" mode (no clickable circles render), but the
            // prop is required regardless.
            canClickStep={() => false}
            onStepClick={() => {}}
          >
            {presetTagLabel ? (
              <div className="mb-3 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-xs">
                <VehicleIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span>
                  משויך לרכב: <span className="font-medium text-foreground">{presetTagLabel}</span>
                </span>
              </div>
            ) : null}
            <div key={expStep}>{expressStageContent()}</div>
          </StepWizard>
        ) : (
        <>
        <div className="mx-auto -mt-1 mb-1 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30 sm:hidden" aria-hidden />
        <DialogHeader className="flex-none border-b px-4 pb-3 pt-5 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <DialogTitle>{dialogTitleText}</DialogTitle>
              <DialogDescription>{dialogDescriptionText}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
        >
        <div ref={bodyRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
          {/* Amount hero — first, like the mockup. For a variable recurring bill this
              is the ESTIMATE (base) used for planning; the real amount is set at pay. */}
          {!isWorkerPayment ? (
            <div className={cn("rounded-xl border p-3 transition-colors", (Number(amount) || 0) > 0 ? "border-success/50 bg-success/5" : "bg-muted/20")}>
              <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                <WalletIcon className="h-3.5 w-3.5" />
                {isRecurring && recurVariable ? (
                  <span>סכום משוער (בערך)</span>
                ) : (
                  <span>סכום ההוצאה <span className="text-destructive">*</span></span>
                )}
              </div>
              <div className="mt-2">
                <CurrencyInput type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="h-12 text-2xl font-bold" />
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {isRecurring && recurVariable
                  ? "הערכה לתכנון תזרים — הסכום הסופי ייקבע בעת התשלום."
                  : (Number(amount) || 0) > 0 ? `סכום: ${ils(Number(amount))}` : "הקלד את הסכום ששולם עבור ההוצאה"}
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

              {/* Project (unlike property below) stays edit-mode-gated: the
                  backend still treats project_id as immutable on edit — moving
                  a project-linked expense between projects means moving its
                  project_expenses row too (billing fields live there), which
                  /api/expenses/update doesn't do. Showing an editable picker
                  here in edit mode would let the user pick a project and then
                  fail on save with a confusing "not associated" error — same
                  bug as the property one, just not yet safe to fix the same
                  way (2026-08-27, caught while auditing for "more places with
                  this issue"). */}
              {!isEditing && effectiveDomain === "logistics_projects" && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">פרויקט *</div>
                  {recurringProjects.length > 0 ? (
                    <ProjectPicker
                      projects={recurringProjects}
                      value={projectId}
                      onChange={setProjectId}
                      emptyLabel="בחרו פרויקט"
                    />
                  ) : (
                    <div className="rounded-xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      אין פרויקטים זמינים — יש להוסיף פרויקט תחילה.
                    </div>
                  )}
                </div>
              )}

              {/* Order stays edit-mode-gated too, same reason as project above
                  — order_id is still backend-immutable on edit. */}
              {!isEditing && effectiveDomain === "sales" && recurringOrders.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">הזמנה</div>
                  <NativeSelect
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                  >
                    <option value="">ללא הזמנה</option>
                    {recurringOrders.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </NativeSelect>
                </div>
              )}

              {effectiveDomain === "property_management" && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">נכס *</div>
                  {recurringProperties.length > 0 ? (
                    <NativeSelect
                      value={propertyId}
                      onChange={(e) => setPropertyId(e.target.value)}
                    >
                      <option value="">בחרו נכס</option>
                      {recurringProperties.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <div className="rounded-xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                      אין נכסים זמינים — יש להוסיף נכס תחילה.
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {effectiveDomain ? (
            <>
          {/* Category (dropdown; "אחר" reveals a free-text field) */}
          <div className="space-y-1">
            <div className="text-sm font-medium">קטגוריה *</div>
            <NativeSelect
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
            </NativeSelect>
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
              <VehicleIcon className="h-4 w-4 text-muted-foreground" />
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
                  <NativeSelect
                    value={workerUserId}
                    onChange={(e) => setWorkerUserId(e.target.value)}
                  >
                    <option value=""></option>
                    {workerList.map((u) => (
                      <option key={u.id} value={u.id}>{u.label}</option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}

              {canManageWorkerSessions ? (
                workerTab !== "new" ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setWorkerTab("new")}>
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
                          setWorkerTab("existing");
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                    <NativeSelect
                      value={workerPaymentChoice}
                      onChange={(e) => setWorkerPaymentChoice(e.target.value as PaymentChoice)}
                    >
                      <option value="none">לא שולם</option>
                      <option value="paid">שולם במלואו</option>
                      <option value="partial">שולם חלקית</option>
                    </NativeSelect>
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
                        <NativeSelect
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
                        </NativeSelect>
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
                <div className="text-sm font-medium">{isRecurring ? "תאריך התחלה" : "תאריך"}</div>
                <DateInput value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
                {isRecurring ? (
                  <div className="text-xs text-muted-foreground">קובע את יום החיוב בכל תקופה (ואת החודש בחיוב כל X חודשים).</div>
                ) : null}
              </div>

              {/* One-time vs recurring (new, non-worker expenses only; hidden when
                  editing a template — that's always recurring) */}
              {canRecur && !isEditingTemplate ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium">תדירות</div>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { key: false, label: "חד-פעמי" },
                      { key: true, label: "חוזר" },
                    ] as const).map((opt) => (
                      <button
                        key={String(opt.key)}
                        type="button"
                        onClick={() => {
                          setIsRecurring(opt.key);
                          if (opt.key) {
                            setInstallmentsMode(false);
                            if (!recurMonth) setRecurMonth(String(Number((expenseDate || todayIso()).slice(5, 7)) || 1));
                          }
                        }}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                          isRecurring === opt.key
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-input bg-background text-muted-foreground hover:bg-muted/40"
                        )}
                      >
                        {opt.key ? <RecurringIcon className="h-4 w-4" /> : <WalletIcon className="h-4 w-4" />}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Recurring schedule — replaces the installments + payment blocks */}
              {isRecurring ? (
                <div className="space-y-3 rounded-xl border bg-muted/10 p-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">שם תבנית</div>
                    <Input
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="למשל: שכירות משרד"
                    />
                    <div className="text-xs text-muted-foreground">השם שיופיע ברשימת ההוצאות הקבועות. אם ריק — ייגזר מהקטגוריה.</div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">כל כמה זמן</div>
                      <NativeSelect
                        value={recurrenceKeyOf(recurFrequency, recurInterval)}
                        onChange={(e) => {
                          const c = RECURRENCE_CHOICES.find((o) => o.key === e.target.value) ?? RECURRENCE_CHOICES[0];
                          setRecurFrequency(c.frequency);
                          setRecurInterval(c.interval);
                          if (c.frequency === "yearly" && !recurMonth) {
                            setRecurMonth(String(Number((expenseDate || todayIso()).slice(5, 7)) || 1));
                          }
                        }}
                      >
                        {RECURRENCE_CHOICES.map((c) => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </NativeSelect>
                    </div>
                    {recurFrequency === "yearly" ? (
                      <div className="space-y-1">
                        <div className="text-sm font-medium">חודש</div>
                        <NativeSelect
                          value={recurMonth}
                          onChange={(e) => setRecurMonth(e.target.value)}
                        >
                          {MONTH_OPTIONS.map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </NativeSelect>
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <div className="text-sm font-medium">עד תאריך (לא חובה)</div>
                      <DateInput value={recurEndDate} onChange={(e) => setRecurEndDate(e.target.value)} />
                    </div>
                  </div>

                  {/* Occurrence-month preview — the start date's month sets the phase
                      (change the date to shift e.g. odd → even months). */}
                  {recurFrequency === "monthly" && recurInterval > 1 ? (
                    <div className="rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
                      יחול בחודשים:{" "}
                      <span className="font-medium text-foreground">
                        {occurrenceMonths(expenseDate || todayIso(), recurInterval).join(" · ")}
                      </span>
                      <div className="mt-0.5">שנה את התאריך שלמעלה כדי להזיז את חודשי החיוב.</div>
                    </div>
                  ) : null}

                  {/* Variable amount (e.g. taxes): only the schedule is fixed */}
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={recurVariable}
                      onChange={(e) => { setRecurVariable(e.target.checked); if (e.target.checked) setRecurAutoPaid(false); }}
                    />
                    <span>
                      <span className="block font-medium">סכום משתנה (משוער)</span>
                      <span className="block text-xs text-muted-foreground">
                        לתשלומים שהסכום שלהם משתנה (משכנתא, אשראי, מס) — הסכום שלמעלה משמש כהערכה לתכנון, והסכום הסופי נקבע בתשלום.
                      </span>
                    </span>
                  </label>

                  {/* Bank standing order: auto-mark paid, no manual confirmation */}
                  {!recurVariable ? (
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={recurAutoPaid}
                        onChange={(e) => setRecurAutoPaid(e.target.checked)}
                      />
                      <span>
                        <span className="block font-medium">משולם אוטומטית (הוראת קבע)</span>
                        <span className="block text-xs text-muted-foreground">
                          יורד מהבנק אוטומטית — ההוצאה תיווצר כבר מסומנת כשולם ביום החיוב, בלי צורך לאשר.
                        </span>
                      </span>
                    </label>
                  ) : null}

                  <AccountSelect
                    value={accountId}
                    onChange={setAccountId}
                    onLoaded={setAccountsList}
                  />

                  {/* Monthly reminder: N work-days before each payment */}
                  <div className="space-y-1">
                    <div className="text-sm font-medium">תזכורת חודשית לפני התשלום</div>
                    <div className="flex items-center gap-2">
                      <Input value={recurReminderDays} onChange={(e) => setRecurReminderDays(e.target.value)} placeholder="0" className="w-20" />
                      <span className="text-sm text-muted-foreground">ימי עבודה לפני (0 = ללא תזכורת)</span>
                    </div>
                    {recurReminderDays && Number(recurReminderDays) > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        התראה חוזרת בכל חודש, {Number(recurReminderDays)} ימי עבודה לפני מועד החיוב (שישי/שבת לא נספרים).
                      </div>
                    ) : null}
                  </div>

                  {showBillingOptions ? (
                    <div className="space-y-1">
                      <div className="text-sm font-medium">הערת פרויקט</div>
                      <Input
                        value={projectNotesTemplate}
                        onChange={(e) => setProjectNotesTemplate(e.target.value)}
                      />
                    </div>
                  ) : null}
                  {isEditingTemplate ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={recurActive} onChange={(e) => setRecurActive(e.target.checked)} />
                      <span>פעיל</span>
                    </label>
                  ) : null}

                  {/* The amount changed on an existing template. Each already-
                      generated row holds its own copy of the old amount, so the
                      user has to say how far back the new price reaches. */}
                  {templateAmountChanged ? (
                    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/60 p-3">
                      <div className="text-sm font-medium">
                        שינית את הסכום — על אילו חיובים להחיל אותו?
                      </div>
                      {[
                        {
                          value: "unpaid" as const,
                          label: "חיובים שטרם שולמו",
                          // In a standing order the generator marks every row it
                          // creates as paid, so this option has nothing to match.
                          hint: recurAutoPaid
                            ? "בהוראת קבע כל חיוב נוצר כשולם, ולכן האפשרות הזו לא תשנה חיובים קיימים."
                            : "החיובים הבאים, וגם כאלה שכבר נוצרו אבל עדיין לא שולמו. חיובים ששולמו לא ישתנו.",
                        },
                        {
                          value: "none" as const,
                          label: "רק חיובים חדשים",
                          hint: "כל מה שכבר נוצר נשאר בסכום הישן.",
                        },
                        {
                          value: "all" as const,
                          label: "גם חיובים ששולמו, מתאריך ההתחלה",
                          hint: "לשימוש כשהסכום היה שגוי מלכתחילה. משנה גם חודשים סגורים — ואז ייתכן שלא יתאים לדף הבנק.",
                        },
                      ].map((option) => (
                        <label key={option.value} className="flex items-start gap-2 text-sm">
                          <input
                            type="radio"
                            name="amount-propagation"
                            className="mt-1"
                            checked={amountPropagation === option.value}
                            onChange={() => setAmountPropagation(option.value)}
                          />
                          <span>
                            <span className="font-medium">{option.label}</span>
                            <span className="block text-xs text-muted-foreground">{option.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {(() => {
                      const day = Number((expenseDate || todayIso()).slice(8, 10)) || 1;
                      const when =
                        recurFrequency === "yearly"
                          ? `בכל שנה ב-${day}/${MONTH_OPTIONS.find((m) => m.value === recurMonth)?.label ?? ""}`
                          : recurInterval > 1
                            ? `כל ${recurInterval} חודשים ביום ${day}`
                            : `בכל חודש ביום ${day}`;
                      const tail = recurAutoPaid ? "וייחשב כשולם אוטומטית (הוראת קבע)" : "ויופיע ביומן לאישור תשלום";
                      return `ייווצר ${when}, ${tail}.`;
                    })()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    אפשר להשתמש בטוקנים בתיאור/הערות: {"{{expense_month}}"} · {"{{expense_date}}"} · {"{{period_key}}"}.
                  </p>
                </div>
              ) : null}

              {/* Installments toggle — split into N dated payments (new expenses only) */}
              {!isEditing && !isRecurring ? (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors",
                    installmentsMode ? "border-primary bg-primary/5" : "hover:border-primary/60"
                  )}
                >
                  <span className={cn("flex h-8 w-8 flex-none items-center justify-center rounded-lg transition-colors", installmentsMode ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    <SplitIcon className="h-4 w-4" />
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">אמצעי תשלום</div>
                    <NativeSelect
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
                    </NativeSelect>
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
              {!installmentsMode && !isRecurring ? (
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">אמצעי תשלום</div>
                    <NativeSelect
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
                    </NativeSelect>
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
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
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
            <div className="relative">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="pe-11" />
              <DictateButton
                onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
                className="absolute bottom-1 end-1 h-8 w-8"
              />
            </div>
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
        </div>

          <DialogFooter className="flex-none border-t px-4 py-3 sm:px-6">
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
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  שומר...
                </>
              ) : (
                "שמירה"
              )}
            </Button>
          </DialogFooter>
        </form>
        </>
        )}
      </FullScreenDialogContent>
    </Dialog>
  );
}
