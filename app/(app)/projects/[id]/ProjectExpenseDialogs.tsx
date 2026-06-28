"use client";

// Lazy-loaded heavy financial-entry dialogs, extracted from ProjectTabsClient so
// their code only downloads when a user actually opens "add expense"/"add income".
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { TagPicker, fetchExistingTagIds } from "@/components/tags/TagPicker";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ORDER_PAYMENT_METHOD_OPTIONS } from "@/lib/orders/paymentStatus";
import { toHebrewError } from "@/lib/error-messages";
import {
  mapProjectTypeToExpenseDomain,
  EXPENSE_CATEGORY_OPTIONS_WITH_WAGE,
  EXPENSE_OTHER_CATEGORY,
  EXPENSE_WORKER_WAGE_CATEGORY,
  EXPENSE_CARS_CATEGORY,
} from "@/lib/expenses";
import {
  addMinutes,
  calculateSessionLaborCost,
  getActiveSalaryAgreementForDate,
  type WorkSessionRow,
} from "@/lib/payroll";
import {
  normalizePayrollWorkerType,
  shouldShowSessionHours,
  shouldShowSessionPrice,
  type PayrollWorkerType,
} from "@/lib/payroll-worker-type";
import { type FinancialAttachment, type PaymentRow } from "@/lib/payments";
import type {
  AssignableUser,
  ExpenseListItem,
  ProjectSalaryAgreement,
} from "./ProjectTabsClient";

// Helpers kept local (duplicated from ProjectTabsClient) so this module is
// self-contained and doesn't create a runtime cross-import.
function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatIls(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

function getString(row: Record<string, unknown> | null, key: string) {
  if (!row) return null;
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function isImageAttachment(attachment: Pick<FinancialAttachment, "file_name" | "document_type">) {
  const name = attachment.file_name?.toLowerCase() ?? "";
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(name) || attachment.document_type?.includes("photo");
}

async function uploadFinancialAttachment(entityType: "expense" | "payment" | "session", entityId: string, file: File) {
  const form = new FormData();
  form.set("entity_type", entityType);
  form.set("entity_id", entityId);
  form.set("file", file);

  const res = await fetch("/api/financial-attachments/upload", {
    method: "POST",
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Upload failed");
  }
  return (json?.attachment ?? null) as FinancialAttachment | null;
}

function getErrorMessage(error: unknown) {
  return toHebrewError(error, "");
}

// Categories come from the shared source of truth in lib/expenses.
const PROJECT_EXPENSE_CATEGORY_OPTIONS = EXPENSE_CATEGORY_OPTIONS_WITH_WAGE;
const OTHER_PROJECT_EXPENSE_CATEGORY = EXPENSE_OTHER_CATEGORY;
const EMPLOYEE_WAGE_CATEGORY = EXPENSE_WORKER_WAGE_CATEGORY;

function toLocalDateTimeValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateOnly(value: string | null | undefined) {
  if (!value) return "";
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  return match ? match[1] : "";
}

function projectDateOrToday(projectStartDate: string | null | undefined) {
  return dateOnly(projectStartDate) || new Date().toISOString().slice(0, 10);
}

function projectLocalDateTime(projectStartDate: string | null | undefined, offsetMinutes = 0) {
  const baseDate = projectDateOrToday(projectStartDate);
  const now = new Date();
  const adjusted = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    0,
    0
  );
  adjusted.setMinutes(adjusted.getMinutes() + offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${baseDate}T${pad(adjusted.getHours())}:${pad(adjusted.getMinutes())}`;
}

function projectLocalDateTimeWithTemplate(
  projectStartDate: string | null | undefined,
  templateDateTime: string | null | undefined,
  fallbackOffsetMinutes = 0
) {
  const baseDate = projectDateOrToday(projectStartDate);
  if (!templateDateTime) return projectLocalDateTime(projectStartDate, fallbackOffsetMinutes);
  const template = new Date(templateDateTime);
  if (Number.isNaN(template.getTime())) {
    return projectLocalDateTime(projectStartDate, fallbackOffsetMinutes);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${baseDate}T${pad(template.getHours())}:${pad(template.getMinutes())}`;
}

function toIsoDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function AddExpenseDialog({
  open,
  onOpenChange,
  projectId,
  projectType,
  projectStartDate,
  defaultSessionClockIn,
  defaultSessionClockOut,
  users,
  salaryAgreements,
  editingItem,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectType: string;
  projectStartDate: string | null;
  defaultSessionClockIn: string | null;
  defaultSessionClockOut: string | null;
  users: AssignableUser[];
  salaryAgreements: ProjectSalaryAgreement[];
  editingItem: ExpenseListItem | null;
  onSaved: (saved: ExpenseListItem) => void | Promise<void>;
}) {
  const editingExpense = editingItem?.expense ?? null;
  const editingSession = editingItem?.session ?? null;
  const isEditingSession = editingItem?.source_type === "session" && Boolean(editingSession);
  const isEditing = Boolean(editingItem);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [categoryOtherTouched, setCategoryOtherTouched] = useState(false);
  const [expenseDateTouched, setExpenseDateTouched] = useState(false);
  const [clockInTouched, setClockInTouched] = useState(false);
  const [clockOutTouched, setClockOutTouched] = useState(false);
  const [sessionUsers, setSessionUsers] = useState<AssignableUser[]>(users);
  const [newWorkerOpen, setNewWorkerOpen] = useState(false);
  const [newWorkerSubmitting, setNewWorkerSubmitting] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerPhone, setNewWorkerPhone] = useState("");
  const [newWorkerRole, setNewWorkerRole] = useState<"worker_no_access">("worker_no_access");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [categoryOther, setCategoryOther] = useState("");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(projectDateOrToday(projectStartDate));
  const [clockIn, setClockIn] = useState(
    projectLocalDateTimeWithTemplate(projectStartDate, defaultSessionClockIn, -60)
  );
  const [clockOut, setClockOut] = useState(
    projectLocalDateTimeWithTemplate(projectStartDate, defaultSessionClockOut, 0)
  );
  const [sessionUserId, setSessionUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [billedToCustomer, setBilledToCustomer] = useState(false);
  const [expenseBillToCustomerAmount, setExpenseBillToCustomerAmount] = useState("");
  const [expensePaymentStatus, setExpensePaymentStatus] = useState<"paid" | "partial" | "not_paid">("not_paid");
  const [expensePaidAmount, setExpensePaidAmount] = useState("");
  const [expensePaymentMethod, setExpensePaymentMethod] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<FinancialAttachment[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [laborCost, setLaborCost] = useState("");
  const [laborCostTouched, setLaborCostTouched] = useState(false);
  const [originalLaborCost, setOriginalLaborCost] = useState("");
  const [sessionBillableToCustomer, setSessionBillableToCustomer] = useState(false);
  const [billToCustomerAmount, setBillToCustomerAmount] = useState("");
  const [billToCustomerAmountTouched, setBillToCustomerAmountTouched] = useState(false);
  const [workerPaymentMode, setWorkerPaymentMode] = useState<"none" | "paid" | "partial">("none");
  const [workerPaymentAmount, setWorkerPaymentAmount] = useState("");
  const [workerPaymentAmountTouched, setWorkerPaymentAmountTouched] = useState(false);
  const finalCategory =
    category === OTHER_PROJECT_EXPENSE_CATEGORY ? categoryOther.trim() : category.trim();
  const isSessionMode = isEditingSession || (!isEditing && finalCategory === EMPLOYEE_WAGE_CATEGORY);
  const selectedSessionWorkerType = useMemo<PayrollWorkerType | null>(() => {
    if (!sessionUserId) return null;
    const worker = sessionUsers.find((u) => u.id === sessionUserId);
    if (!worker) return null;
    return normalizePayrollWorkerType(worker.payroll_worker_type, worker.pay_tracking_mode);
  }, [sessionUserId, sessionUsers]);
  const showSessionTimingFields = !isSessionMode || shouldShowSessionHours(selectedSessionWorkerType);
  const showSessionPriceField = !isSessionMode || shouldShowSessionPrice(selectedSessionWorkerType);
  const sessionDateValue = dateOnly(clockIn) || projectDateOrToday(projectStartDate);
  const movedAmountToNotesRef = useRef(false);
  const lastAutoWorkerPaymentAmountRef = useRef("");
  const originalWorkerPaymentAmountRef = useRef(0);
  const laborCostNumber = Number(laborCost);
  const billToCustomerAmountNumber = Number(billToCustomerAmount);
  const workerPaymentAmountNumber = Number(workerPaymentAmount);
  const clockInIsoValue = toIsoDateTime(clockIn);
  const clockOutIsoValue = toIsoDateTime(clockOut);
  const workedMinutesForDraft =
    clockInIsoValue && clockOutIsoValue
      ? Math.max(
          0,
          Math.round((new Date(clockOutIsoValue).getTime() - new Date(clockInIsoValue).getTime()) / 60000)
        )
      : 0;
  const activeSalaryAgreement = useMemo(() => {
    if (!sessionUserId || !clockInIsoValue) return null;
    return getActiveSalaryAgreementForDate(
      salaryAgreements.filter((agreement) => agreement.user_id === sessionUserId),
      new Date(clockInIsoValue)
    );
  }, [clockInIsoValue, salaryAgreements, sessionUserId]);
  const suggestedWorkerPaymentAmount = useMemo(() => {
    if (!isSessionMode) return null;
    if (activeSalaryAgreement?.salary_type === "hourly") {
      return calculateSessionLaborCost(activeSalaryAgreement, workedMinutesForDraft);
    }
    return laborCost.trim() && Number.isFinite(laborCostNumber) && laborCostNumber > 0
      ? laborCostNumber
      : null;
  }, [activeSalaryAgreement, isSessionMode, laborCost, laborCostNumber, workedMinutesForDraft]);
  const existingWorkerPaidAmount =
    isEditingSession && (toNumber(editingSession?.paid_amount) ?? 0) > 0
      ? Math.max(0, toNumber(editingSession?.paid_amount) ?? 0)
      : 0;
  const remainingWorkerOwedAmount =
    suggestedWorkerPaymentAmount === null
      ? null
      : Math.max(0, suggestedWorkerPaymentAmount - existingWorkerPaidAmount);
  const canSubmit =
    Boolean(finalCategory) &&
    (isSessionMode
      ? Boolean(clockIn) &&
        Boolean(clockOut) &&
        Boolean(sessionUserId) &&
        (!laborCost.trim() || (Number.isFinite(laborCostNumber) && laborCostNumber > 0)) &&
        (workerPaymentMode === "none" ||
          (workerPaymentAmount.trim() &&
            Number.isFinite(workerPaymentAmountNumber) &&
            workerPaymentAmountNumber > 0)) &&
        (!sessionBillableToCustomer ||
          (Number.isFinite(billToCustomerAmountNumber) && billToCustomerAmountNumber > 0)) &&
        Boolean(clockInIsoValue) &&
        Boolean(clockOutIsoValue) &&
        new Date(clockOutIsoValue) > new Date(clockInIsoValue)
      : Number.isFinite(Number(amount)) &&
        Number(amount) > 0 &&
        Boolean(expenseDate) &&
        (!billedToCustomer || (Number.isFinite(Number(expenseBillToCustomerAmount)) && Number(expenseBillToCustomerAmount) > 0)));

  const amountNumber = Number(amount);
  const amountError =
    isSessionMode
      ? null
      :
    !amount.trim()
      ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4"
      : !Number.isFinite(amountNumber)
      ? "\u05d7\u05d9\u05d9\u05d1 \u05dc\u05d4\u05d9\u05d5\u05ea \u05de\u05e1\u05e4\u05e8"
      : amountNumber <= 0
      ? "\u05d7\u05d9\u05d9\u05d1 \u05dc\u05d4\u05d9\u05d5\u05ea \u05d2\u05d3\u05d5\u05dc \u05de-0"
      : null;
  const categoryError = !category.trim()
    ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4"
    : category === OTHER_PROJECT_EXPENSE_CATEGORY && !categoryOther.trim()
    ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4"
    : null;
  const expenseDateError = isSessionMode ? null : !expenseDate ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4" : null;
  const clockInError = isSessionMode
    ? !clockIn
      ? "שדה חובה"
      : !toIsoDateTime(clockIn)
        ? "תאריך ושעה לא תקינים"
        : null
    : null;
  const clockOutError = isSessionMode
    ? !clockOut
      ? "שדה חובה"
      : !toIsoDateTime(clockOut)
        ? "תאריך ושעה לא תקינים"
        : new Date(toIsoDateTime(clockOut)) <= new Date(toIsoDateTime(clockIn))
          ? "שעת הסיום חייבת להיות אחרי שעת ההתחלה"
          : null
    : null;
  const sessionUserError = isSessionMode && !sessionUserId ? "יש לבחור עובד" : null;
  const laborCostError = isSessionMode
    ? laborCost.trim() && !Number.isFinite(laborCostNumber)
        ? "חייב להיות מספר"
        : laborCost.trim() && laborCostNumber <= 0
          ? "חייב להיות גדול מ-0"
          : null
    : null;
  const billToCustomerAmountError = isSessionMode && sessionBillableToCustomer
    ? !billToCustomerAmount.trim()
      ? "שדה חובה"
      : !Number.isFinite(billToCustomerAmountNumber)
        ? "חייב להיות מספר"
        : billToCustomerAmountNumber <= 0
          ? "חייב להיות גדול מ-0"
          : null
    : null;
  const workerPaymentAmountError = isSessionMode && workerPaymentMode !== "none"
    ? !workerPaymentAmount.trim()
      ? "שדה חובה"
      : !Number.isFinite(workerPaymentAmountNumber)
        ? "חייב להיות מספר"
        : workerPaymentAmountNumber <= 0
          ? "חייב להיות גדול מ-0"
          : null
    : null;
  const showAmountError = (submitAttempted || amountTouched) && Boolean(amountError);
  const showCategoryError =
    (submitAttempted || categoryTouched || categoryOtherTouched) && Boolean(categoryError);
  const showExpenseDateError = (submitAttempted || expenseDateTouched) && Boolean(expenseDateError);
  const showClockInError = (submitAttempted || clockInTouched) && Boolean(clockInError);
  const showClockOutError = (submitAttempted || clockOutTouched) && Boolean(clockOutError);
  const showSessionUserError = submitAttempted && Boolean(sessionUserError);
  const showLaborCostError = (submitAttempted || laborCostTouched) && Boolean(laborCostError);
  const showBillToCustomerAmountError =
    (submitAttempted || billToCustomerAmountTouched) && Boolean(billToCustomerAmountError);
  const showWorkerPaymentAmountError =
    (submitAttempted || workerPaymentAmountTouched) && Boolean(workerPaymentAmountError);
  const addExpenseValidationMessage = (() => {
    if (!submitAttempted || submitting || canSubmit) return "";
    const missing: string[] = [];
    if (amountError) missing.push("\u05e1\u05db\u05d5\u05dd");
    if (categoryError) missing.push("\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4");
    if (expenseDateError) missing.push("\u05ea\u05d0\u05e8\u05d9\u05da");
    if (clockInError) missing.push("שעת התחלה");
    if (clockOutError) missing.push("שעת סיום");
    if (sessionUserError) missing.push("עובד");
    if (laborCostError) missing.push("עלות עבודה");
    if (billToCustomerAmountError) missing.push("סכום לחיוב לקוח");
    if (workerPaymentAmountError) missing.push("סכום ששולם לעובד");
    return missing.length > 0
      ? `\u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05de\u05d5\u05e8: ${missing.join(", ")}`
      : "";
  })();

  const durationHours = (() => {
    if (!clockInIsoValue || !clockOutIsoValue) return "";
    const minutes = Math.round((new Date(clockOutIsoValue).getTime() - new Date(clockInIsoValue).getTime()) / 60000);
    return minutes > 0 ? String(Number((minutes / 60).toFixed(2))) : "";
  })();

  useEffect(() => {
    if (!isSessionMode || workerPaymentMode === "none") return;
    if (
      isEditingSession &&
      originalWorkerPaymentAmountRef.current > 0 &&
      workerPaymentMode === "partial" &&
      !workerPaymentAmountTouched
    ) {
      return;
    }
    const nextAutoValue =
      suggestedWorkerPaymentAmount !== null ? String(Number(suggestedWorkerPaymentAmount.toFixed(2))) : "";

    if (
      workerPaymentAmount.trim() === "" ||
      workerPaymentAmount === lastAutoWorkerPaymentAmountRef.current ||
      !workerPaymentAmountTouched
    ) {
      setWorkerPaymentAmount(nextAutoValue);
      lastAutoWorkerPaymentAmountRef.current = nextAutoValue;
    }
  }, [
    isEditingSession,
    isSessionMode,
    suggestedWorkerPaymentAmount,
    workerPaymentAmount,
    workerPaymentAmountTouched,
    workerPaymentMode,
  ]);

  useEffect(() => {
    if (!open) return;
    const rawCategory = getString(editingExpense, "category") ?? "";
    const categoryIsPreset = (PROJECT_EXPENSE_CATEGORY_OPTIONS as readonly string[]).includes(rawCategory);
    setSubmitAttempted(false);
    setAmountTouched(false);
    setCategoryTouched(false);
    setCategoryOtherTouched(false);
    setExpenseDateTouched(false);
    setClockInTouched(false);
    setClockOutTouched(false);
    setLaborCostTouched(false);
    setBillToCustomerAmountTouched(false);
    setWorkerPaymentAmountTouched(false);
    setAmount(
      editingExpense && toNumber(editingExpense["amount"]) !== null
        ? String(toNumber(editingExpense["amount"]))
        : ""
    );
    setCategory(
      isEditingSession
        ? EMPLOYEE_WAGE_CATEGORY
        : categoryIsPreset
          ? rawCategory
          : rawCategory
            ? OTHER_PROJECT_EXPENSE_CATEGORY
            : ""
    );
    setCategoryOther(isEditingSession ? "" : categoryIsPreset ? "" : rawCategory);
    setDescription(getString(editingExpense, "description") ?? "");
    setExpenseDate(getString(editingExpense, "expense_date") ?? projectDateOrToday(projectStartDate));
    setClockIn(
      isEditingSession
        ? toLocalDateTimeValue(editingSession?.clock_in)
        : projectLocalDateTimeWithTemplate(projectStartDate, defaultSessionClockIn, -60)
    );
    setClockOut(
      isEditingSession
        ? toLocalDateTimeValue(editingSession?.clock_out)
        : projectLocalDateTimeWithTemplate(projectStartDate, defaultSessionClockOut, 0)
    );
    setSessionUsers(users);
    setSessionUserId(isEditingSession ? editingSession?.user_id ?? "" : users[0]?.id ?? "");
    setNewWorkerOpen(false);
    setNewWorkerSubmitting(false);
    setNewWorkerName("");
    setNewWorkerPhone("");
    setNewWorkerRole("worker_no_access");
    setNotes(isEditingSession ? editingSession?.notes ?? "" : getString(editingExpense, "notes") ?? "");
    setBilledToCustomer(Boolean(editingItem?.project_expense?.["billed_to_customer"]));
    const rawExpBillAmount = editingItem?.project_expense?.["bill_to_customer_amount"];
    setExpenseBillToCustomerAmount(
      rawExpBillAmount != null && Number(rawExpBillAmount) > 0 ? String(Number(rawExpBillAmount)) : ""
    );
    const rawStatus = getString(editingExpense, "payment_status");
    setExpensePaymentStatus(
      rawStatus === "paid" || rawStatus === "partial" || rawStatus === "not_paid"
        ? rawStatus
        : "not_paid"
    );
    const rawExpPaid = editingExpense ? toNumber(editingExpense["paid_amount"] as string | number | null) : null;
    setExpensePaidAmount(rawExpPaid != null && rawExpPaid > 0 ? String(rawExpPaid) : "");
    setExpensePaymentMethod(getString(editingExpense, "payment_method") ?? "");
    setAttachmentFiles([]);
    setExistingAttachments(
      isEditingSession
        ? Array.isArray(editingSession?.attachments)
          ? editingSession.attachments
          : []
        : Array.isArray(editingExpense?.attachments)
          ? (editingExpense.attachments as FinancialAttachment[])
          : []
    );
    setTagIds([]);
    if (!isEditingSession) {
      const expenseIdForTags = getString(editingExpense, "id");
      if (expenseIdForTags) void fetchExistingTagIds("expense", expenseIdForTags).then(setTagIds);
    }
    const existingPaidAmount = isEditingSession ? toNumber(editingSession?.paid_amount) ?? 0 : 0;
    const nextWorkerPaymentMode =
      existingPaidAmount > 0
        ? editingSession?.payment_status === "partial"
          ? "partial"
          : "paid"
        : "none";
    const nextWorkerPaymentAmount = existingPaidAmount > 0 ? String(existingPaidAmount) : "";
    setWorkerPaymentMode(nextWorkerPaymentMode);
    setWorkerPaymentAmount(nextWorkerPaymentAmount);
    lastAutoWorkerPaymentAmountRef.current = nextWorkerPaymentAmount;
    originalWorkerPaymentAmountRef.current = existingPaidAmount;
    const currentLaborCost =
      isEditingSession && toNumber(editingSession?.labor_cost) !== null
        ? String(toNumber(editingSession?.labor_cost))
        : "";
    setLaborCost(currentLaborCost);
    setOriginalLaborCost(currentLaborCost);
    setSessionBillableToCustomer(Boolean(editingSession?.is_billable_to_customer));
    setBillToCustomerAmount(
      isEditingSession && toNumber(editingSession?.bill_to_customer_amount) !== null
        ? String(toNumber(editingSession?.bill_to_customer_amount))
        : ""
    );
    movedAmountToNotesRef.current = false;
  }, [
    open,
    editingExpense,
    editingItem,
    projectType,
    users,
    isEditingSession,
    editingSession,
    projectStartDate,
    defaultSessionClockIn,
    defaultSessionClockOut,
  ]);

  useEffect(() => {
    if (!isSessionMode) {
      movedAmountToNotesRef.current = false;
      return;
    }
    if (movedAmountToNotesRef.current) return;
    if (!amount.trim()) return;
    const movedText = `סכום שהוזן קודם: ${amount.trim()}`;
    setNotes((prev) => (prev.trim() ? `${prev.trim()}\n${movedText}` : movedText));
    setAmount("");
    movedAmountToNotesRef.current = true;
  }, [amount, isSessionMode]);

  useEffect(() => {
    if (!isSessionMode || selectedSessionWorkerType !== "session_only") return;
    const date = dateOnly(clockIn) || projectDateOrToday(projectStartDate);
    const normalizedIn = `${date}T09:00`;
    const normalizedOut = `${date}T10:00`;
    if (clockIn !== normalizedIn) setClockIn(normalizedIn);
    if (clockOut !== normalizedOut) setClockOut(normalizedOut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSessionMode, selectedSessionWorkerType]);

  async function createWorker() {
    const name = newWorkerName.trim();
    const phone = newWorkerPhone.trim();
    if (!name || !phone) {
      toast.error("יש למלא שם וטלפון לעובד החדש");
      return;
    }

    setNewWorkerSubmitting(true);
    try {
      const res = await fetch("/api/users/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          full_name: name,
          email: null,
          phone: phone || null,
          password: "",
          role: newWorkerRole,
          system_access: false,
          pay_tracking_mode: "session",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.user?.id) {
        toast.error("שגיאה ביצירת עובד", {
          description: toHebrewError(json?.error, ""),
        });
        return;
      }

      const createdUser = json.user as AssignableUser;
      setSessionUsers((prev) => [createdUser, ...prev]);
      setSessionUserId(createdUser.id);
      setNewWorkerOpen(false);
      setNewWorkerName("");
      setNewWorkerPhone("");
      setNewWorkerRole("worker_no_access");
      toast.success("העובד נוסף");
    } catch (e: unknown) {
      toast.error("שגיאה ביצירת עובד", {
        description: getErrorMessage(e),
      });
    } finally {
      setNewWorkerSubmitting(false);
    }
  }

  async function submit() {
    setSubmitAttempted(true);

    if (!finalCategory) return;
    if (isSessionMode) {
      const clockInIso = toIsoDateTime(clockIn);
      const clockOutIso = toIsoDateTime(clockOut);
      if (!clockInIso || !clockOutIso) return;
      if (!sessionUserId) return;
      if (laborCost.trim() && (!Number.isFinite(laborCostNumber) || laborCostNumber <= 0)) return;
      if (
        workerPaymentMode !== "none" &&
        (!workerPaymentAmount.trim() ||
          !Number.isFinite(workerPaymentAmountNumber) ||
          workerPaymentAmountNumber <= 0)
      ) {
        return;
      }
      if (
        sessionBillableToCustomer &&
        (!Number.isFinite(billToCustomerAmountNumber) || billToCustomerAmountNumber <= 0)
      ) {
        return;
      }
      if (new Date(clockOutIso) <= new Date(clockInIso)) return;

      const laborCostInput = laborCost.trim();
      const sessionTimingChanged =
        isEditingSession &&
        (sessionUserId !== (editingSession?.user_id ?? "") ||
          clockInIso !== (editingSession?.clock_in ?? "") ||
          clockOutIso !== (editingSession?.clock_out ?? ""));
      const shouldAutoCalculateLaborCost =
        clockOutIso !== null &&
        (
          (!isEditingSession && !laborCostInput) ||
          (isEditingSession &&
            (!laborCostInput ||
              (sessionTimingChanged && laborCostInput === originalLaborCost.trim())))
        );

      setSubmitting(true);
      try {
        const res = await fetch(isEditingSession ? "/api/profile/session/update" : "/api/profile/session/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session_id: editingSession?.id ?? undefined,
            business_domain: mapProjectTypeToExpenseDomain(projectType),
            project_id: projectId,
            user_id: sessionUserId,
            notes: notes.trim() ? notes : undefined,
            clock_in: clockInIso,
            clock_out: clockOutIso,
            labor_cost: shouldAutoCalculateLaborCost ? null : laborCostNumber,
            recalculate_labor_cost: shouldAutoCalculateLaborCost,
            is_billable_to_customer: sessionBillableToCustomer,
            bill_to_customer_amount: sessionBillableToCustomer ? billToCustomerAmountNumber : undefined,
            billing_status: sessionBillableToCustomer ? "billable" : "not_billable",
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(isEditingSession ? "שגיאה בעדכון משמרת" : "שגיאה בהוספת משמרת", {
            description: toHebrewError(json?.error, ""),
          });
          return;
        }

        const savedSession = json?.session as WorkSessionRow | undefined;
        if (!savedSession?.id) {
          toast.error(isEditingSession ? "שגיאה בעדכון משמרת" : "שגיאה בהוספת משמרת", {
            description: "Missing session id",
          });
          return;
        }

        if (workerPaymentMode !== "none") {
          const sessionLaborCost = toNumber(savedSession.labor_cost);
          const sessionPaymentDate = dateOnly(savedSession.clock_out ?? savedSession.clock_in);

          if (!sessionPaymentDate) {
            toast.error("שגיאה ברישום תשלום לעובד", { description: "Missing payment date" });
          } else if (sessionLaborCost === null || sessionLaborCost <= 0) {
            toast.error("לא ניתן לרשום תשלום לעובד", {
              description: "יש להזין עלות עבודה או לחשב עלות אוטומטית לפני רישום תשלום.",
            });
          } else {
            const desiredPaymentAmount =
              workerPaymentMode === "paid" ? sessionLaborCost : workerPaymentAmountNumber;
            const existingPaidAmount = isEditingSession ? originalWorkerPaymentAmountRef.current : 0;
            const paymentAmount = Number(
              Math.max(0, (desiredPaymentAmount ?? 0) - existingPaidAmount).toFixed(2)
            );

            if ((desiredPaymentAmount ?? 0) + 0.009 < existingPaidAmount) {
              toast.error("לא ניתן להפחית תשלום קיים מהמסך הזה", {
                description: "כדי להקטין או לבטל תשלום שכבר נרשם, יש לערוך או למחוק אותו במסך השכר.",
              });
            } else if (!Number.isFinite(desiredPaymentAmount) || (desiredPaymentAmount ?? 0) <= 0) {
              toast.error("שגיאה ברישום תשלום לעובד", { description: "Missing payment amount" });
            } else if (paymentAmount <= 0.009) {
              // Existing payments already cover the requested amount.
            } else {
              try {
                const paymentRes = await fetch("/api/payroll/worker-payments", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    user_id: savedSession.user_id,
                    payment_date: sessionPaymentDate,
                    amount: paymentAmount,
                    payment_method: null,
                    reference_number: null,
                    notes: null,
                    allocations: [
                      {
                        source_type: "session",
                        source_id: savedSession.id,
                        amount: paymentAmount,
                      },
                    ],
                  }),
                });

                const paymentJson = await paymentRes.json().catch(() => ({}));
                if (!paymentRes.ok) {
                  toast.error("שגיאה ברישום תשלום לעובד", {
                    description: typeof paymentJson?.error === "string" ? paymentJson.error : "",
                  });
                } else {
                  toast.success("התשלום לעובד נשמר");
                }
              } catch (e: unknown) {
                toast.error("שגיאה ברישום תשלום לעובד", { description: getErrorMessage(e) });
              }
            }
          }
        }

        const uploadedAttachments: FinancialAttachment[] = [];
        for (const file of attachmentFiles) {
          const attachment = await uploadFinancialAttachment("session", savedSession.id, file);
          if (attachment?.document_id) uploadedAttachments.push(attachment);
        }

        toast.success(isEditingSession ? "המשמרת עודכנה" : "המשמרת נוספה");
        setAmount("");
        setCategory("");
        setCategoryOther("");
        setDescription("");
        setExpenseDate(projectDateOrToday(projectStartDate));
        setClockIn(projectLocalDateTimeWithTemplate(projectStartDate, defaultSessionClockIn, -60));
        setClockOut(projectLocalDateTimeWithTemplate(projectStartDate, defaultSessionClockOut, 0));
        setSessionUserId(sessionUsers[0]?.id ?? users[0]?.id ?? "");
        setNotes("");
        setBilledToCustomer(false);
        setAttachmentFiles([]);
        setExistingAttachments([]);
        setLaborCost("");
        setOriginalLaborCost("");
        setSessionBillableToCustomer(false);
        setBillToCustomerAmount("");
        setWorkerPaymentMode("none");
        setWorkerPaymentAmount("");
        setWorkerPaymentAmountTouched(false);
        lastAutoWorkerPaymentAmountRef.current = "";
        const sessionSavedResult = onSaved({
          source_type: "session",
          project_expense: null,
          expense: null,
          session: {
            ...savedSession,
            attachments: [...existingAttachments, ...uploadedAttachments],
          },
        });
        if (sessionSavedResult instanceof Promise) await sessionSavedResult;
      } catch (e: unknown) {
        toast.error(isEditingSession ? "שגיאה בעדכון משמרת" : "שגיאה בהוספת משמרת", {
          description: getErrorMessage(e),
        });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return;
    if (!expenseDate) return;

    const includedInBase = !billedToCustomer;

    setSubmitting(true);
    try {
      const res = await fetch(isEditing ? "/api/expenses/update" : "/api/expenses/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: getString(editingExpense, "id") ?? undefined,
          project_id: projectId,
          amount: amountNumber,
          category: finalCategory,
          description: description.trim() ? description : undefined,
          notes: notes.trim() ? notes : undefined,
          expense_date: expenseDate ? expenseDate : null,
          included_in_base_price: includedInBase,
          billed_to_customer: billedToCustomer,
          bill_to_customer_amount: billedToCustomer ? billToCustomerAmountNumber : null,
          payment_status: expensePaymentStatus,
          paid_amount: expensePaymentStatus === "partial" ? (Number(expensePaidAmount) || null) : null,
          payment_method: (expensePaymentStatus === "paid" || expensePaymentStatus === "partial") ? (expensePaymentMethod || null) : null,
          tag_ids: finalCategory === EXPENSE_CARS_CATEGORY ? tagIds : [],
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(isEditing ? "שגיאה בעדכון ההוצאה" : "שגיאה בהוספת הוצאה", {
          description: toHebrewError(json?.error, ""),
        });
        return;
      }
      toast.success(isEditing ? "ההוצאה עודכנה" : "ההוצאה נוספה");
      setAmount("");
      setCategory("");
      setCategoryOther("");
      setDescription("");
      setExpenseDate(projectDateOrToday(projectStartDate));
      setNotes("");
      setBilledToCustomer(false);
      setExpenseBillToCustomerAmount("");
      setExpensePaymentStatus("not_paid");
      setExpensePaidAmount("");
      setExpensePaymentMethod("");

      const savedExpense = json?.expense as Record<string, unknown> | undefined;
      const savedExpenseId =
        savedExpense && typeof savedExpense["id"] === "string"
          ? (savedExpense["id"] as string)
          : getString(editingExpense, "id");

      if (!savedExpenseId) {
        toast.error(isEditing ? "שגיאה בעדכון ההוצאה" : "שגיאה בהוספת הוצאה", {
          description: "Missing expense id",
        });
        return;
      }

      let expenseWithAttachment = savedExpense ?? editingExpense;
      const uploadedAttachments: FinancialAttachment[] = [];
      for (const file of attachmentFiles) {
        const attachment = await uploadFinancialAttachment("expense", savedExpenseId, file);
        if (attachment?.document_id) uploadedAttachments.push(attachment);
      }
      expenseWithAttachment = {
        ...(expenseWithAttachment ?? {}),
        attachments: [...existingAttachments, ...uploadedAttachments],
      };

      setAttachmentFiles([]);
      setExistingAttachments([]);

      const expenseSavedResult = onSaved({
        source_type: "expense",
        project_expense:
          (json?.projectExpense as Record<string, unknown> | undefined) ??
          editingItem?.project_expense ?? {
            expense_id: savedExpenseId,
            included_in_base_price: !billedToCustomer,
            billed_to_customer: billedToCustomer,
          },
        expense: expenseWithAttachment,
        session: null,
      });
      if (expenseSavedResult instanceof Promise) await expenseSavedResult;
    } catch (e: unknown) {
      toast.error(isEditing ? "שגיאה בעדכון ההוצאה" : "שגיאה בהוספת הוצאה", {
        description: getErrorMessage(e),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>
            {isEditingSession ? "עריכת שכר עובד" : isEditing ? "עריכת הוצאה" : "הוספת הוצאה"}
          </DialogTitle>
          <DialogDescription>
            {isEditingSession
              ? "עדכון פרטי משמרת העובד בפרויקט."
              : isEditing
              ? "עדכון פרטי ההוצאה ושיוך הפרויקט."
              : "ההוצאה תקושר לפרויקט ותופיע בפיננסי."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="text-xs text-muted-foreground">
            {"\u05e9\u05d3\u05d5\u05ea \u05d4\u05de\u05e1\u05d5\u05de\u05e0\u05d9\u05dd \u05d1-* \u05d4\u05dd \u05e9\u05d3\u05d5\u05ea \u05d7\u05d5\u05d1\u05d4."}
          </div>

          <div className="text-xs text-muted-foreground">
            {isSessionMode
              ? "בחירה בקטגוריית שכר עובד תשמור משמרת לפרויקט הזה במקום הוצאה רגילה."
              : "\u05d4\u05d4\u05d5\u05e6\u05d0\u05d4 \u05ea\u05d9\u05e9\u05de\u05e8 \u05e2\u05dd \u05e9\u05d9\u05d5\u05da \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05d4\u05e0\u05d5\u05db\u05d7\u05d9."}
          </div>

          {isSessionMode ? (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">עובד *</div>
                <select
                  value={sessionUserId}
                  onChange={(e) => setSessionUserId(e.target.value)}
                  aria-invalid={showSessionUserError}
                  className={
                    showSessionUserError
                      ? "h-10 w-full rounded-md border border-destructive bg-background px-3 text-sm focus-visible:ring-destructive"
                      : "h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  }
                >
                  <option value="">בחר עובד...</option>
                  {sessionUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name?.trim() || user.email}
                    </option>
                  ))}
                </select>
                {showSessionUserError ? (
                  <div className="text-xs text-destructive">{sessionUserError}</div>
                ) : null}
              </div>

              {!newWorkerOpen ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setNewWorkerOpen(true)}>
                  עובד חדש
                </Button>
              ) : (
                <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                  <div className="text-sm font-medium">הוספת עובד חדש</div>
                  <Input
                    value={newWorkerName}
                    onChange={(e) => setNewWorkerName(e.target.value)}
                    placeholder="שם עובד"
                  />
                  <Input
                    value={newWorkerPhone}
                    onChange={(e) => setNewWorkerPhone(e.target.value)}
                    placeholder="טלפון עובד"
                  />
                  <div className="text-xs text-muted-foreground">
                    עובד חדש ייווצר כרשומת עובד בלבד, בלי גישה למערכת.
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void createWorker()}
                      disabled={
                        newWorkerSubmitting ||
                        !newWorkerName.trim() ||
                        !newWorkerPhone.trim()
                      }
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
                        setNewWorkerName("");
                        setNewWorkerPhone("");
                        setNewWorkerRole("worker_no_access");
                      }}
                    >
                      ביטול
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {isSessionMode && showSessionTimingFields ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">שעת התחלה *</div>
                <DateTimeInput
                  value={clockIn}
                  onChange={(e) => {
                    setClockIn(e.target.value);
                    setClockInTouched(true);
                  }}
                  onBlur={() => setClockInTouched(true)}
                  aria-invalid={showClockInError}
                  className={showClockInError ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                <div className="text-xs text-muted-foreground">
                  אפשר להקליד ישירות בפורמט יום/חודש/שנה ושעה.
                </div>
                {showClockInError ? (
                  <div className="text-xs text-destructive">{clockInError}</div>
                ) : null}
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">שעת סיום *</div>
                <DateTimeInput
                  value={clockOut}
                  onChange={(e) => {
                    setClockOut(e.target.value);
                    setClockOutTouched(true);
                  }}
                  onBlur={() => setClockOutTouched(true)}
                  aria-invalid={showClockOutError}
                  className={showClockOutError ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                <div className="text-xs text-muted-foreground">מוצג ונערך בפורמט dd/mm/yy hh:mm.</div>
                {showClockOutError ? (
                  <div className="text-xs text-destructive">{clockOutError}</div>
                ) : null}
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">משך (שעות)</div>
                <Input
                  inputMode="numeric"
                  value={durationHours}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    if (!nextValue.trim()) {
                      setClockOut("");
                      setClockOutTouched(true);
                      return;
                    }
                    const parsedHours = Number(nextValue);
                    if (!Number.isFinite(parsedHours) || parsedHours <= 0) return;
                    const nextClockOut = addMinutes(
                      toIsoDateTime(clockIn),
                      Math.round(parsedHours * 60)
                    );
                    if (!nextClockOut) return;
                    setClockOut(toLocalDateTimeValue(nextClockOut.toISOString()));
                    setClockOutTouched(true);
                  }}
                  placeholder="למשל 8"
                />
                <div className="text-xs text-muted-foreground">
                  שינוי משך בשעות יעדכן את שעת הסיום אוטומטית.
                </div>
              </div>
            </div>
          ) : null}

          {isSessionMode && !showSessionTimingFields ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך *</div>
              <DateInput
                value={sessionDateValue}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!next) return;
                  setClockIn(`${next}T09:00`);
                  setClockOut(`${next}T10:00`);
                  setClockInTouched(true);
                  setClockOutTouched(true);
                }}
              />
            </div>
          ) : null}

          <AdaptiveGrid variant="formTwo">
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4 *"}</div>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setCategoryTouched(true);
                }}
                onBlur={() => setCategoryTouched(true)}
                aria-invalid={showCategoryError}
                disabled={isEditingSession}
                className={
                  showCategoryError
                    ? "border-destructive focus-visible:ring-destructive"
                    : "h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                }
              >
                <option value="">{"\u05d1\u05d7\u05d9\u05e8\u05ea \u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4..."}</option>
                {PROJECT_EXPENSE_CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {showCategoryError ? (
                <div className="text-xs text-destructive">{categoryError}</div>
              ) : null}
            </div>
            <div className="space-y-1">
              {showSessionPriceField ? (
              <>
              <div className="text-sm font-medium">
                {isSessionMode ? "עלות עבודה" : "\u05e1\u05db\u05d5\u05dd *"}
              </div>
              <CurrencyInput
                inputMode="numeric"
                value={isSessionMode ? laborCost : amount}
                onChange={(e) => {
                  if (isSessionMode) {
                    setLaborCost(e.target.value);
                    setLaborCostTouched(true);
                    return;
                  }
                  setAmount(e.target.value);
                  setAmountTouched(true);
                }}
                onBlur={() => {
                  if (isSessionMode) {
                    setLaborCostTouched(true);
                    return;
                  }
                  setAmountTouched(true);
                }}
                placeholder={isSessionMode ? "למשל 500" : "\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: 250"}
                aria-invalid={isSessionMode ? showLaborCostError : showAmountError}
                className={
                  isSessionMode
                    ? showLaborCostError
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                    : showAmountError
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                }
              />
              {isSessionMode ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    אם משאירים ריק, העלות תחושב אוטומטית לפי הסכם השכר והשעות הנוספות.
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {suggestedWorkerPaymentAmount !== null
                      ? `סה״כ לתשלום עבור המשמרת: ${formatIls(suggestedWorkerPaymentAmount)}`
                      : "הסכום שמגיע לעובד יוצג כאן אחרי הזנת שעות תקינות או עלות עבודה."}
                  </div>
                  {isEditingSession && suggestedWorkerPaymentAmount !== null ? (
                    <div className="text-xs text-muted-foreground">
                      שולם עד עכשיו: {formatIls(existingWorkerPaidAmount)}{" "}
                      {`• יתרה לתשלום: ${formatIls(remainingWorkerOwedAmount)}`}
                    </div>
                  ) : null}
                  {showLaborCostError ? (
                    <div className="text-xs text-destructive">{laborCostError}</div>
                  ) : null}
                </>
              ) : showAmountError ? (
                <div className="text-xs text-destructive">{amountError}</div>
              ) : null}
              </>
              ) : (
              <>
                <div className="text-sm font-medium">עלות חישוב אוטומטי</div>
                <div className="text-xs text-muted-foreground">
                  {suggestedWorkerPaymentAmount !== null
                    ? `סה״כ לתשלום עבור המשמרת: ${formatIls(suggestedWorkerPaymentAmount)}`
                    : "העלות תחושב אוטומטית לפי הסכם השכר לאחר שמירה."}
                </div>
              </>
              )}
            </div>
          </AdaptiveGrid>

          {category === OTHER_PROJECT_EXPENSE_CATEGORY ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05de\u05d4 \u05d4\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4? *"}</div>
              <Input
                value={categoryOther}
                onChange={(e) => {
                  setCategoryOther(e.target.value);
                  setCategoryOtherTouched(true);
                }}
                onBlur={() => setCategoryOtherTouched(true)}
                placeholder={"\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: \u05d3\u05dc\u05e7"}
                aria-invalid={showCategoryError}
                className={
                  showCategoryError
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
              {showCategoryError ? (
                <div className="text-xs text-destructive">{categoryError}</div>
              ) : null}
            </div>
          ) : null}

          {!isSessionMode && finalCategory === EXPENSE_CARS_CATEGORY ? (
            <TagPicker value={tagIds} onChange={setTagIds} />
          ) : null}

          {!isSessionMode ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05ea\u05d9\u05d0\u05d5\u05e8 (\u05d0\u05d5\u05e4\u05e6\u05d9\u05d5\u05e0\u05dc\u05d9)"}</div>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={"\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: \u05e0\u05e1\u05d9\u05e2\u05d4 \u05dc\u05d0\u05ea\u05e8"}
              />
            </div>
          ) : null}

          {!isSessionMode ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">{"תאריך *"}</div>
              <DateInput
                value={expenseDate}
                onChange={(e) => {
                  setExpenseDate(e.target.value);
                  setExpenseDateTouched(true);
                }}
                onBlur={() => setExpenseDateTouched(true)}
                aria-invalid={showExpenseDateError}
                className={
                  showExpenseDateError
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
              {showExpenseDateError ? (
                <div className="text-xs text-destructive">{expenseDateError}</div>
              ) : null}
            </div>
          ) : null}

          {!isSessionMode ? (
            <>
              <div className="space-y-1">
                <div className="text-sm font-medium">סטטוס תשלום</div>
                <select
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                  value={expensePaymentStatus}
                  onChange={(e) => setExpensePaymentStatus(e.target.value as "paid" | "partial" | "not_paid")}
                >
                  <option value="not_paid">לא שולם</option>
                  <option value="partial">חלקי</option>
                  <option value="paid">שולם</option>
                </select>
              </div>
              {(expensePaymentStatus === "paid" || expensePaymentStatus === "partial") && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">אמצעי תשלום</div>
                    <select
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={expensePaymentMethod}
                      onChange={(e) => setExpensePaymentMethod(e.target.value)}
                    >
                      <option value="">בחר אמצעי</option>
                      {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {expensePaymentStatus === "partial" && (
                    <div className="space-y-1">
                      <div className="text-sm font-medium">סכום ששולם</div>
                      <CurrencyInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={expensePaidAmount}
                        onChange={(e) => setExpensePaidAmount(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}

            {isSessionMode ? (
              <section className="space-y-3 rounded-xl border bg-muted/30 p-4">
                <h4 className="text-sm font-semibold">חיוב הלקוח</h4>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sessionBillableToCustomer}
                    onChange={(e) => {
                      setSessionBillableToCustomer(e.target.checked);
                      if (!e.target.checked) {
                        setBillToCustomerAmount("");
                        setBillToCustomerAmountTouched(false);
                      }
                    }}
                  />
                  <span>לחיוב לקוח</span>
                </label>
                <div className="text-xs text-muted-foreground">
                  {sessionBillableToCustomer
                    ? "המשמרת תופיע ברשימת חיובי הלקוח ולא בתזרים."
                    : "אם לא מסומן, עלות העבודה תישאר כהוצאה פנימית בלבד."}
                </div>

                {sessionBillableToCustomer ? (
                  <div className="space-y-1">
                    <div className="text-sm font-medium">סכום לחיוב לקוח *</div>
                    <CurrencyInput
                      inputMode="numeric"
                      value={billToCustomerAmount}
                      onChange={(e) => {
                        setBillToCustomerAmount(e.target.value);
                        setBillToCustomerAmountTouched(true);
                      }}
                      onBlur={() => setBillToCustomerAmountTouched(true)}
                      placeholder="למשל 650"
                      aria-invalid={showBillToCustomerAmountError}
                      className={
                        showBillToCustomerAmountError
                          ? "border-destructive focus-visible:ring-destructive"
                          : ""
                      }
                    />
                    {showBillToCustomerAmountError ? (
                      <div className="text-xs text-destructive">{billToCustomerAmountError}</div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {isSessionMode ? (
              <section className="space-y-3 rounded-xl border bg-muted/30 p-4">
                <h4 className="text-sm font-semibold">תשלום לעובד</h4>
                <div className="space-y-1">
                  <div className="text-sm font-medium">סטטוס תשלום לעובד</div>
                  <select
                    value={workerPaymentMode}
                    onChange={(e) => {
                      const next = (e.target.value as "none" | "paid" | "partial") || "none";
                      setWorkerPaymentMode(next);
                      if (next === "none") {
                        setWorkerPaymentAmount("");
                        setWorkerPaymentAmountTouched(false);
                        lastAutoWorkerPaymentAmountRef.current = "";
                      } else if (next === "paid" && suggestedWorkerPaymentAmount !== null) {
                        const nextAmount = String(Number(suggestedWorkerPaymentAmount.toFixed(2)));
                        setWorkerPaymentAmount(nextAmount);
                        setWorkerPaymentAmountTouched(false);
                        lastAutoWorkerPaymentAmountRef.current = nextAmount;
                      }
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="none">לא שולם</option>
                    <option value="paid">שולם במלואו</option>
                    <option value="partial">שולם חלקית</option>
                  </select>
                  <div className="text-xs text-muted-foreground">
                    אפשר לרשום כאן תשלום לעובד (מלא או חלקי) שיקוזז מהיתרה בפרויקט.
                  </div>
                </div>

                {workerPaymentMode !== "none" ? (
                  <div className="space-y-1">
                    <div className="text-sm font-medium">סכום לתשלום לעובד *</div>
                    <CurrencyInput
                      inputMode="numeric"
                      value={workerPaymentAmount}
                      onChange={(e) => {
                        setWorkerPaymentAmount(e.target.value);
                        setWorkerPaymentAmountTouched(true);
                      }}
                      onBlur={() => setWorkerPaymentAmountTouched(true)}
                      placeholder={
                        workerPaymentMode === "paid"
                          ? "מחושב אוטומטית"
                          : "למשל 300"
                      }
                      aria-invalid={showWorkerPaymentAmountError}
                      readOnly={workerPaymentMode === "paid"}
                      className={
                        showWorkerPaymentAmountError
                          ? "border-destructive focus-visible:ring-destructive"
                          : ""
                      }
                    />
                    <div className="text-xs text-muted-foreground">
                      {activeSalaryAgreement?.salary_type === "hourly"
                        ? "הסכום מחושב אוטומטית לפי ההסכם השעתי והשעות שהוזנו."
                        : "אם לעובד אין הסכם שעתי פעיל, הסכום נלקח מעלות העבודה שהוזנה."}
                    </div>
                    {showWorkerPaymentAmountError ? (
                      <div className="text-xs text-destructive">{workerPaymentAmountError}</div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {!isSessionMode ? (
              <section className="space-y-3 rounded-xl border bg-muted/30 p-4">
                <h4 className="text-sm font-semibold">חיוב הלקוח</h4>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={billedToCustomer}
                    onChange={(e) => {
                      setBilledToCustomer(e.target.checked);
                      if (!e.target.checked) setExpenseBillToCustomerAmount("");
                    }}
                  />
                  <span>לחיוב לקוח</span>
                </label>
                <div className="text-xs text-muted-foreground">
                  {billedToCustomer
                    ? "ההוצאה תופיע ברשימת חיובי הלקוח ולא בתזרים."
                    : "אם לא מסומן, ההוצאה נכללת בבסיס כברירת מחדל."
                  }
                </div>
                {billedToCustomer ? (
                  <div className="space-y-1">
                    <div className="text-sm font-medium">סכום לחיוב לקוח *</div>
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

          <div className="space-y-1">
            <div className="text-sm font-medium">{"\u05d4\u05e2\u05e8\u05d5\u05ea (\u05d0\u05d5\u05e4\u05e6\u05d9\u05d5\u05e0\u05dc\u05d9)"}</div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={"\u05d4\u05e2\u05e8\u05d5\u05ea \u05e4\u05e0\u05d9\u05de\u05d9\u05d5\u05ea..."}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">קבצים מצורפים (אופציונלי)</div>
            <div className="flex items-center gap-2">
              <FileUploadActions
                files={attachmentFiles}
                multiple
                onFilesSelected={setAttachmentFiles}
                chooseLabel={attachmentFiles.length > 0 || existingAttachments.length > 0 ? "הוסף קבצים" : "העלה קבצים"}
                chooseVariant="outline"
                size="sm"
              />
              {attachmentFiles.length > 0 ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setAttachmentFiles([])}>
                  נקה בחירה
                </Button>
              ) : null}
            </div>
            {existingAttachments.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">קבצים קיימים</div>
                <div className="flex flex-wrap gap-2">
                  {existingAttachments.map((attachment) => (
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
                  {existingAttachments
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

          <DialogFooter className="mt-6">
            {!canSubmit && !submitting ? (
              <div className="me-auto text-xs text-destructive">{addExpenseValidationMessage}</div>
            ) : (
              <div className="me-auto" />
            )}
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {"\u05d1\u05d9\u05d8\u05d5\u05dc"}
            </Button>
            <Button type="submit" disabled={submitting || !canSubmit}>
              {submitting ? "\u05e9\u05d5\u05de\u05e8..." : isEditing ? "עדכון" : "\u05e9\u05de\u05d9\u05e8\u05d4"}
            </Button>
          </DialogFooter>
        </form>
      </AdaptiveDialog>
    </Dialog>
  );
}
export function AddIncomeDialog({
  open,
  onOpenChange,
  projectId,
  projectType,
  projectStartDate,
  vatRate,
  priceIncludesVat,
  editingPayment,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectType: string | null;
  projectStartDate: string | null;
  vatRate: number;
  priceIncludesVat: boolean;
  editingPayment: PaymentRow | null;
  onSaved: (saved: PaymentRow) => void;
}) {
  const isEditing = Boolean(editingPayment);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [paymentDateTouched, setPaymentDateTouched] = useState(false);
  const [paymentMethodTouched, setPaymentMethodTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(projectDateOrToday(projectStartDate));
  const [paymentMethod, setPaymentMethod] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [requiresSplit, setRequiresSplit] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<FinancialAttachment[]>([]);
  const requiresDueDate = paymentMethod === "check";
  const canSubmit =
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    Boolean(paymentDate) &&
    Boolean(paymentMethod.trim()) &&
    (!requiresDueDate || Boolean(dueDate));

  const amountNumber = Number(amount);
  const amountError =
    !amount.trim()
      ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4"
      : !Number.isFinite(amountNumber)
      ? "\u05d7\u05d9\u05d9\u05d1 \u05dc\u05d4\u05d9\u05d5\u05ea \u05de\u05e1\u05e4\u05e8"
      : amountNumber <= 0
      ? "\u05d7\u05d9\u05d9\u05d1 \u05dc\u05d4\u05d9\u05d5\u05ea \u05d2\u05d3\u05d5\u05dc \u05de-0"
      : null;
  const paymentDateError = !paymentDate ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4" : null;
  const paymentMethodError = !paymentMethod.trim() ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4" : null;
  const dueDateError = requiresDueDate && !dueDate ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4" : null;

  const showAmountError = (submitAttempted || amountTouched) && Boolean(amountError);
  const showPaymentDateError =
    (submitAttempted || paymentDateTouched) && Boolean(paymentDateError);
  const showPaymentMethodError =
    (submitAttempted || paymentMethodTouched) && Boolean(paymentMethodError);

  const addIncomeValidationMessage = (() => {
    if (!submitAttempted || submitting || canSubmit) return "";
    const missing: string[] = [];
    if (amountError) missing.push("\u05e1\u05db\u05d5\u05dd");
    if (paymentDateError) missing.push("\u05ea\u05d0\u05e8\u05d9\u05da");
    if (paymentMethodError) missing.push("\u05d0\u05de\u05e6\u05e2\u05d9 \u05ea\u05e9\u05dc\u05d5\u05dd");
    if (dueDateError) missing.push("\u05ea\u05d0\u05e8\u05d9\u05da \u05e4\u05d9\u05e8\u05e2\u05d5\u05df");
    return missing.length > 0
      ? `\u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05de\u05d5\u05e8: ${missing.join(", ")}`
      : "";
  })();

  useEffect(() => {
    if (!open) return;
    setSubmitAttempted(false);
    setAmountTouched(false);
    setPaymentDateTouched(false);
    setPaymentMethodTouched(false);
    setAmount(
      editingPayment && toNumber(editingPayment.amount_total) !== null
        ? String(toNumber(editingPayment.amount_total))
        : ""
    );
    setPaymentDate(editingPayment?.payment_date ?? projectDateOrToday(projectStartDate));
    setPaymentMethod(editingPayment?.payment_method ?? "");
    setDueDate(editingPayment?.due_date ?? "");
    setRequiresSplit(Boolean(editingPayment?.requires_split));
    setReferenceNumber(editingPayment?.reference_number ?? "");
    setCheckNumber(editingPayment?.check_number ?? "");
    setNotes(editingPayment?.notes ?? "");
    setAttachmentFiles([]);
    setExistingAttachments(Array.isArray(editingPayment?.attachments) ? editingPayment.attachments : []);
  }, [editingPayment, open, projectStartDate]);

  async function submit() {
    setSubmitAttempted(true);

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return;
    if (!paymentDate) return;
    if (!paymentMethod.trim()) return;
    if (paymentMethod === "check" && !dueDate) return;

    setSubmitting(true);
    try {
      const res = await fetch(isEditing ? "/api/payments/update" : "/api/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editingPayment?.id ?? undefined,
          business_domain: mapProjectTypeToExpenseDomain(projectType),
          project_id: projectId,
          amount_total: amountNumber,
          payment_date: paymentDate ? paymentDate : null,
          due_date: dueDate.trim() || null,
          // Price-includes-VAT projects always record payments in full.
          requires_split: priceIncludesVat ? false : requiresSplit,
          payment_method: paymentMethod.trim() ? paymentMethod : undefined,
          reference_number: referenceNumber.trim() ? referenceNumber : undefined,
          check_number:
            paymentMethod === "check" && checkNumber.trim() ? checkNumber.trim() : undefined,
          notes: notes.trim() ? notes : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(isEditing ? "שגיאה בעדכון ההכנסה" : "שגיאה בהוספת ההכנסה", {
          description: toHebrewError(json?.error, ""),
        });
        return;
      }
      const savedPayment = (json?.payment as PaymentRow | undefined) ?? editingPayment;
      if (!savedPayment?.id) {
        toast.error(isEditing ? "שגיאה בעדכון ההכנסה" : "שגיאה בהוספת ההכנסה", {
          description: "Missing payment id",
        });
        return;
      }

      let paymentWithAttachment = savedPayment;
      const uploadedAttachments: FinancialAttachment[] = [];
      for (const file of attachmentFiles) {
        const attachment = await uploadFinancialAttachment("payment", savedPayment.id, file);
        if (attachment?.document_id) uploadedAttachments.push(attachment);
      }
      paymentWithAttachment = {
        ...savedPayment,
        attachments: [...existingAttachments, ...uploadedAttachments],
      };

      toast.success(isEditing ? "ההכנסה עודכנה" : "ההכנסה נוספה");
      setAmount("");
      setPaymentDate(projectDateOrToday(projectStartDate));
      setPaymentMethod("");
      setDueDate("");
      setRequiresSplit(false);
      setReferenceNumber("");
      setCheckNumber("");
      setNotes("");
      setAttachmentFiles([]);
      setExistingAttachments([]);
      onSaved(paymentWithAttachment);
    } catch (e: unknown) {
      toast.error(isEditing ? "שגיאה בעדכון ההכנסה" : "שגיאה בהוספת ההכנסה", {
        description: getErrorMessage(e),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "עריכת הכנסה" : "\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05db\u05e0\u05e1\u05d4"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "עדכון פרטי ההכנסה של הפרויקט."
              : "\u05d4\u05d4\u05db\u05e0\u05e1\u05d4 \u05ea\u05d9\u05e8\u05e9\u05dd \u05db\u05ea\u05e7\u05d1\u05d5\u05dc \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="text-xs text-muted-foreground">
            {"\u05e9\u05d3\u05d5\u05ea \u05d4\u05de\u05e1\u05d5\u05de\u05e0\u05d9\u05dd \u05d1-* \u05d4\u05dd \u05e9\u05d3\u05d5\u05ea \u05d7\u05d5\u05d1\u05d4."}
          </div>

          <AdaptiveGrid variant="formTwo">
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05e1\u05db\u05d5\u05dd *"}</div>
              <CurrencyInput
                inputMode="numeric"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountTouched(true);
                }}
                onBlur={() => setAmountTouched(true)}
                placeholder={"\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: 5000"}
                aria-invalid={showAmountError}
                className={
                  showAmountError ? "border-destructive focus-visible:ring-destructive" : ""
                }
              />
              {showAmountError ? (
                <div className="text-xs text-destructive">{amountError}</div>
              ) : null}
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05ea\u05d0\u05e8\u05d9\u05da *"}</div>
              <DateInput
                value={paymentDate}
                onChange={(e) => {
                  setPaymentDate(e.target.value);
                  setPaymentDateTouched(true);
                }}
                onBlur={() => setPaymentDateTouched(true)}
                aria-invalid={showPaymentDateError}
                className={
                  showPaymentDateError
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
              {showPaymentDateError ? (
                <div className="text-xs text-destructive">{paymentDateError}</div>
              ) : null}
            </div>
          </AdaptiveGrid>

          <AdaptiveGrid variant="formTwo">
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05d0\u05de\u05e6\u05e2\u05d9 \u05ea\u05e9\u05dc\u05d5\u05dd *"}</div>
              <select
                value={paymentMethod}
                onChange={(e) => {
                  setPaymentMethod(e.target.value);
                  setPaymentMethodTouched(true);
                }}
                onBlur={() => setPaymentMethodTouched(true)}
                aria-invalid={showPaymentMethodError}
                className={
                  showPaymentMethodError
                    ? "h-10 w-full rounded-md border border-destructive bg-background px-3 text-sm focus-visible:ring-destructive"
                    : "h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                }
              >
                <option value="">בחר אמצעי תשלום...</option>
                {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {showPaymentMethodError ? (
                <div className="text-xs text-destructive">{paymentMethodError}</div>
              ) : null}
              {requiresDueDate ? (
                <div className="text-xs text-muted-foreground">
                  {"צ'ק נשמר כ\"ממתין לפירעון\" עד לתאריך הפירעון."}
                </div>
              ) : null}
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {requiresDueDate ? "תאריך פירעון *" : "תאריך פירעון צפוי (אופציונלי)"}
              </div>
              <DateInput
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-invalid={Boolean(dueDateError)}
                className={
                  dueDateError ? "border-destructive focus-visible:ring-destructive" : ""
                }
              />
              {dueDateError ? (
                <div className="text-xs text-destructive">{dueDateError}</div>
              ) : !requiresDueDate ? (
                <div className="text-[11px] text-muted-foreground">
                  לתשלומים עתידיים (למשל שוטף+30) — נרשמים כממתינים עד התאריך הזה.
                </div>
              ) : null}
            </div>
          </AdaptiveGrid>

          <AdaptiveGrid variant="formTwo">
            <div className="space-y-1">
              <div className="text-sm font-medium">אסמכתא (אופציונלי)</div>
              <Input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="מספר קבלה/העברה"
              />
            </div>
            {requiresDueDate ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">מספר צ׳ק</div>
                <Input
                  value={checkNumber}
                  onChange={(e) => setCheckNumber(e.target.value)}
                  placeholder="לדוגמה 123456"
                  inputMode="numeric"
                />
                <div className="text-xs text-muted-foreground">
                  ניתן לצרף צילום של הצ&apos;ק במקטע &quot;קבצים מצורפים&quot; למטה.
                </div>
              </div>
            ) : null}
          </AdaptiveGrid>

          {priceIncludesVat ? (
            <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              מחיר הפרויקט כולל מע״מ — כל תשלום נזקף במלואו ליעד. אין צורך לסמן ״תשלום רשמי״.
            </div>
          ) : (
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requiresSplit}
                  onChange={(e) => setRequiresSplit(e.target.checked)}
                />
                <span>תשלום רשמי (כולל מע״מ {Math.round(vatRate * 10000) / 100}%)</span>
              </label>
              {requiresSplit && Number.isFinite(Number(amount)) && Number(amount) > 0
                ? (() => {
                    const gross = Number(amount);
                    const net = Math.round((gross / (1 + vatRate)) * 100) / 100;
                    const vat = Math.round((gross - net) * 100) / 100;
                    const fmt = (n: number) =>
                      new Intl.NumberFormat("he-IL", {
                        style: "currency",
                        currency: "ILS",
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      }).format(n);
                    return (
                      <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        מתוך {fmt(gross)} — <span className="font-medium text-foreground">{fmt(net)}</span> ייזקפו
                        למחיר הפרויקט · {fmt(vat)} מע״מ.
                      </div>
                    );
                  })()
                : null}
            </div>
          )}

          <div className="space-y-1">
            <div className="text-sm font-medium">{"\u05d4\u05e2\u05e8\u05d5\u05ea (\u05d0\u05d5\u05e4\u05e6\u05d9\u05d5\u05e0\u05dc\u05d9)"}</div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={"\u05d4\u05e2\u05e8\u05d5\u05ea..."}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">קבצים מצורפים (אופציונלי)</div>
            <div className="flex items-center gap-2">
              <FileUploadActions
                files={attachmentFiles}
                multiple
                onFilesSelected={setAttachmentFiles}
                chooseLabel={attachmentFiles.length > 0 || existingAttachments.length > 0 ? "הוסף קבצים" : "העלה קבצים"}
                chooseVariant="outline"
                size="sm"
              />
              {attachmentFiles.length > 0 ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setAttachmentFiles([])}>
                  נקה בחירה
                </Button>
              ) : null}
            </div>
            {existingAttachments.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">קבצים קיימים</div>
                <div className="flex flex-wrap gap-2">
                  {existingAttachments.map((attachment) => (
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
                  {existingAttachments
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

          <DialogFooter className="mt-6">
            {!canSubmit && !submitting ? (
              <div className="me-auto text-xs text-destructive">{addIncomeValidationMessage}</div>
            ) : (
              <div className="me-auto" />
            )}
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {"\u05d1\u05d9\u05d8\u05d5\u05dc"}
            </Button>
            <Button type="submit" disabled={submitting || !canSubmit}>
              {submitting ? "\u05e9\u05d5\u05de\u05e8..." : isEditing ? "עדכון" : "\u05e9\u05de\u05d9\u05e8\u05d4"}
            </Button>
          </DialogFooter>
        </form>
      </AdaptiveDialog>
    </Dialog>
  );
}

