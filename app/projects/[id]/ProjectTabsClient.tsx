"use client";

import type { AuditRecordInfo } from "@/lib/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import Link from "next/link";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientOnly } from "@/components/ClientOnly";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  emitNavigationStart,
  emitProgressActivityEnd,
  emitProgressActivityStart,
} from "@/components/layout/TopNavigationProgress";
import {
  ORDER_PAYMENT_METHOD_OPTIONS,
  paymentMethodLabel,
  paymentStatusClasses,
  paymentStatusLabel,
} from "@/lib/orders/paymentStatus";
import {
  type PaymentRow,
  type FinancialAttachment,
} from "@/lib/payments";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  mapProjectTypeToExpenseDomain,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import {
  addMinutes,
  calculateSessionLaborCost,
  formatMinutes,
  getActiveSalaryAgreementForDate,
  sessionWorkedMinutes,
  type SalaryAgreementRow,
  type WorkSessionRow,
} from "@/lib/payroll";
import {
  normalizePayrollWorkerType,
  shouldShowSessionHours,
  shouldShowSessionPrice,
  type PayrollWorkerType,
} from "@/lib/payroll-worker-type";
import { getStatusDotClasses } from "@/lib/ui/status-color-classes";
import {
  getTaskPriorityColor,
  getTaskPriorityLabel,
  getTaskStatusColor,
  getTaskStatusLabel,
} from "@/lib/ui/status-colors";
import { TaskUpsertDialog } from "@/components/tasks/TaskUpsertDialog";
import MorningDocumentsPanel from "@/components/morning/MorningDocumentsPanel";
import type { MorningLocalDocument } from "@/lib/morning/types";

export type ProjectOverview = {
  id: string;
  name: string;
  status: string;
  project_type: string;
  start_date: string | null;
  end_date: string | null;
  agreed_base_price: string | number | null;
  actual_price: string | number | null;
  expenses_billed_separately: boolean | null;
  customer_id: string;
  customer_name: string;
  project_manager_id: string | null;
  project_manager_name: string | null;
  notes: string | null;
  items_to_move: string[] | null;
  created_at: string;
  updated_at: string;
};

export type ProjectFinancials = {
  id: string;
  agreed_base_price: string | number | null;
  actual_price: string | number | null;
  total_expenses: string | number | null;
  expenses_billed: string | number | null;
  customer_total_price: string | number | null;
  gross_profit: string | number | null;
} | null;

export type ProjectTaskProgress = {
  project_id: string;
  total_tasks: number | string | null;
  completed_tasks: number | string | null;
  open_tasks: number | string | null;
} | null;

export type ProjectWorkerBalance = {
  project_id: string;
  earned_amount: number | string | null;
  paid_amount: number | string | null;
  owed_amount: number | string | null;
} | null;

export type ProjectExpenseSummary = {
  project_id: string;
  expense_count: number | string | null;
  total_expenses: number | string | null;
  expenses_included: number | string | null;
  expenses_billed: number | string | null;
} | null;

export type ExpenseListItem = {
  source_type: "expense" | "session";
  project_expense: Record<string, unknown> | null;
  expense: Record<string, unknown> | null;
  session: WorkSessionRow | null;
};

export type AssignableUser = {
  id: string;
  full_name: string | null;
  email: string;
  role: string | null;
  active: boolean | null;
  payroll_worker_type: PayrollWorkerType | null;
  pay_tracking_mode: string | null;
};

export type ProjectSalaryAgreement = SalaryAgreementRow;

type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
type TaskPriority = "low" | "medium" | "high" | "urgent";
type CustomerPaymentStatus = "paid" | "partial" | "unpaid" | "unpriced";
type PendingProjectDeletion =
  | { kind: "expense"; item: ExpenseListItem }
  | { kind: "session"; item: ExpenseListItem }
  | { kind: "payment"; payment: PaymentRow };

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

function formatDate(value: string | null) {
  return formatShortDate(value, "—");
}

function formatDateTime(value: string | null) {
  return formatShortDateTime(value, "—");
}

function formatTimeOnly(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isSameDay(a: string | null, b: string | null) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function LtrInline({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      dir="ltr"
      className={["inline-block text-left tabular-nums", className].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  );
}

function paymentRecordedByLabel(payment: PaymentRow, {
  paymentRecordedByNameByValue,
  paymentAuditById,
}: {
  paymentRecordedByNameByValue: Record<string, string>;
  paymentAuditById: Record<string, AuditRecordInfo>;
}) {
  const recordedByValue = typeof payment.recorded_by === "string" ? payment.recorded_by : null;
  if (recordedByValue && paymentRecordedByNameByValue[recordedByValue]) {
    return `הוזן ע״י ${paymentRecordedByNameByValue[recordedByValue]}`;
  }

  const audit = paymentAuditById[payment.id];
  if (audit?.action === "create") {
    return `הוזן ע״י ${audit.actorName}`;
  }

  return null;
}

function expenseRecordedByLabel(item: ExpenseListItem, {
  expenseRecordedByNameByValue,
  expenseAuditById,
}: {
  expenseRecordedByNameByValue: Record<string, string>;
  expenseAuditById: Record<string, AuditRecordInfo>;
}) {
  if (item.source_type !== "expense") return null;

  const expenseId = getString(item.expense, "id");
  const recordedByValue = getString(item.expense, "recorded_by");

  if (recordedByValue && expenseRecordedByNameByValue[recordedByValue]) {
    return `הוזן ע״י ${expenseRecordedByNameByValue[recordedByValue]}`;
  }

  if (expenseId) {
    const audit = expenseAuditById[expenseId];
    if (audit?.action === "create") {
      return `הוזן ע״י ${audit.actorName}`;
    }
  }

  return null;
}

function deriveCustomerPaymentStatus(totalDue: number | null, paidTotal: number): CustomerPaymentStatus {
  if (totalDue === null || totalDue <= 0) return "unpriced";
  if (paidTotal + 0.009 >= totalDue) return "paid";
  if (paidTotal > 0) return "partial";
  return "unpaid";
}

function customerPaymentStatusLabel(status: CustomerPaymentStatus) {
  if (status === "unpriced") return "לא סוכם תשלום";
  return paymentStatusLabel(status);
}

function customerPaymentStatusBadgeClasses(status: CustomerPaymentStatus) {
  if (status === "unpriced") return "border-border bg-background text-muted-foreground";
  return paymentStatusClasses(status);
}

function sessionPaymentStatus(session: WorkSessionRow | null | undefined) {
  const explicitStatus = typeof session?.payment_status === "string" ? session.payment_status : "";
  if (explicitStatus) return explicitStatus;

  const paidAmount = Math.max(0, toNumber(session?.paid_amount) ?? 0);
  const laborCost = Math.max(0, toNumber(session?.labor_cost) ?? 0);
  if (!(paidAmount > 0)) return "unpaid";
  if (laborCost > 0 && paidAmount + 0.009 < laborCost) return "partial";
  return "paid";
}

function getString(row: Record<string, unknown> | null, key: string) {
  if (!row) return null;
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getFirstString(row: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = getString(row, key);
    if (value) return value;
  }
  return null;
}

function getFirstDate(row: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = getString(row, key);
    if (value) return value;
  }
  return null;
}

function sessionLaborCost(session: WorkSessionRow | null | undefined) {
  return Math.max(0, toNumber(session?.labor_cost) ?? 0);
}

function isSessionBillable(session: WorkSessionRow | null | undefined) {
  return session?.is_billable_to_customer === true;
}

function sessionBillToCustomerAmount(session: WorkSessionRow | null | undefined) {
  if (!isSessionBillable(session)) return 0;
  return Math.max(0, toNumber(session?.bill_to_customer_amount) ?? 0);
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
  return (json?.attachment ?? null) as
    | FinancialAttachment
    | null;
}

function taskStatusLabel(status: TaskStatus | string) {
  return getTaskStatusLabel(status);
}

function taskPriorityLabel(priority: TaskPriority | string) {
  return getTaskPriorityLabel(priority);
}

type CashFlowEvent =
  | {
      type: "income";
      id: string;
      date: string | null;
      amount: number | null;
      title: string;
      meta: string[];
    }
  | {
      type: "expense";
      id: string;
      date: string | null;
      amount: number | null;
      title: string;
      meta: string[];
      includedInBase: boolean;
      billedToCustomer: boolean;
    };

export default function ProjectTabsClient({
  viewerRole,
  overview,
  financials,
  tasks,
  projectTasks,
  projectTasksError,
  projectDocuments,
  projectDocumentsError,
  assignableUsers,
  assignableUsersError,
  expenses,
  expensesError,
  expenseRecordedByNameByValue,
  expenseAuditById,
  payments,
  paymentsError,
  morningDocuments,
  morningDocumentsError,
  paymentRecordedByNameByValue,
  paymentAuditById,
  paymentAuditError,
  workerBalance,
  salaryAgreements,
}: {
  viewerRole: string | null;
  overview: ProjectOverview;
  financials: ProjectFinancials;
  tasks: ProjectTaskProgress;
  projectTasks: Record<string, unknown>[];
  projectTasksError: string | null;
  projectDocuments: Array<{
    document_id: string;
    storage_key: string | null;
    file_name: string | null;
    title: string | null;
    document_type: string | null;
    entity_type: string | null;
    entity_id: string | null;
    uploaded_at: string | null;
    uploaded_by_name: string | null;
    url: string | null;
  }>;
  projectDocumentsError: string | null;
  assignableUsers: AssignableUser[];
  assignableUsersError: string | null;
  expenses: ExpenseListItem[];
  expensesError: string | null;
  expenseRecordedByNameByValue: Record<string, string>;
  expenseAuditById: Record<string, AuditRecordInfo>;
  payments: PaymentRow[];
  paymentsError: string | null;
  morningDocuments: MorningLocalDocument[];
  morningDocumentsError: string | null;
  paymentRecordedByNameByValue: Record<string, string>;
  paymentAuditById: Record<string, AuditRecordInfo>;
  paymentAuditError: string | null;
  workerBalance: ProjectWorkerBalance;
  salaryAgreements: ProjectSalaryAgreement[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [isExpenseRefreshPending, startExpenseRefreshTransition] = useTransition();
  const expenseRefreshResolveRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!isExpenseRefreshPending && expenseRefreshResolveRef.current) {
      const resolve = expenseRefreshResolveRef.current;
      expenseRefreshResolveRef.current = null;
      resolve();
    }
  }, [isExpenseRefreshPending]);
  function expenseRefreshAndWait() {
    return new Promise<void>((resolve) => {
      expenseRefreshResolveRef.current = resolve;
      startExpenseRefreshTransition(() => { router.refresh(); });
    });
  }
  const [docsUploading, setDocsUploading] = useState(false);
  const [docsFilterCategory, setDocsFilterCategory] = useState<string>("");
  const [expensesUi, setExpensesUi] = useState<ExpenseListItem[]>(expenses);
  const [paymentsUi, setPaymentsUi] = useState<PaymentRow[]>(payments);
  const [morningBillingOpen, setMorningBillingOpen] = useState(false);
  const [projectTasksUi, setProjectTasksUi] =
    useState<Record<string, unknown>[]>(projectTasks);
  const firstWorkerSessionDefaults = useMemo(() => {
    const orderedSessions = expensesUi
      .filter(
        (item): item is ExpenseListItem & { source_type: "session"; session: WorkSessionRow } =>
          item.source_type === "session" && Boolean(item.session?.clock_in)
      )
      .sort((a, b) => {
        const aTime = new Date(a.session.clock_in).getTime();
        const bTime = new Date(b.session.clock_in).getTime();
        return aTime - bTime;
      });

    return {
      clockIn: orderedSessions[0]?.session.clock_in ?? null,
      clockOut: orderedSessions[0]?.session.clock_out ?? null,
    };
  }, [expensesUi]);

  const sortedExpensesUi = useMemo(() => {
    const dateKey = (item: ExpenseListItem): string | null => {
      if (item.source_type === "session") return item.session?.clock_in ?? null;
      const expenseDate = item.expense?.expense_date;
      if (typeof expenseDate === "string" && expenseDate) return expenseDate;
      const createdAt = item.expense?.created_at;
      if (typeof createdAt === "string" && createdAt) return createdAt;
      return null;
    };
    return [...expensesUi].sort((a, b) => {
      const ad = dateKey(a);
      const bd = dateKey(b);
      const at = ad ? new Date(ad).getTime() : 0;
      const bt = bd ? new Date(bd).getTime() : 0;
      return bt - at;
    });
  }, [expensesUi]);

  useEffect(() => {
    setExpensesUi(expenses);
  }, [expenses]);

  useEffect(() => {
    setPaymentsUi(payments);
  }, [payments]);

  const projectMorningDocuments = useMemo(
    () => morningDocuments.filter((document) => !document.payment_id),
    [morningDocuments]
  );

  useEffect(() => {
    setProjectTasksUi(projectTasks);
  }, [projectTasks]);
  const [uploadDocsOpen, setUploadDocsOpen] = useState(false);
  const [uploadDocsCategory, setUploadDocsCategory] = useState<string>("");
  const [uploadDocsCategoryMode, setUploadDocsCategoryMode] = useState<
    "existing" | "new"
  >("existing");
  const [uploadDocsNewCategory, setUploadDocsNewCategory] = useState<string>("");
  const [uploadDocsFiles, setUploadDocsFiles] = useState<File[]>([]);
  const [pendingDocUploads, setPendingDocUploads] = useState<
    Array<{
      name: string;
      status: "uploading" | "done" | "error";
      documentId: string | null;
    }>
  >([]);
  const [pendingDocsRefresh, setPendingDocsRefresh] = useState(false);
  const [pendingDocsStuck, setPendingDocsStuck] = useState(false);
  const docsToastIdRef = useRef<string | number | null>(null);
  const docsRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docsStuckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editTagOpen, setEditTagOpen] = useState(false);
  const [editTagSaving, setEditTagSaving] = useState(false);
  const [editTagDocumentId, setEditTagDocumentId] = useState<string | null>(null);
  const [editTagValue, setEditTagValue] = useState("");
  const [deleteDocOpen, setDeleteDocOpen] = useState(false);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [deleteDocName, setDeleteDocName] = useState<string>("");
  const [deleteDocDeleting, setDeleteDocDeleting] = useState(false);

  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    for (const d of projectDocuments) {
      const value = typeof d.document_type === "string" ? d.document_type.trim() : "";
      if (value) set.add(value);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "he"));
  }, [projectDocuments]);

  const filteredProjectDocuments = useMemo(() => {
    if (!docsFilterCategory) return projectDocuments;
    return projectDocuments.filter((d) => d.document_type === docsFilterCategory);
  }, [projectDocuments, docsFilterCategory]);

  const allowedTabs = new Set(["overview", "tasks", "documents"]);
  const rawTabFromUrl = searchParams.get("tab");
  const tabFromUrl = rawTabFromUrl === "financial" ? "overview" : rawTabFromUrl;
  const [tabValue, setTabValue] = useState(
    tabFromUrl && allowedTabs.has(tabFromUrl) ? tabFromUrl : "overview"
  );

  useEffect(() => {
    // Sync state when the URL changes via navigation/back/forward.
    setTabValue(tabFromUrl && allowedTabs.has(tabFromUrl) ? tabFromUrl : "overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFromUrl]);

  useEffect(() => {
    if (!pendingDocsRefresh) return;
    if (pendingDocUploads.length === 0) return;

    const ids = pendingDocUploads
      .map((p) => p.documentId)
      .filter((v): v is string => typeof v === "string" && Boolean(v));

    if (ids.length === 0) return;

    const existingIds = new Set(projectDocuments.map((d) => d.document_id));
    const allVisible = ids.every((id) => existingIds.has(id));
    if (!allVisible) return;

    if (docsRefreshTimeoutRef.current) {
      clearTimeout(docsRefreshTimeoutRef.current);
      docsRefreshTimeoutRef.current = null;
    }

    if (docsStuckTimeoutRef.current) {
      clearTimeout(docsStuckTimeoutRef.current);
      docsStuckTimeoutRef.current = null;
    }

    const toastId = docsToastIdRef.current ?? undefined;
    toast.success("הקבצים נוספו לרשימה", { id: toastId });
    docsToastIdRef.current = null;
    setPendingDocsRefresh(false);
    setPendingDocsStuck(false);
    setPendingDocUploads([]);
  }, [projectDocuments, pendingDocsRefresh, pendingDocUploads]);

  useEffect(() => {
    if (!pendingDocsRefresh) return;
    if (pendingDocUploads.length === 0) return;

    if (docsRefreshTimeoutRef.current) {
      clearTimeout(docsRefreshTimeoutRef.current);
      docsRefreshTimeoutRef.current = null;
    }

    docsRefreshTimeoutRef.current = setTimeout(() => {
      const toastId = docsToastIdRef.current ?? undefined;
      toast(
        "העלאה הושלמה, אבל הרשימה לא התעדכנה עדיין. נסה לרענן את הדף/הלשונית.",
        { id: toastId }
      );
      docsToastIdRef.current = null;
      setPendingDocsRefresh(false);
      setPendingDocsStuck(false);
      setPendingDocUploads([]);
    }, 15000);

    return () => {
      if (docsRefreshTimeoutRef.current) {
        clearTimeout(docsRefreshTimeoutRef.current);
        docsRefreshTimeoutRef.current = null;
      }
    };
  }, [pendingDocsRefresh, pendingDocUploads.length]);

  useEffect(() => {
    if (!pendingDocsRefresh) return;
    if (pendingDocUploads.length === 0) return;

    const allDone = pendingDocUploads.every((p) => p.status === "done");
    if (!allDone) {
      setPendingDocsStuck(false);
      if (docsStuckTimeoutRef.current) {
        clearTimeout(docsStuckTimeoutRef.current);
        docsStuckTimeoutRef.current = null;
      }
      return;
    }

    setPendingDocsStuck(false);
    if (docsStuckTimeoutRef.current) {
      clearTimeout(docsStuckTimeoutRef.current);
      docsStuckTimeoutRef.current = null;
    }

    docsStuckTimeoutRef.current = setTimeout(() => {
      setPendingDocsStuck(true);
    }, 5000);

    return () => {
      if (docsStuckTimeoutRef.current) {
        clearTimeout(docsStuckTimeoutRef.current);
        docsStuckTimeoutRef.current = null;
      }
    };
  }, [pendingDocsRefresh, pendingDocUploads]);

  function setTab(next: string) {
    if (!allowedTabs.has(next)) return;
    emitNavigationStart();
    setTabValue(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  async function uploadProjectDocuments(files: File[], category: string) {
    if (!files || files.length === 0) return;
    setDocsUploading(true);
    const fileList = files;
    setPendingDocUploads(
      fileList.map((f) => ({ name: f.name, status: "uploading", documentId: null }))
    );
    setPendingDocsRefresh(false);
    setPendingDocsStuck(false);

    const toastId = toast.loading("מעלה קבצים...");
    docsToastIdRef.current = toastId;

    try {
      const total = fileList.length;
      for (let i = 0; i < total; i++) {
        const file = fileList[i]!;
        const form = new FormData();
        form.set("project_id", overview.id);
        form.set("file", file);
        if (category.trim()) form.set("category", category.trim());

        toast.loading(`מעלה קבצים... (${i + 1}/${total})`, { id: toastId });

        const res = await fetch("/api/projects/documents/upload", {
          method: "POST",
          body: form,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error("שגיאה בהעלאת קובץ", { id: toastId, description: json?.error ?? "" });
          setPendingDocsRefresh(false);
          setPendingDocsStuck(false);
          setPendingDocUploads((prev) =>
            prev.map((p) => (p.name === file.name ? { ...p, status: "error" } : p))
          );
          docsToastIdRef.current = null;
          return;
        }

        setPendingDocUploads((prev) =>
          prev.map((p) =>
            p.name === file.name
              ? {
                  ...p,
                  status: "done",
                  documentId:
                    typeof json?.document?.id === "string" ? (json.document.id as string) : null,
                }
              : p
          )
        );
      }

      toast.loading("העלאה הושלמה — מעדכן רשימה...", { id: toastId });
      setPendingDocsRefresh(true);
      router.refresh();
    } catch (e: unknown) {
      toast.error("שגיאה בהעלאת קובץ", { id: toastId, description: getErrorMessage(e) });
      setPendingDocsRefresh(false);
      setPendingDocsStuck(false);
      setPendingDocUploads((prev) => prev.map((p) => ({ ...p, status: "error" })));
      docsToastIdRef.current = null;
    } finally {
      setDocsUploading(false);
    }
  }

  async function startUploadDocs() {
    if (docsUploading) return;
    if (uploadDocsFiles.length === 0) return;

    const category =
      uploadDocsCategoryMode === "new"
        ? uploadDocsNewCategory.trim()
        : uploadDocsCategory.trim();

    const files = uploadDocsFiles;

    setUploadDocsOpen(false);
    setUploadDocsFiles([]);
    setUploadDocsCategory("");
    setUploadDocsNewCategory("");
    setUploadDocsCategoryMode("existing");

    await uploadProjectDocuments(files, category);
  }

  function openEditTag(documentId: string) {
    const current =
      projectDocuments.find((d) => d.document_id === documentId)?.document_type ?? "";
    setEditTagDocumentId(documentId);
    setEditTagValue(current ?? "");
    setEditTagOpen(true);
  }

  async function saveEditTag() {
    const documentId = editTagDocumentId;
    const value = editTagValue.trim();
    if (!documentId) return;
    if (!value) {
      toast.error("יש להזין תג");
      return;
    }

    setEditTagSaving(true);
    try {
      const res = await fetch("/api/documents/tag", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document_id: documentId, document_type: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה בעדכון תג", { description: json?.error ?? "" });
        return;
      }
      toast.success("התג עודכן");
      setEditTagOpen(false);
      setEditTagDocumentId(null);
      setEditTagValue("");
      router.refresh();
    } catch (e: unknown) {
      toast.error("שגיאה בעדכון תג", { description: getErrorMessage(e) });
    } finally {
      setEditTagSaving(false);
    }
  }

  function openDeleteDocument(documentId: string) {
    const row = projectDocuments.find((d) => d.document_id === documentId);
    const name = row?.title ?? row?.file_name ?? "מסמך";
    setDeleteDocId(documentId);
    setDeleteDocName(name);
    setDeleteDocOpen(true);
  }

  async function confirmDeleteDocument() {
    if (!deleteDocId) return;
    setDeleteDocDeleting(true);
    try {
      const res = await fetch("/api/documents/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document_id: deleteDocId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה במחיקה", { description: json?.error ?? "" });
        return;
      }
      toast.success("המסמך נמחק");
      setDeleteDocOpen(false);
      setDeleteDocId(null);
      setDeleteDocName("");
      router.refresh();
    } catch (e: unknown) {
      toast.error("שגיאה במחיקה", { description: getErrorMessage(e) });
    } finally {
      setDeleteDocDeleting(false);
    }
  }

  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [addIncomeOpen, setAddIncomeOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseListItem | null>(null);
  const [editingPayment, setEditingPayment] = useState<PaymentRow | null>(null);
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<PendingProjectDeletion | null>(null);
  const [updateBasePriceOpen, setUpdateBasePriceOpen] = useState(false);
  const [updateBasePriceSaving, setUpdateBasePriceSaving] = useState(false);
  const [updateBasePriceValue, setUpdateBasePriceValue] = useState<string>("");
  const completedFromList = projectTasksUi.filter(
    (t) => getFirstString(t, ["status"]) === "done"
  ).length;
  const openFromList = projectTasksUi.filter((t) => {
    const s = getFirstString(t, ["status"]);
    return s !== "done" && s !== "cancelled";
  }).length;
  const totalFromList = projectTasksUi.length;

  const totalTasks =
    totalFromList > 0 ? totalFromList : toNumber(tasks?.total_tasks) ?? 0;
  const completedTasks =
    totalFromList > 0 ? completedFromList : toNumber(tasks?.completed_tasks) ?? 0;
  const openTasks =
    totalFromList > 0 ? openFromList : toNumber(tasks?.open_tasks) ?? 0;
  const completion =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const agreedBasePrice =
    toNumber(financials?.agreed_base_price ?? overview.agreed_base_price) ?? null;
  const [agreedBasePriceUi, setAgreedBasePriceUi] = useState<number | null>(agreedBasePrice);

  useEffect(() => {
    setAgreedBasePriceUi(toNumber(financials?.agreed_base_price ?? overview.agreed_base_price) ?? null);
  }, [financials?.agreed_base_price, overview.agreed_base_price]);

  useEffect(() => {
    if (!updateBasePriceOpen) return;
    const v = agreedBasePriceUi;
    setUpdateBasePriceValue(v === null ? "" : String(v));
  }, [updateBasePriceOpen, agreedBasePriceUi]);

  const updateBasePriceNumber = Number(updateBasePriceValue);
  const updateBasePriceError =
    updateBasePriceValue.trim() === ""
      ? "שדה חובה"
      : !Number.isFinite(updateBasePriceNumber)
        ? "חייב להיות מספר"
        : updateBasePriceNumber < 0
          ? "חייב להיות 0 או יותר"
          : null;
  const canSaveBasePrice = !updateBasePriceError;
  const totalExpenses = toNumber(financials?.total_expenses) ?? null;
  const grossProfit = toNumber(financials?.gross_profit) ?? null;
  const totalWorkerPaid = toNumber(workerBalance?.paid_amount) ?? 0;
  const totalWorkerOwed = toNumber(workerBalance?.owed_amount) ?? 0;
  const billedExpensesFromDb = toNumber(financials?.expenses_billed) ?? null;
  const customerTotalPrice = toNumber(financials?.customer_total_price) ?? null;
  const billableCustomerItems = expensesUi.filter((item) =>
    item.source_type === "session"
      ? isSessionBillable(item.session)
      : Boolean(item.project_expense?.["billed_to_customer"])
  );
  const billedExpensesTotal = billedExpensesFromDb ?? 0;
  const displayedBasePrice = agreedBasePriceUi ?? agreedBasePrice;
  const displayedCustomerPrice =
    displayedBasePrice === null
      ? customerTotalPrice
      : displayedBasePrice + (billedExpensesTotal ?? 0);
  const paymentsTotal = paymentsUi.reduce(
    (sum, p) => sum + (toNumber(p.amount_total) ?? 0),
    0
  );
  const customerPaymentStatus = deriveCustomerPaymentStatus(displayedCustomerPrice, paymentsTotal);
  const remainingCustomerBalance =
    displayedCustomerPrice !== null ? Math.max(displayedCustomerPrice - paymentsTotal, 0) : null;
  const tasksSorted = useMemo(() => {
    const copy = [...projectTasksUi];
    copy.sort((a, b) => {
      const ad =
        getFirstDate(a, ["due_date", "deadline", "task_date", "created_at", "updated_at"]) ??
        "";
      const bd =
        getFirstDate(b, ["due_date", "deadline", "task_date", "created_at", "updated_at"]) ??
        "";
      const at = ad ? new Date(ad).getTime() : 0;
      const bt = bd ? new Date(bd).getTime() : 0;
      return bt - at;
    });
    return copy;
  }, [projectTasksUi]);

  const usersById = useMemo(() => {
    const map = new Map<string, AssignableUser>();
    for (const u of assignableUsers) map.set(u.id, u);
    return map;
  }, [assignableUsers]);

  const cashFlow = (() => {
    const incomeEvents: CashFlowEvent[] = paymentsUi.map((p) => {
      const date = p.payment_date ?? p.created_at ?? null;
      const amount = toNumber(p.amount_total);
      const reference = p.reference_number ?? "";
      const method = paymentMethodLabel(p.payment_method);

      const meta: string[] = [];
      if (method && method !== "-") meta.push(method);
      if (reference) meta.push(`אסמכתא: ${reference}`);

      return {
        type: "income",
        id: p.id,
        date,
        amount,
        title: "הכנסה",
        meta,
      };
    });

    const expenseEvents: CashFlowEvent[] = expensesUi.flatMap((item, idx) => {
      if (item.source_type === "session" && item.session) {
        if (isSessionBillable(item.session)) return [];
        const user = usersById.get(item.session.user_id);
        const workerName = user?.full_name?.trim() || user?.email || "עובד";
        const sessionNotes = item.session.notes?.trim() || "";
        return [
          {
            type: "expense" as const,
            id: item.session.id,
            date: item.session.clock_in ?? null,
            amount: sessionLaborCost(item.session),
            title: `שכר עובד — ${workerName}`,
            meta: sessionNotes ? [sessionNotes] : [],
            includedInBase: true,
            billedToCustomer: false,
          },
        ];
      }

      const expenseId = getString(item.project_expense, "expense_id") ?? String(idx);
      const date =
        getString(item.expense, "expense_date") ??
        getString(item.expense, "created_at") ??
        null;
      const amount = toNumber(item.expense?.amount);

      const category = getString(item.expense, "category");
      const description = getString(item.expense, "description");
      const title =
        (category && description && `${category} — ${description}`) ||
        category ||
        description ||
        "הוצאה";

      const includedInBase = Boolean(item.project_expense?.["included_in_base_price"]);
      const billedToCustomer = Boolean(item.project_expense?.["billed_to_customer"]);
      if (billedToCustomer) return [];

      const expenseNotes = getString(item.expense, "notes")?.trim() || "";
      return [
        {
          type: "expense" as const,
          id: expenseId,
          date,
          amount,
          title,
          meta: expenseNotes ? [expenseNotes] : [],
          includedInBase,
          billedToCustomer,
        },
      ];
    });

    const all = [...incomeEvents, ...expenseEvents];

    all.sort((a, b) => {
      const at = a.date ? new Date(a.date).getTime() : 0;
      const bt = b.date ? new Date(b.date).getTime() : 0;
      return bt - at;
    });

    return all;
  })();

  async function deleteExpense(item: ExpenseListItem) {
    const expenseId = getString(item.project_expense, "expense_id") ?? getString(item.expense, "id");
    if (!expenseId || deletingExpenseId) return;

    setDeletingExpenseId(expenseId);
    try {
      const res = await fetch("/api/expenses/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: expenseId,
          project_id: overview.id,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה במחיקת ההוצאה", {
          description: typeof json?.error === "string" ? json.error : "",
        });
        return;
      }
      setExpensesUi((prev) =>
        prev.filter((row) => {
          const rowId = getString(row.project_expense, "expense_id") ?? getString(row.expense, "id");
          return rowId !== expenseId;
        })
      );
      toast.success("ההוצאה נמחקה");
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      toast.error("שגיאה במחיקת ההוצאה", {
        description: getErrorMessage(e),
      });
    } finally {
      setDeletingExpenseId(null);
    }
  }

  async function deleteSession(item: ExpenseListItem) {
    const sessionId = item.session?.id ?? "";
    if (!sessionId || deletingSessionId) return;

    setDeletingSessionId(sessionId);
    try {
      const isAdminViewer = viewerRole === "admin";
      const res = await fetch(isAdminViewer ? "/api/payroll/sessions/delete" : "/api/profile/session/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isAdminViewer
            ? { session_id: sessionId }
            : {
                session_id: sessionId,
                project_id: overview.id,
              }
        ),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה במחיקת המשמרת", {
          description: typeof json?.error === "string" ? json.error : "",
        });
        return;
      }

      setExpensesUi((prev) =>
        prev.filter((row) => !(row.source_type === "session" && row.session?.id === sessionId))
      );
      toast.success("המשמרת נמחקה");
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      toast.error("שגיאה במחיקת המשמרת", {
        description: getErrorMessage(e),
      });
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function deletePayment(payment: PaymentRow) {
    if (!payment.id || deletingPaymentId) return;

    setDeletingPaymentId(payment.id);
    try {
      const res = await fetch("/api/payments/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: payment.id,
          project_id: overview.id,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה במחיקת ההכנסה", {
          description: typeof json?.error === "string" ? json.error : "",
        });
        return;
      }
      setPaymentsUi((prev) => prev.filter((row) => row.id !== payment.id));
      toast.success("ההכנסה נמחקה");
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      toast.error("שגיאה במחיקת ההכנסה", {
        description: getErrorMessage(e),
      });
    } finally {
      setDeletingPaymentId(null);
    }
  }

  function requestDeleteExpense(item: ExpenseListItem) {
    setPendingDeletion({ kind: "expense", item });
  }

  function requestDeleteSession(item: ExpenseListItem) {
    setPendingDeletion({ kind: "session", item });
  }

  function requestDeletePayment(payment: PaymentRow) {
    setPendingDeletion({ kind: "payment", payment });
  }

  async function confirmPendingDeletion() {
    const pending = pendingDeletion;
    if (!pending) return;

    if (pending.kind === "expense") {
      await deleteExpense(pending.item);
      return;
    }
    if (pending.kind === "session") {
      await deleteSession(pending.item);
      return;
    }
    await deletePayment(pending.payment);
  }

  useEffect(() => {
    if (!deletingExpenseId && !deletingSessionId && !deletingPaymentId) {
      setPendingDeletion((current) => {
        if (!current) return null;
        if (current.kind === "expense") {
          const expenseId =
            getString(current.item.project_expense, "expense_id") ?? getString(current.item.expense, "id");
          return expenseId && expensesUi.some((row) => {
            const rowId = getString(row.project_expense, "expense_id") ?? getString(row.expense, "id");
            return rowId === expenseId;
          })
            ? current
            : null;
        }
        if (current.kind === "session") {
          const sessionId = current.item.session?.id ?? "";
          return sessionId && expensesUi.some((row) => row.source_type === "session" && row.session?.id === sessionId)
            ? current
            : null;
        }
        return paymentsUi.some((row) => row.id === current.payment.id) ? current : null;
      });
    }
  }, [deletingExpenseId, deletingPaymentId, deletingSessionId, expensesUi, paymentsUi]);

  const pendingDeletionDetails = useMemo(() => {
    if (!pendingDeletion) return null;
    if (pendingDeletion.kind === "expense") {
      const expenseName =
        getFirstString(pendingDeletion.item.expense, ["name", "description"]) ??
        getFirstString(pendingDeletion.item.project_expense, ["name", "expense_name"]) ??
        "הוצאה";
      return {
        title: "מחיקת הוצאה",
        description: "הפעולה תמחק את ההוצאה מהפרויקט ומהפיננסי.",
        label: expenseName,
        busy: Boolean(deletingExpenseId),
      };
    }
    if (pendingDeletion.kind === "session") {
      const workerName = pendingDeletion.item.session?.clock_in
        ? `משמרת מ־${formatDateTime(pendingDeletion.item.session.clock_in)}`
        : "משמרת עובד";
      return {
        title: "מחיקת משמרת",
        description: "הפעולה תמחק את המשמרת מהפרויקט ומרישומי השכר.",
        label: workerName,
        busy: Boolean(deletingSessionId),
      };
    }
    return {
      title: "מחיקת הכנסה",
      description: "הפעולה תמחק את ההכנסה מרשימת התשלומים של הפרויקט.",
      label:
        `${formatIls(toNumber(pendingDeletion.payment.amount_total) ?? null)} • ${formatDate(pendingDeletion.payment.payment_date ?? null)}`,
      busy: Boolean(deletingPaymentId),
    };
  }, [deletingExpenseId, deletingPaymentId, deletingSessionId, pendingDeletion]);

  async function updateBasePrice(next: number) {
    setUpdateBasePriceSaving(true);
    const toastId = "update-base-price";
    toast.loading("מעדכן מחיר בסיס...", { id: toastId });
    try {
      const res = await fetch("/api/projects/update-agreed-base-price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: overview.id,
          agreed_base_price: next,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה בעדכון מחיר בסיס", { id: toastId, description: json?.error ?? "" });
        return;
      }

      const updatedBasePrice =
        json?.project && typeof json.project.agreed_base_price !== "undefined"
          ? toNumber(json.project.agreed_base_price)
          : null;

      setAgreedBasePriceUi(updatedBasePrice);
      toast.success("מחיר בסיס עודכן", { id: toastId });
      setUpdateBasePriceOpen(false);
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      toast.error("שגיאה בעדכון מחיר בסיס", { id: toastId, description: getErrorMessage(e) });
    } finally {
      setUpdateBasePriceSaving(false);
    }
  }

  function renderExpenseRow(item: ExpenseListItem, idx: number, options?: { showBillableBadge?: boolean; billedList?: boolean }) {
    const expenseId = getString(item.project_expense, "expense_id");
    const session = item.source_type === "session" ? item.session : null;
    const amount = session ? sessionLaborCost(session) : toNumber(item.expense?.amount);
    const billedAmount = session
      ? sessionBillToCustomerAmount(session)
      : toNumber(item.expense?.amount);
    const createdAt = session
      ? session.clock_in
      : getString(item.expense, "expense_date") ??
        getString(item.expense, "created_at") ??
        null;

    const title = session
      ? `שכר עובד${(() => {
          const user = usersById.get(session.user_id);
          const name = user?.full_name?.trim() || user?.email || "";
          return name ? ` — ${name}` : "";
        })()}`
      : getString(item.expense, "description") ??
        getString(item.expense, "vendor_name") ??
        getString(item.expense, "vendor") ??
        getString(item.expense, "category") ??
        (expenseId ? `הוצאה ${expenseId.slice(0, 8)}` : "הוצאה");
    const attachments = session
      ? Array.isArray(session.attachments)
        ? session.attachments
        : []
      : Array.isArray(item.expense?.attachments)
        ? (item.expense.attachments as FinancialAttachment[])
        : [];
    const insertedByLabel = expenseRecordedByLabel(item, {
      expenseRecordedByNameByValue,
      expenseAuditById,
    });

    const billed = session
      ? isSessionBillable(session)
      : Boolean(item.project_expense?.["billed_to_customer"]);
    const currentSessionPaymentStatus = session ? sessionPaymentStatus(session) : "";

    return (
      <div
        key={session ? session.id : expenseId ?? String(idx)}
        className="flex flex-col gap-2 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium truncate">{title}</span>
            <StatusBadge
              value={session ? currentSessionPaymentStatus : String(item.expense?.payment_status ?? "not_paid")}
              type="payment"
            />
            {billed && options?.showBillableBadge !== false ? (
              <span className="inline-flex items-center rounded-full border border-warning/50 bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-soft-foreground">
                חויב ללקוח
              </span>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <LtrInline>{formatDate(createdAt)}</LtrInline>
            {session ? (
              <>
                {shouldShowSessionHours(
                  normalizePayrollWorkerType(
                    usersById.get(session.user_id)?.payroll_worker_type,
                    usersById.get(session.user_id)?.pay_tracking_mode
                  )
                ) ? (
                  <>
                    <span>
                      כניסה:{" "}
                      <LtrInline>
                        {isSameDay(createdAt, session.clock_in)
                          ? formatTimeOnly(session.clock_in)
                          : formatDateTime(session.clock_in)}
                      </LtrInline>
                    </span>
                    <span>
                      יציאה:{" "}
                      <LtrInline>
                        {isSameDay(createdAt, session.clock_out)
                          ? formatTimeOnly(session.clock_out)
                          : formatDateTime(session.clock_out)}
                      </LtrInline>
                    </span>
                    <span>
                      משך: <LtrInline>{formatMinutes(sessionWorkedMinutes(session))}</LtrInline>
                    </span>
                  </>
                ) : null}
                {options?.billedList ? (
                  <span>
                    עלות עבודה: <LtrInline>{formatIls(amount)}</LtrInline>
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
          {!session && (() => {
            const expStatus = item.expense?.payment_status;
            const expPaid = toNumber(item.expense?.paid_amount as string | number | null);
            const expMethod = getString(item.expense, "payment_method");
            if (expStatus !== "paid" && expStatus !== "partial") return null;
            const methodLabel = expMethod === "bank_transfer" ? "העברה בנקאית"
              : expMethod === "cash" ? "מזומן"
              : expMethod === "check" ? "צ'ק"
              : expMethod === "credit_card" ? "כרטיס אשראי"
              : expMethod === "other" ? "אחר"
              : null;
            const parts: string[] = [];
            if (expStatus === "partial" && expPaid != null && expPaid > 0) parts.push(`שולם ${formatIls(expPaid)}`);
            if (methodLabel) parts.push(methodLabel);
            if (!parts.length) return null;
            return <div className="mt-1 text-xs text-muted-foreground">{parts.join(" • ")}</div>;
          })()}
          {session?.notes ? (
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {session.notes}
            </div>
          ) : null}
          {!session && insertedByLabel ? (
            <div className="text-xs text-muted-foreground mt-1">{insertedByLabel}</div>
          ) : null}
          {attachments.length > 0 ? (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment) => (
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
                {attachments
                  .filter((attachment) => attachment.url && isImageAttachment(attachment))
                  .map((attachment) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${attachment.document_id}-preview`}
                      src={attachment.url ?? ""}
                      alt={attachment.file_name ?? title}
                      className="h-16 w-16 rounded-lg border object-cover"
                    />
                  ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:shrink-0 sm:items-end sm:text-left">
          <div className="font-medium sm:text-left">
            {options?.billedList
              ? billedAmount === null
                ? "—"
                : <LtrInline>{formatIls(billedAmount)}</LtrInline>
              : amount === null
                ? "—"
                : <LtrInline>{formatIls(amount)}</LtrInline>}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingExpense(item);
                setAddExpenseOpen(true);
              }}
              disabled={
                session
                  ? deletingSessionId === session.id
                  : deletingExpenseId === expenseId
              }
            >
              ערוך
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => (session ? requestDeleteSession(item) : requestDeleteExpense(item))}
              disabled={
                session
                  ? deletingSessionId === session.id
                  : deletingExpenseId === expenseId
              }
            >
              {session
                ? deletingSessionId === session.id
                  ? "מוחק..."
                  : "מחק"
                : deletingExpenseId === expenseId
                  ? "מוחק..."
                  : "מחק"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ClientOnly
      fallback={<div className="text-muted-foreground text-base">טוען…</div>}
    >
      <Tabs value={tabValue} onValueChange={setTab} dir="rtl">
        <TabsList className="sticky top-2 z-10 grid h-auto w-full grid-cols-3 gap-2 overflow-visible border-b-0 bg-transparent p-0 shadow-none sm:top-4 sm:mx-auto sm:max-w-3xl [&>*]:min-w-0 [&>*]:rounded-2xl [&>*]:border [&>*]:border-foreground/20 [&>*]:bg-card/95 [&>*]:px-3 [&>*]:py-3 [&>*]:text-sm [&>*]:font-semibold [&>*]:text-foreground [&>*]:shadow-sm [&>*]:backdrop-blur [&>*]:transition-colors [&>*]:hover:border-foreground/35 [&>*]:hover:bg-card [&>*]:data-[state=active]:border-foreground [&>*]:data-[state=active]:bg-foreground [&>*]:data-[state=active]:text-background sm:[&>*]:text-base">
          <TabsTrigger value="overview" className="flex-col gap-1">
            <span>כספים</span>
            <span className="text-[11px] opacity-80">מצב כספי</span>
          </TabsTrigger>
          <TabsTrigger value="tasks" className="flex-col gap-1">
            <span>משימות</span>
            <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px]">
              {completion}%
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex-col gap-1">
            <span>מסמכים</span>
            <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px]">
              {projectDocuments.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mx-auto mt-4 w-full max-w-6xl space-y-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">סיכום כספי</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-3 xl:grid-cols-6">
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">מחיר בסיס שסוכם</div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-lg font-semibold">
                    <LtrInline>{formatIls(displayedBasePrice)}</LtrInline>
                  </div>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => setUpdateBasePriceOpen(true)}
                  >
                    עדכון
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">מחיר בפועל</div>
                <div className="mt-2 text-lg font-semibold">
                  <LtrInline>{formatIls(displayedCustomerPrice)}</LtrInline>
                </div>
              </div>
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">הוצאות</div>
                <div className="mt-2 text-lg font-semibold">
                  <LtrInline>{formatIls(totalExpenses)}</LtrInline>
                </div>
              </div>
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">רווח גולמי</div>
                <div className={("mt-2 text-lg font-semibold " + (grossProfit !== null && grossProfit < 0 ? "text-destructive" : "")).trim()}>
                  <LtrInline>{formatIls(grossProfit)}</LtrInline>
                </div>
              </div>
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">יתרה לעובדי משמרות</div>
                <div className="mt-2 text-lg font-semibold">
                  <LtrInline>{formatIls(totalWorkerOwed)}</LtrInline>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  <span>שולם לעובדי משמרות </span>
                  <LtrInline>{formatIls(totalWorkerPaid)}</LtrInline>
                </div>
              </div>
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">סטטוס תשלום לקוח</div>
                <div className="mt-2">
                  <Badge className={customerPaymentStatusBadgeClasses(customerPaymentStatus)}>
                    {customerPaymentStatusLabel(customerPaymentStatus)}
                  </Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  <span>שולם </span>
                  <LtrInline>{formatIls(paymentsTotal)}</LtrInline>
                  {remainingCustomerBalance !== null ? (
                    <>
                      <span> • נותר </span>
                      <LtrInline>{formatIls(remainingCustomerBalance)}</LtrInline>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            {billedExpensesTotal > 0 ? (
              <div className="text-xs text-muted-foreground">
                <span>מחיר בפועל מחושב כמחיר הבסיס ועוד </span>
                <LtrInline>{formatIls(billedExpensesTotal)}</LtrInline>
                <span> עבור חיובים ללקוח.</span>
              </div>
            ) : displayedBasePrice !== null ? (
              <div className="text-xs text-muted-foreground">מחיר בפועל זהה למחיר הבסיס כרגע.</div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader className="flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">הכנסות</CardTitle>
              <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
                <Button type="button" variant="outline" size="sm" onClick={() => setMorningBillingOpen(true)}>
                  שליחת קבלה / חשבונית
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => {
                    setEditingPayment(null);
                    setAddIncomeOpen(true);
                  }}
                >
                  הוספת הכנסה
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-[28rem] flex-col text-sm">
              {paymentsError ? (
                <div className="flex-1 text-destructive text-sm">
                  שגיאה בטעינת הכנסות: {paymentsError}
                </div>
              ) : paymentsUi.length === 0 ? (
                <div className="flex-1 text-muted-foreground">אין הכנסות להצגה.</div>
              ) : (
                <div className="flex-1 divide-y overflow-y-auto pl-1">
                  {paymentsUi.map((p) => {
                    const amount = toNumber(p.amount_total);
                    const date = p.payment_date ?? p.created_at ?? null;
                    const method = paymentMethodLabel(p.payment_method);
                    const reference = p.reference_number ?? "";
                    const paymentStatus = typeof p.payment_status === "string" ? p.payment_status : "";
                    const dueDate = typeof p.due_date === "string" ? p.due_date : null;
                    const paymentMorningDocuments = morningDocuments.filter(
                      (document) => document.payment_id === p.id
                    );
                    const insertedByLabel = paymentRecordedByLabel(p, {
                      paymentRecordedByNameByValue,
                      paymentAuditById,
                    });
                    const paymentAudit = paymentAuditById[p.id] ?? null;

                    return (
                      <div key={p.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-medium truncate">
                              {reference ? <>אסמכתא: <LtrInline>{reference}</LtrInline></> : "הכנסה"}
                            </span>
                            {paymentStatus ? (
                              <StatusBadge value={paymentStatus} type="payment" />
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            <LtrInline>{formatDate(date)}</LtrInline>
                            <span>{method}</span>
                            {dueDate ? <span>פירעון: <LtrInline>{formatDate(dueDate)}</LtrInline></span> : null}
                          </div>
                          {p.notes ? (
                            <div className="text-xs text-muted-foreground mt-1 truncate">
                              {p.notes}
                            </div>
                          ) : null}
                          {insertedByLabel ? (
                            <div className="text-xs text-muted-foreground mt-1">
                              {insertedByLabel}
                            </div>
                          ) : null}
                          {!insertedByLabel && paymentAudit ? (
                            <div className="text-xs text-muted-foreground mt-1">
                              <span>{paymentAudit.actionLabel} ע״י {paymentAudit.actorName}</span>
                              {paymentAudit.createdAt ? (
                                <>
                                  <span> · </span>
                                  <LtrInline>{formatDateTime(paymentAudit.createdAt)}</LtrInline>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                          {amount !== null && amount > 0 && overview.customer_id ? (
                            <div className="mt-2">
                              <MorningDocumentsPanel
                                customerId={overview.customer_id}
                                projectId={overview.id}
                                paymentId={p.id}
                                documents={paymentMorningDocuments}
                                allowReceipt
                                allowInvoiceReceipt
                                compact
                                onChanged={() => router.refresh()}
                              />
                            </div>
                          ) : null}
                          {Array.isArray(p.attachments) && p.attachments.length > 0 ? (
                            <div className="mt-2 space-y-2">
                              <div className="flex flex-wrap gap-2">
                                {p.attachments.map((attachment) => (
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
                                {p.attachments
                                  .filter((attachment) => attachment.url && isImageAttachment(attachment))
                                  .map((attachment) => (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      key={`${attachment.document_id}-preview`}
                                      src={attachment.url ?? ""}
                                      alt={attachment.file_name ?? "קובץ"}
                                      className="h-16 w-16 rounded-lg border object-cover"
                                    />
                                  ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-col gap-2 sm:shrink-0 sm:items-end sm:text-left">
                          <div className="font-medium sm:text-left">
                            {amount === null ? "—" : <LtrInline>{formatIls(amount)}</LtrInline>}
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:flex">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingPayment(p);
                                setAddIncomeOpen(true);
                              }}
                              disabled={deletingPaymentId === p.id}
                            >
                              ערוך
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => requestDeletePayment(p)}
                              disabled={deletingPaymentId === p.id}
                            >
                              {deletingPaymentId === p.id ? "מוחק..." : "מחק"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 mt-auto flex items-center justify-between gap-3 border-t pt-3">
                <div className="space-y-1">
                  <span className="block text-muted-foreground">סה״כ הכנסות</span>
                  {paymentAuditError ? (
                    <span className="block text-xs text-muted-foreground">
                      לא ניתן לטעון כרגע מי רשם את כל התשלומים.
                    </span>
                  ) : null}
                </div>
                <span className="font-medium">
                  <LtrInline>{formatIls(paymentsTotal)}</LtrInline>
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">הוצאות</CardTitle>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => {
                  setEditingExpense(null);
                  setAddExpenseOpen(true);
                }}
              >
                הוספת הוצאה
              </Button>
            </CardHeader>
            <CardContent className="flex min-h-[28rem] flex-col text-sm">
              {expensesError ? (
                <div className="flex-1 text-destructive text-sm">
                  שגיאה בטעינת הוצאות: {expensesError}
                </div>
              ) : expensesUi.length === 0 ? (
                <div className="flex-1 text-muted-foreground">אין הוצאות להצגה.</div>
              ) : (
                <div className="flex-1 divide-y overflow-y-auto pl-1">
                  {sortedExpensesUi.map((item, idx) => renderExpenseRow(item, idx))}
                </div>
              )}

              {billedExpensesTotal > 0 ? (
                <div className="pt-2 text-xs text-muted-foreground">
                  <span>מתוכן </span>
                  <LtrInline>{formatIls(billedExpensesTotal)}</LtrInline>
                  <span> יתווספו לחיוב הלקוח.</span>
                </div>
              ) : null}
              <div className="mt-3 mt-auto flex items-center justify-between border-t pt-3">
                <span className="text-muted-foreground">סה״כ הוצאות</span>
                <span className="font-medium">
                  <LtrInline>{formatIls(totalExpenses)}</LtrInline>
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">תזרים</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm xl:flex xl:min-h-[24rem] xl:flex-col">
              {cashFlow.length === 0 ? (
                <div className="text-muted-foreground">אין תנועות להצגה.</div>
              ) : (
                <div className="divide-y xl:max-h-[20rem] xl:overflow-y-auto xl:pl-1">
                  {cashFlow.map((ev) => {
                    const isIncome = ev.type === "income";
                    const signedAmount =
                      ev.amount === null ? null : isIncome ? ev.amount : -ev.amount;
                    const amountText =
                      signedAmount === null
                        ? "—"
                        : formatIls(Math.abs(signedAmount));
                    const notesText = ev.meta.filter((m) => m !== "חויב ללקוח").join(" · ");

                    return (
                      <div
                        key={`${ev.type}:${ev.id}`}
                        className="flex items-center gap-3 py-1.5 text-sm"
                      >
                        <span className="w-20 shrink-0 text-xs text-muted-foreground">
                          <LtrInline>{formatDate(ev.date)}</LtrInline>
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{ev.title}</span>
                        {notesText ? (
                          <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:inline">
                            {notesText}
                          </span>
                        ) : null}
                        <span
                          className={
                            "shrink-0 whitespace-nowrap font-medium tabular-nums " +
                            (signedAmount === null
                              ? ""
                              : isIncome
                              ? "text-success"
                              : "text-destructive")
                          }
                        >
                          {signedAmount === null ? "" : (
                            <LtrInline>
                              {isIncome ? "+" : "-"} {amountText}
                            </LtrInline>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">לחיוב לקוח</CardTitle>
            </CardHeader>
            <CardContent className="text-sm xl:flex xl:min-h-[24rem] xl:flex-col">
              {expensesError ? (
                <div className="text-destructive text-sm">
                  שגיאה בטעינת חיובים ללקוח: {expensesError}
                </div>
              ) : billableCustomerItems.length === 0 ? (
                <div className="text-muted-foreground">אין פריטים לחיוב לקוח.</div>
              ) : (
                <div className="divide-y xl:max-h-[20rem] xl:overflow-y-auto xl:pl-1">
                  {billableCustomerItems.map((item, idx) =>
                    renderExpenseRow(item, idx, { billedList: true })
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between border-t pt-3 xl:mt-auto">
                <span className="text-muted-foreground">סה״כ לחיוב לקוח</span>
                <span className="font-medium">
                  <LtrInline>{formatIls(billedExpensesTotal)}</LtrInline>
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="tasks" className="mx-auto mt-4 w-full max-w-6xl">
        <ProjectTasksTab
          projectId={overview.id}
          projectType={overview.project_type}
          totalTasks={totalTasks}
          completedTasks={completedTasks}
          openTasks={openTasks}
          tasks={tasksSorted}
          error={projectTasksError}
          usersById={usersById}
          assignableUsers={assignableUsers}
          assignableUsersError={assignableUsersError}
          onChange={() => startTransition(() => router.refresh())}
          onTaskUpdated={(id, patch) => {
            setProjectTasksUi((prev) =>
              prev.map((row) => {
                const rowId = getFirstString(row, ["task_id", "id"]);
                if (rowId !== id) return row;
                return { ...row, ...patch };
              })
            );
          }}
        />
      </TabsContent>

        <TabsContent value="documents" className="mx-auto mt-4 w-full max-w-6xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">מסמכים</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1 space-y-1 sm:min-w-[240px]">
                <div className="text-xs text-muted-foreground">קטגוריה</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={docsFilterCategory}
                  onChange={(e) => setDocsFilterCategory(e.target.value)}
                >
                  <option value="">כל הקטגוריות</option>
                  {existingCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center">
                <Button
                  variant="secondary"
                  disabled={docsUploading}
                  onClick={() => setUploadDocsOpen(true)}
                >
                  {docsUploading ? "מעלה..." : "העלאת קבצים/תמונות"}
                </Button>
                <div className="text-xs text-muted-foreground">
                  {filteredProjectDocuments.length} קבצים
                </div>
              </div>
            </div>

            {projectDocumentsError ? (
              <div className="text-destructive text-sm">
                שגיאה בטעינת מסמכים: {projectDocumentsError}
              </div>
            ) : pendingDocUploads.length > 0 ? (
              <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">
                  {pendingDocUploads.every((p) => p.status === "done") && pendingDocsRefresh
                    ? "מעדכן רשימה..."
                    : "מעלה קבצים"}
                </div>
                <div className="mt-2 space-y-1">
                  {pendingDocUploads.map((p) => (
                    <div key={p.name} className="flex items-center justify-between gap-2">
                      <div className="truncate">{p.name}</div>
                      <div className="shrink-0">
                        {p.status === "done"
                          ? "הועלה"
                          : p.status === "error"
                            ? "שגיאה"
                            : "מעלה..."}
                      </div>
                    </div>
                  ))}
                </div>
                {pendingDocUploads.some((p) => p.status === "error") ? (
                  <div className="mt-2 flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setPendingDocsRefresh(false);
                        setPendingDocsStuck(false);
                        setPendingDocUploads([]);
                      }}
                    >
                      סגירה
                    </Button>
                  </div>
                ) : pendingDocUploads.every((p) => p.status === "done") &&
                  pendingDocsRefresh &&
                  pendingDocsStuck ? (
                  <div className="mt-2 flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => router.refresh()}
                    >
                      רענון רשימה
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : filteredProjectDocuments.length === 0 ? (
              <div className="text-muted-foreground">
                {docsFilterCategory ? "אין מסמכים בקטגוריה זו." : "אין מסמכים להצגה."}
              </div>
            ) : (
              <div className="divide-y rounded-md border">
                {filteredProjectDocuments.map((d) => {
                  const name = d.title ?? d.file_name ?? "document";
                  const when = d.uploaded_at ? formatDate(d.uploaded_at) : "—";

                  const sourceType =
                    d.entity_type ??
                    (typeof d.storage_key === "string" && d.storage_key.startsWith("tasks/")
                      ? "task"
                      : typeof d.storage_key === "string" &&
                          d.storage_key.startsWith("projects/")
                        ? "project"
                        : null);

                  const where =
                    sourceType === "task"
                      ? "משימה"
                      : sourceType === "project"
                        ? "פרויקט"
                        : "—";

                  // kindLabel intentionally omitted from UI (not very useful vs. filename/preview).

                  return (
                    <div
                      key={d.document_id}
                      className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {d.url ? (
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              {name}
                            </a>
                          ) : (
                            name
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                          <span>{when}</span>
                          <span>מקושר ל: {where}</span>
                          {d.document_type ? <span>קטגוריה: {d.document_type}</span> : null}
                          {d.uploaded_by_name ? <span>הוזן ע״י: {d.uploaded_by_name}</span> : null}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => openEditTag(d.document_id)}
                        >
                          ערוך קטגוריה
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => openDeleteDocument(d.document_id)}
                        >
                          מחיקה
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        </TabsContent>

      <Dialog open={morningBillingOpen} onOpenChange={setMorningBillingOpen}>
        <AdaptiveDialog size="details4xl">
          <DialogHeader>
            <DialogTitle>מסמכי Morning</DialogTitle>
            <DialogDescription>
              הנפקת חשבונית לפרויקט, קבלות לתשלומים, ומעקב אחרי המסמכים שהופקו.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {morningDocumentsError ? (
              <div className="text-sm text-destructive">שגיאה בטעינת מסמכי Morning: {morningDocumentsError}</div>
            ) : null}

            {overview.customer_id ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">חשבונית לפרויקט</CardTitle>
                </CardHeader>
                <CardContent>
                  <MorningDocumentsPanel
                    customerId={overview.customer_id}
                    projectId={overview.id}
                    documents={projectMorningDocuments}
                    allowInvoice
                    onChanged={() => router.refresh()}
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="text-sm text-muted-foreground">לא נמצא לקוח משויך לפרויקט, ולכן אי אפשר להפיק מסמך Morning.</div>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">קבלות לפי תשלום</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {paymentsUi.length === 0 ? (
                  <div className="text-sm text-muted-foreground">אין תשלומים להצגה.</div>
                ) : (
                  paymentsUi.map((payment) => {
                    const amount = toNumber(payment.amount_total);
                    const paymentMorningDocuments = morningDocuments.filter(
                      (document) => document.payment_id === payment.id
                    );

                    return (
                      <div key={`morning-payment-${payment.id}`} className="rounded-xl border p-3">
                        <div className="mb-2 text-sm font-medium">
                          {amount !== null ? formatIls(amount) : "תשלום"} · {formatDate(payment.payment_date ?? payment.created_at ?? null)}
                        </div>
                        {amount !== null && amount > 0 && overview.customer_id ? (
                          <MorningDocumentsPanel
                            customerId={overview.customer_id}
                            projectId={overview.id}
                            paymentId={payment.id}
                            documents={paymentMorningDocuments}
                            allowReceipt
                            allowInvoiceReceipt
                            compact
                            onChanged={() => router.refresh()}
                          />
                        ) : (
                          <div className="text-xs text-muted-foreground">אי אפשר להפיק קבלה עבור החזר או תשלום לא תקין.</div>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          <DialogFooter className="mt-4">
            <Button type="button" variant="secondary" onClick={() => setMorningBillingOpen(false)}>
              סגירה
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={uploadDocsOpen}
        onOpenChange={(open) => {
          setUploadDocsOpen(open);
          if (!open) {
            setUploadDocsFiles([]);
            setUploadDocsCategory("");
            setUploadDocsNewCategory("");
            setUploadDocsCategoryMode("existing");
          }
        }}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>העלאת מסמכים</DialogTitle>
            <DialogDescription>בחר קטגוריה (אופציונלי) וקבצים להעלאה.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">קטגוריה (אופציונלי)</div>
              <AdaptiveGrid variant="formTwo" className="gap-2">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={uploadDocsCategoryMode === "new" ? "__new__" : uploadDocsCategory}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__new__") {
                      setUploadDocsCategoryMode("new");
                      setUploadDocsCategory("");
                    } else {
                      setUploadDocsCategoryMode("existing");
                      setUploadDocsCategory(v);
                      setUploadDocsNewCategory("");
                    }
                  }}
                >
                  <option value="">ללא קטגוריה</option>
                  {existingCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value="__new__">קטגוריה חדשה...</option>
                </select>

                {uploadDocsCategoryMode === "new" ? (
                  <Input
                    value={uploadDocsNewCategory}
                    onChange={(e) => setUploadDocsNewCategory(e.target.value)}
                    placeholder="שם קטגוריה חדשה"
                    aria-invalid={!uploadDocsNewCategory.trim()}
                    className={
                      !uploadDocsNewCategory.trim()
                        ? "border-destructive focus-visible:ring-destructive"
                        : ""
                    }
                  />
                ) : null}
                {uploadDocsCategoryMode === "new" && !uploadDocsNewCategory.trim() ? (
                  <div className="text-xs text-destructive">
                    שדה חובה
                  </div>
                ) : null}
            </AdaptiveGrid>
          </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">קבצים</div>
              <div className="flex items-center justify-between gap-2">
                <FileUploadActions
                  files={uploadDocsFiles}
                  accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"
                  multiple
                  onFilesSelected={setUploadDocsFiles}
                  chooseLabel="בחר קבצים/תמונות"
                  takePhotoLabel="צלם תמונה"
                />
                <div className="text-xs text-muted-foreground">{uploadDocsFiles.length} קבצים</div>
              </div>
              {uploadDocsFiles.length > 0 ? (
                <div className="text-xs text-muted-foreground truncate">
                  {uploadDocsFiles
                    .slice(0, 3)
                    .map((f) => f.name)
                    .join(", ")}
                  {uploadDocsFiles.length > 3 ? ` +${uploadDocsFiles.length - 3}` : ""}
                </div>
              ) : null}
              {uploadDocsFiles.length === 0 ? (
                <div className="text-xs text-destructive">בחר לפחות קובץ אחד</div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="mt-4">
            {!docsUploading &&
            (uploadDocsFiles.length === 0 ||
              (uploadDocsCategoryMode === "new" && !uploadDocsNewCategory.trim())) ? (
              <div className="me-auto text-xs text-destructive">
                לא ניתן להעלות:{" "}
                {uploadDocsFiles.length === 0 ? "קבצים" : ""}
                {uploadDocsFiles.length === 0 &&
                uploadDocsCategoryMode === "new" &&
                !uploadDocsNewCategory.trim()
                  ? ", "
                  : ""}
                {uploadDocsCategoryMode === "new" && !uploadDocsNewCategory.trim()
                  ? "שם קטגוריה"
                  : ""}
              </div>
            ) : (
              <div className="me-auto" />
            )}
            <Button type="button" variant="secondary" disabled={docsUploading} onClick={() => setUploadDocsOpen(false)}>
              ביטול
            </Button>
            <Button
              type="button"
              disabled={
                docsUploading ||
                uploadDocsFiles.length === 0 ||
                (uploadDocsCategoryMode === "new" && !uploadDocsNewCategory.trim())
              }
              onClick={() => void startUploadDocs()}
            >
              {docsUploading ? "מעלה..." : "העלאה"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={editTagOpen}
        onOpenChange={(open) => {
          setEditTagOpen(open);
          if (!open) {
            setEditTagDocumentId(null);
            setEditTagValue("");
          }
        }}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>ערוך קטגוריה</DialogTitle>
            <DialogDescription>עדכון קטגוריה למסמך (documents.document_type).</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="text-sm font-medium">קטגוריה</div>
            <Input
              value={editTagValue}
              onChange={(e) => setEditTagValue(e.target.value)}
              placeholder="למשל: חוזה / חשבונית / תמונות"
            />
          </div>

          <DialogFooter className="mt-4">
            <Button type="button" variant="secondary" onClick={() => setEditTagOpen(false)}>
              ביטול
            </Button>
            <Button type="button" disabled={editTagSaving || !editTagValue.trim()} onClick={() => void saveEditTag()}>
              {editTagSaving ? "שומר..." : "שמירה"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={deleteDocOpen}
        onOpenChange={(open) => {
          setDeleteDocOpen(open);
          if (!open) {
            setDeleteDocId(null);
            setDeleteDocName("");
          }
        }}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>מחיקת מסמך</DialogTitle>
            <DialogDescription>
              פעולה זו תמחק את הרשומה ואת הקובץ מ־Storage (אם יש הרשאה).
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm">
            למחוק את: <span className="font-medium">{deleteDocName || "מסמך"}</span> ?
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={deleteDocDeleting}
              onClick={() => setDeleteDocOpen(false)}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteDocDeleting || !deleteDocId}
              onClick={() => void confirmDeleteDocument()}
            >
              {deleteDocDeleting ? "מוחק..." : "מחיקה"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={Boolean(pendingDeletion)}
        onOpenChange={(open) => {
          if (!open && !pendingDeletionDetails?.busy) {
            setPendingDeletion(null);
          }
        }}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>{pendingDeletionDetails?.title ?? "אישור מחיקה"}</DialogTitle>
            <DialogDescription>
              {pendingDeletionDetails?.description ?? "הפעולה תתבצע רק לאחר אישור."}
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm">
            למחוק את <span className="font-medium">{pendingDeletionDetails?.label ?? "הרשומה"}</span>?
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={pendingDeletionDetails?.busy}
              onClick={() => setPendingDeletion(null)}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!pendingDeletion || pendingDeletionDetails?.busy}
              onClick={() => void confirmPendingDeletion()}
            >
              {pendingDeletionDetails?.busy ? "מוחק..." : "מחיקה"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={updateBasePriceOpen}
        onOpenChange={(open) => {
          setUpdateBasePriceOpen(open);
          if (!open) setUpdateBasePriceValue("");
        }}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>עדכון מחיר בסיס</DialogTitle>
            <DialogDescription>
              מחיר בפועל מחושב ממחיר הבסיס בתוספת החיובים שמסומנים ללקוח.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="text-sm font-medium">מחיר בסיס *</div>
            <Input
              inputMode="numeric"
              value={updateBasePriceValue}
              onChange={(e) => setUpdateBasePriceValue(e.target.value)}
              placeholder="לדוגמה: 12000"
              aria-invalid={Boolean(updateBasePriceError)}
              className={
                updateBasePriceError
                  ? "border-destructive focus-visible:ring-destructive"
                  : ""
              }
            />
            {updateBasePriceError ? (
              <div className="text-xs text-destructive">{updateBasePriceError}</div>
            ) : null}
            {updateBasePriceValue.trim() !== "" && Number.isFinite(updateBasePriceNumber) ? (
              <div className="text-xs text-muted-foreground">
                המחיר בפועל שיוצג לאחר השמירה:{" "}
                {formatIls(updateBasePriceNumber + (billedExpensesTotal ?? 0))}
              </div>
            ) : null}
          </div>

          <DialogFooter className="mt-4">
            {!canSaveBasePrice && !updateBasePriceSaving ? (
              <div className="me-auto text-xs text-destructive">
                לא ניתן לשמור: מחיר בסיס
              </div>
            ) : (
              <div className="me-auto" />
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setUpdateBasePriceOpen(false)}
              disabled={updateBasePriceSaving}
            >
              ביטול
            </Button>
            <Button
              type="button"
              onClick={() => void updateBasePrice(updateBasePriceNumber)}
              disabled={updateBasePriceSaving || !canSaveBasePrice}
            >
              {updateBasePriceSaving ? "שומר..." : "שמירה"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <AddExpenseDialog
        open={addExpenseOpen}
        onOpenChange={(open) => {
          setAddExpenseOpen(open);
          if (!open) setEditingExpense(null);
        }}
        projectId={overview.id}
        projectType={overview.project_type}
        projectStartDate={overview.start_date}
        defaultSessionClockIn={firstWorkerSessionDefaults.clockIn}
        defaultSessionClockOut={firstWorkerSessionDefaults.clockOut}
        users={assignableUsers.filter((user) => user.active !== false)}
        salaryAgreements={salaryAgreements}
        editingItem={editingExpense}
        onSaved={async (saved) => {
          if (saved.source_type === "session" && saved.session?.id) {
            setExpensesUi((prev) => {
              const exists = prev.some(
                (row) => row.source_type === "session" && row.session?.id === saved.session?.id
              );
              if (!exists) return [saved, ...prev];
              return prev.map((row) =>
                row.source_type === "session" && row.session?.id === saved.session?.id ? saved : row
              );
            });
            setEditingExpense(null);
            await expenseRefreshAndWait();
            setAddExpenseOpen(false);
            return;
          }
          const savedExpenseId =
            getString(saved.project_expense, "expense_id") ?? getString(saved.expense, "id");
          setExpensesUi((prev) => {
            if (!savedExpenseId) return editingExpense ? prev : [saved, ...prev];
            const exists = prev.some(
              (item) =>
                (getString(item.project_expense, "expense_id") ?? getString(item.expense, "id")) ===
                savedExpenseId
            );
            if (!exists) return [saved, ...prev];
            return prev.map((item) => {
              const currentId =
                getString(item.project_expense, "expense_id") ?? getString(item.expense, "id");
              return currentId === savedExpenseId ? saved : item;
            });
          });
          setEditingExpense(null);
          await expenseRefreshAndWait();
          setAddExpenseOpen(false);
        }}
      />
      <AddIncomeDialog
        open={addIncomeOpen}
        onOpenChange={(open) => {
          setAddIncomeOpen(open);
          if (!open) setEditingPayment(null);
        }}
        projectId={overview.id}
        projectType={overview.project_type}
        projectStartDate={overview.start_date}
        editingPayment={editingPayment}
        onSaved={(saved) => {
          setPaymentsUi((prev) => {
            const exists = prev.some((item) => item.id === saved.id);
            if (!exists) return [saved, ...prev];
            return prev.map((item) => (item.id === saved.id ? saved : item));
          });
          setEditingPayment(null);
          setAddIncomeOpen(false);
          startTransition(() => router.refresh());
        }}
      />
      </Tabs>
    </ClientOnly>
  );
}

function ProjectTasksTab({
  projectId,
  projectType,
  totalTasks,
  completedTasks,
  openTasks,
  tasks,
  error,
  usersById,
  assignableUsers,
  assignableUsersError,
  onChange,
  onTaskUpdated,
}: {
  projectId: string;
  projectType: string | null;
  totalTasks: number;
  completedTasks: number;
  openTasks: number;
  tasks: Record<string, unknown>[];
  error: string | null;
  usersById: Map<string, AssignableUser>;
  assignableUsers: AssignableUser[];
  assignableUsersError: string | null;
  onChange: () => void;
  onTaskUpdated?: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<{
    id: string;
    next: string;
    subject: string;
    current: string;
  } | null>(null);
  const [confirmPriorityOpen, setConfirmPriorityOpen] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [pendingPriority, setPendingPriority] = useState<{
    id: string;
    next: TaskPriority;
    subject: string;
    current: TaskPriority;
  } | null>(null);

  const [localTasks, setLocalTasks] = useState<Record<string, unknown>[]>(tasks);
  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  const [taskQuery, setTaskQuery] = useState("");
  const [filterTaskStatus, setFilterTaskStatus] = useState<TaskStatus | "">("");
  const [filterTaskPriority, setFilterTaskPriority] = useState<TaskPriority | "">("");
  const [filterAssigneeId, setFilterAssigneeId] = useState<string>("");

  const visibleTasks = useMemo(() => {
    const q = taskQuery.trim().toLowerCase();
    return localTasks.filter((t) => {
      const taskStatus =
        (getFirstString(t, ["status", "task_status"]) ?? "todo") as TaskStatus;
      const taskPriority =
        (getFirstString(t, ["priority"]) ?? "") as TaskPriority | "";

      const assigneeId = getFirstString(t, ["assigned_user_id"]) ?? "";
      const assigneeName =
        getFirstString(t, [
          "assigned_user_name",
          "assigned_to_name",
          "assignee_name",
          "assigned_to_full_name",
        ]) ??
        (assigneeId ? usersById.get(assigneeId)?.full_name ?? usersById.get(assigneeId)?.email ?? "" : "");

      const title =
        getFirstString(t, ["subject", "title", "name", "task_title", "summary"]) ?? "";

      if (filterTaskStatus && taskStatus !== filterTaskStatus) return false;
      if (filterTaskPriority && taskPriority !== filterTaskPriority) return false;
      if (filterAssigneeId && assigneeId !== filterAssigneeId) return false;
      if (!q) return true;
      const hay = `${title} ${assigneeName}`.toLowerCase();
      return hay.includes(q);
    });
  }, [filterAssigneeId, filterTaskPriority, filterTaskStatus, localTasks, taskQuery, usersById]);

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string>("");
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [propertyTargetId, setPropertyTargetId] = useState("");
  const [businessDomain, setBusinessDomain] = useState<ExpenseBusinessDomain>(() =>
    mapProjectTypeToExpenseDomain(projectType)
  );

  const statusOptions = useMemo(() => {
    return ["todo", "in_progress", "blocked", "done", "cancelled"] as TaskStatus[];
  }, []);

  const priorityOptions = useMemo(() => {
    return ["low", "medium", "high", "urgent"] as TaskPriority[];
  }, []);

  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");

  const effectiveStatus = (status || statusOptions[0] || "todo") as TaskStatus;
  const effectivePriority = (priority || priorityOptions[0] || "") as TaskPriority;
  const projectLinkRequired = businessDomain === "logistics_projects";
  const propertyLinkRequired = businessDomain === "property_management";
  const canSubmit =
    Boolean(subject.trim()) &&
    Boolean(dueDate) &&
    Boolean(assignedUserId) &&
    Boolean(effectivePriority) &&
    Boolean(effectiveStatus) &&
    Boolean(businessDomain) &&
    (!propertyLinkRequired || Boolean(propertyTargetId.trim())) &&
    (!projectLinkRequired || Boolean(projectId));

  const subjectError = !subject.trim();
  const dueDateError = !dueDate;
  const assignedUserError = !assignedUserId;
  const propertyTargetError = propertyLinkRequired && !propertyTargetId.trim();
  const createTaskValidationMessage = (() => {
    if (creating || canSubmit) return "";
    const missing: string[] = [];
    if (subjectError) missing.push("כותרת");
    if (dueDateError) missing.push("תאריך יעד");
    if (assignedUserError) missing.push("שיוך למשתמש");
    if (propertyTargetError) missing.push("מזהה נכס");
    return missing.length > 0 ? `חסרים שדות חובה: ${missing.join(", ")}` : "";
  })();

  async function createTask() {
    if (!canSubmit) return;
    setCreating(true);
    emitProgressActivityStart();
    try {
      const res = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_domain: businessDomain,
          project_id: projectLinkRequired ? projectId : null,
          property_id: propertyLinkRequired ? propertyTargetId.trim() : null,
          subject,
          description: description.trim() ? description : undefined,
          due_date: dueDate ? dueDate : null,
          assigned_user_id: assignedUserId ? assignedUserId : null,
          status: effectiveStatus,
          priority: effectivePriority,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error("שגיאה ביצירת משימה", { description: json?.error ?? "" });
        return;
      }
      const createdTaskId =
        typeof json?.task?.id === "string"
          ? (json.task.id as string)
          : typeof json?.task?.task_id === "string"
            ? (json.task.task_id as string)
            : null;

      if (createdTaskId && createFiles.length > 0) {
        for (const file of createFiles) {
          const form = new FormData();
          form.set("task_id", createdTaskId);
          form.set("file", file);

          const uploadRes = await fetch("/api/tasks/attachments/upload", {
            method: "POST",
            body: form,
          });
          const uploadJson = await uploadRes.json().catch(() => ({}));
          if (!uploadRes.ok) {
            toast.error("שגיאה בהעלאת קובץ", {
              description: uploadJson?.error ?? "",
            });
            break;
          }
        }
      }

      toast.success("המשימה נוצרה");
      setCreateOpen(false);
      setSubject("");
      setDescription("");
      setDueDate("");
      setAssignedUserId("");
      setPropertyTargetId("");
      setPriority("");
      setStatus("");
      setCreateFiles([]);
      onChange();
    } catch (e: unknown) {
      toast.error("שגיאה ביצירת משימה", { description: getErrorMessage(e) });
    } finally {
      emitProgressActivityEnd();
      setCreating(false);
    }
  }

  async function updateStatus(id: string, status: TaskStatus) {
    setUpdatingId(id);
    emitProgressActivityStart();
    try {
      const res = await fetch("/api/tasks/update-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error("שגיאה בעדכון סטטוס", { description: json?.error ?? "" });
        return false;
      }
      toast.success("הסטטוס עודכן");
      setLocalTasks((prev) =>
        prev.map((row) => {
          const rowId = getFirstString(row, ["task_id", "id"]);
          if (rowId !== id) return row;
          return { ...row, status };
        })
      );
      onTaskUpdated?.(id, { status });
      onChange();
      return true;
    } catch (e: unknown) {
      toast.error("שגיאה בעדכון סטטוס", { description: getErrorMessage(e) });
      return false;
    } finally {
      emitProgressActivityEnd();
      setUpdatingId(null);
    }
  }

  async function updatePriority(id: string, priority: TaskPriority) {
    setUpdatingId(id);
    emitProgressActivityStart();
    try {
      const res = await fetch("/api/tasks/update-priority", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, priority }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error("שגיאה בעדכון עדיפות", { description: json?.error ?? "" });
        return false;
      }
      toast.success("העדיפות עודכנה");
      setLocalTasks((prev) =>
        prev.map((row) => {
          const rowId = getFirstString(row, ["task_id", "id"]);
          if (rowId !== id) return row;
          return { ...row, priority };
        })
      );
      onTaskUpdated?.(id, { priority });
      onChange();
      return true;
    } catch (e: unknown) {
      toast.error("שגיאה בעדכון עדיפות", { description: getErrorMessage(e) });
      return false;
    } finally {
      emitProgressActivityEnd();
      setUpdatingId(null);
    }
  }

  function requestStatusChange(args: {
    id: string;
    next: TaskStatus;
    subject: string;
    current: TaskStatus;
  }) {
    setPendingStatus(args);
    setConfirmOpen(true);
  }

  async function confirmStatusChange() {
    if (!pendingStatus) return;
    setSavingStatus(true);
    try {
      const ok = await updateStatus(
        pendingStatus.id,
        pendingStatus.next as TaskStatus
      );
      if (ok) {
        setConfirmOpen(false);
        setPendingStatus(null);
      }
    } finally {
      setSavingStatus(false);
    }
  }

  function requestPriorityChange(args: {
    id: string;
    next: TaskPriority;
    subject: string;
    current: TaskPriority;
  }) {
    setPendingPriority(args);
    setConfirmPriorityOpen(true);
  }

  async function confirmPriorityChange() {
    if (!pendingPriority) return;
    setSavingPriority(true);
    try {
      const ok = await updatePriority(pendingPriority.id, pendingPriority.next);
      if (ok) {
        setConfirmPriorityOpen(false);
        setPendingPriority(null);
      }
    } finally {
      setSavingPriority(false);
    }
  }

  async function deleteTask(id: string, subject: string) {
    const ok = window.confirm(`למחוק את המשימה "${subject}"?`);
    if (!ok) return;

    setDeletingTaskId(id);
    emitProgressActivityStart();
    try {
      const res = await fetch("/api/tasks/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה במחיקת משימה", { description: json?.error ?? "" });
        return;
      }

      toast.success("המשימה נמחקה");
      setLocalTasks((prev) =>
        prev.filter((row) => (getFirstString(row, ["task_id", "id"]) ?? "") !== id)
      );
      onChange();
    } catch (e: unknown) {
      toast.error("שגיאה במחיקת משימה", { description: getErrorMessage(e) });
    } finally {
      emitProgressActivityEnd();
      setDeletingTaskId(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">משימות</CardTitle>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            הוספת משימה
          </Button>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-md border bg-card px-3 py-2">
              <div className="text-xs text-muted-foreground">סה״כ</div>
              <div className="font-medium">{totalTasks}</div>
            </div>
            <div className="rounded-md border bg-card px-3 py-2">
              <div className="text-xs text-muted-foreground">פתוחות</div>
              <div className="font-medium">{openTasks}</div>
            </div>
            <div className="rounded-md border bg-card px-3 py-2">
              <div className="text-xs text-muted-foreground">הושלמו</div>
              <div className="font-medium">{completedTasks}</div>
            </div>
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1 xl:col-span-2">
              <div className="text-xs text-muted-foreground">חיפוש</div>
              <Input
                value={taskQuery}
                onChange={(e) => setTaskQuery(e.target.value)}
                placeholder="חיפוש משימות..."
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">סטטוס</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterTaskStatus}
                onChange={(e) => setFilterTaskStatus(e.target.value as TaskStatus | "")}
              >
                <option value="">הכל</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {taskStatusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">עדיפות</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterTaskPriority}
                onChange={(e) => setFilterTaskPriority(e.target.value as TaskPriority | "")}
              >
                <option value="">הכל</option>
                {priorityOptions.map((p) => (
                  <option key={p} value={p}>
                    {taskPriorityLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">משויך</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={filterAssigneeId}
                onChange={(e) => setFilterAssigneeId(e.target.value)}
              >
                <option value="">הכל</option>
                {assignableUsers
                  .filter((u) => u.active !== false)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name ?? u.email}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {error ? (
            <div className="text-destructive text-sm">
              שגיאה בטעינת משימות: {error}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-muted-foreground">אין משימות להצגה.</div>
          ) : visibleTasks.length === 0 ? (
            <div className="text-muted-foreground">אין משימות לפי הסינון.</div>
          ) : (
            <>
              <div className="space-y-2 md:hidden">
                {visibleTasks.map((t) => {
                  const taskId = getFirstString(t, ["task_id", "id"]) ?? "";
                  const title =
                    getFirstString(t, ["subject", "title", "name", "task_title", "summary"]) ??
                    "משימה";
                  const status =
                    (getFirstString(t, ["status", "task_status"]) ?? "todo") as TaskStatus;
                  const due =
                    getFirstDate(t, ["due_date", "deadline", "end_date"]) ?? null;
                  const priority =
                    (getFirstString(t, ["priority"]) ?? "") as TaskPriority | "";
                  const assignee =
                    getFirstString(t, [
                      "assigned_user_name",
                      "assigned_to_name",
                      "assignee_name",
                      "assigned_to_full_name",
                    ]) ??
                    (() => {
                      const id = getFirstString(t, ["assigned_user_id"]);
                      if (!id) return null;
                      const u = usersById.get(id);
                      return u?.full_name ?? u?.email ?? null;
                    })() ??
                    null;

                  return (
                    <Card key={taskId || title}>
                      <CardContent className="space-y-3 p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          {taskId ? (
                            <Link
                              href={`/tasks/${taskId}?returnTo=${encodeURIComponent(
                                `/projects/${projectId}?tab=tasks`
                              )}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {title}
                            </Link>
                          ) : (
                            <div className="font-medium">{title}</div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          {priority ? <StatusBadge value={priority} type="priority" /> : null}
                          <StatusBadge value={status} type="task" />
                        </div>
                        <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
                          <div>
                            יעד:{" "}
                            <span className="text-foreground">
                              {due ? formatDate(due) : "—"}
                            </span>
                          </div>
                          <div>
                            משויך:{" "}
                            <span className="text-foreground">{assignee ?? "—"}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-10"
                            disabled={!taskId || deletingTaskId === taskId}
                            onClick={() => {
                              setEditId(taskId);
                              setEditOpen(true);
                            }}
                          >
                            עריכה
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="h-10"
                            disabled={!taskId || deletingTaskId === taskId}
                            onClick={() => void deleteTask(taskId, title)}
                          >
                            {deletingTaskId === taskId ? "מוחק..." : "מחיקה"}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="hidden md:block rounded-md border overflow-x-auto">
                <table className="min-w-[760px] w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="text-right font-medium px-3 py-2">משימה</th>
                      <th className="text-right font-medium px-3 py-2">תאריך יעד</th>
                      <th className="text-right font-medium px-3 py-2">משויך</th>
                      <th className="text-right font-medium px-3 py-2">עדיפות</th>
                      <th className="text-right font-medium px-3 py-2">סטטוס</th>
                      <th className="text-right font-medium px-3 py-2">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {visibleTasks.map((t) => {
                      const taskId = getFirstString(t, ["task_id", "id"]) ?? "";
                      const title =
                        getFirstString(t, [
                          "subject",
                          "title",
                          "name",
                          "task_title",
                          "summary",
                        ]) ?? "משימה";
                      const status =
                        (getFirstString(t, ["status", "task_status"]) ?? "todo") as TaskStatus;
                      const due =
                        getFirstDate(t, ["due_date", "deadline", "end_date"]) ?? null;
                      const priority =
                        (getFirstString(t, ["priority"]) ?? "") as TaskPriority | "";
                      const assignee =
                        getFirstString(t, [
                          "assigned_user_name",
                          "assigned_to_name",
                          "assignee_name",
                          "assigned_to_full_name",
                        ]) ??
                        (() => {
                          const id = getFirstString(t, ["assigned_user_id"]);
                          if (!id) return null;
                          const u = usersById.get(id);
                          return u?.full_name ?? u?.email ?? null;
                        })() ??
                        null;

                      const disabled = !taskId || updatingId === taskId || deletingTaskId === taskId;

                      return (
                        <tr key={taskId || title} className="hover:bg-muted/30">
                          <td className="px-3 py-2">
                            {taskId ? (
                              <Link
                                href={`/tasks/${taskId}?returnTo=${encodeURIComponent(
                                  `/projects/${projectId}?tab=tasks`
                                )}`}
                                className="font-medium text-primary hover:underline"
                              >
                                {title}
                              </Link>
                            ) : (
                              <span className="font-medium">{title}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {due ? formatDate(due) : "—"}
                          </td>
                          <td className="px-3 py-2">{assignee ? assignee : "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {priority ? (
                              <PriorityDropdown
                                priority={priority}
                                options={priorityOptions}
                                disabled={disabled}
                                onSelect={(next) => {
                                  if (next === priority) return;
                                  requestPriorityChange({
                                    id: taskId,
                                    next,
                                    subject: title,
                                    current: priority,
                                  });
                                }}
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <StatusDropdown
                              status={status}
                              options={statusOptions}
                              disabled={disabled}
                              onSelect={(next) => {
                                if (next === status) return;
                                requestStatusChange({
                                  id: taskId,
                                  next,
                                  subject: title,
                                  current: status,
                                });
                              }}
                            />
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!taskId || deletingTaskId === taskId}
                                onClick={() => {
                                  setEditId(taskId);
                                  setEditOpen(true);
                                }}
                              >
                                עריכה
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                disabled={!taskId || deletingTaskId === taskId}
                                onClick={() => void deleteTask(taskId, title)}
                              >
                                {deletingTaskId === taskId ? "מוחק..." : "מחיקה"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>אישור שינוי סטטוס</DialogTitle>
            <DialogDescription>
              {pendingStatus
                ? `לשנות את הסטטוס של “${pendingStatus.subject}” מ־${taskStatusLabel(
                    pendingStatus.current
                  )} ל־${taskStatusLabel(pendingStatus.next)}?`
                : " "}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={savingStatus}
              onClick={() => {
                setConfirmOpen(false);
                setPendingStatus(null);
              }}
            >
              ביטול
            </Button>
            <Button
              type="button"
              disabled={savingStatus}
              onClick={() => void confirmStatusChange()}
            >
              {savingStatus ? "מעדכן..." : "אישור"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={confirmPriorityOpen}
        onOpenChange={setConfirmPriorityOpen}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>אישור שינוי עדיפות</DialogTitle>
            <DialogDescription>
              {pendingPriority
                ? `לשנות את העדיפות של “${pendingPriority.subject}” מ־${taskPriorityLabel(
                    pendingPriority.current
                  )} ל־${taskPriorityLabel(pendingPriority.next)}?`
                : " "}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={savingPriority}
              onClick={() => {
                setConfirmPriorityOpen(false);
                setPendingPriority(null);
              }}
            >
              ביטול
            </Button>
            <Button
              type="button"
              disabled={savingPriority}
              onClick={() => void confirmPriorityChange()}
            >
              {savingPriority ? "מעדכן..." : "אישור"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateFiles([]);
            setPropertyTargetId("");
          }
        }}
      >
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>הוספת משימה</DialogTitle>
            <DialogDescription>
              {projectLinkRequired
                ? "משימה תתווסף לפרויקט ותופיע ברשימה."
                : propertyLinkRequired
                  ? "הזינו את מזהה הנכס שאליו המשימה קשורה."
                  : "משימה כללית ללא קישור ישיר לפרויקט או נכס."}
            </DialogDescription>
          </DialogHeader>

          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createTask();
            }}
          >
            <div className="space-y-1">
              <div className="text-sm font-medium">כותרת *</div>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="לדוגמה: להתקשר לספק"
                aria-invalid={subjectError}
                className={
                  subjectError ? "border-destructive focus-visible:ring-destructive" : ""
                }
              />
              {subjectError ? (
                <div className="text-xs text-destructive">שדה חובה</div>
              ) : null}
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תיאור (אופציונלי)</div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="פרטים נוספים..."
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך יעד *</div>
              <DateInput
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-invalid={dueDateError}
                className={
                  dueDateError ? "border-destructive focus-visible:ring-destructive" : ""
                }
              />
              {dueDateError ? (
                <div className="text-xs text-destructive">שדה חובה</div>
              ) : null}
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">שיוך למשתמש *</div>
              {assignableUsersError ? (
                <div className="text-xs text-destructive">
                  שגיאה בטעינת משתמשים: {assignableUsersError}
                </div>
              ) : (
                <select
                  className={
                    "h-10 w-full rounded-md border border-input bg-background px-3 text-sm " +
                    (assignedUserError ? "border-destructive" : "")
                  }
                  value={assignedUserId}
                  onChange={(e) => setAssignedUserId(e.target.value)}
                >
                  <option value="">בחר משתמש…</option>
                  {assignableUsers
                    .filter((u) => u.active !== false)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name ?? u.email}
                      </option>
                    ))}
                </select>
              )}
              {!assignableUsersError && assignedUserError ? (
                <div className="text-xs text-destructive">שדה חובה</div>
              ) : null}
            </div>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <div className="text-sm font-medium">דומיין *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={businessDomain}
                  onChange={(e) => {
                    const nextDomain = e.target.value as ExpenseBusinessDomain;
                    setBusinessDomain(nextDomain);
                    if (nextDomain !== "property_management") {
                      setPropertyTargetId("");
                    }
                  }}
                >
                  {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                    <option key={domain} value={domain}>
                      {getBusinessDomainLabel(domain)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">עדיפות *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={effectivePriority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {priorityOptions.map((p) => (
                    <option key={p} value={p}>
                      {taskPriorityLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">סטטוס *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={effectiveStatus}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {taskStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            </AdaptiveGrid>

            {projectLinkRequired ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">מזהה פרויקט</div>
                <Input value={projectId} readOnly disabled />
              </div>
            ) : null}

            {propertyLinkRequired ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">מזהה נכס *</div>
                <Input
                  value={propertyTargetId}
                  onChange={(e) => setPropertyTargetId(e.target.value)}
                  placeholder="הזינו מזהה נכס"
                  aria-invalid={propertyTargetError}
                  className={
                    propertyTargetError
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }
                />
                {propertyTargetError ? (
                  <div className="text-xs text-destructive">שדה חובה</div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-sm font-medium">
                {"\u05E7\u05D1\u05E6\u05D9\u05DD \u05DE\u05E6\u05D5\u05E8\u05E4\u05D9\u05DD (\u05D0\u05D5\u05E4\u05E6\u05D9\u05D5\u05E0\u05DC\u05D9)"}
              </div>
              <div className="flex items-center justify-between gap-2">
                <FileUploadActions
                  files={createFiles}
                  accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"
                  multiple
                  onFilesSelected={setCreateFiles}
                  chooseLabel={
                    createFiles.length > 0
                      ? "\u05E9\u05D9\u05E0\u05D5\u05D9 \u05E7\u05D1\u05E6\u05D9\u05DD"
                      : "\u05D1\u05D7\u05D9\u05E8\u05EA \u05E7\u05D1\u05E6\u05D9\u05DD"
                  }
                />
                <div className="text-xs text-muted-foreground">
                  {createFiles.length} {"\u05E7\u05D1\u05E6\u05D9\u05DD"}
                </div>
              </div>
              {createFiles.length > 0 ? (
                <div className="text-xs text-muted-foreground truncate">
                  {createFiles
                    .slice(0, 3)
                    .map((f) => f.name)
                    .join(", ")}
                  {createFiles.length > 3 ? ` +${createFiles.length - 3}` : ""}
                </div>
              ) : null}
            </div>

            <DialogFooter className="mt-6">
              {!canSubmit && !creating ? (
                <div className="me-auto text-xs text-destructive">
                  {createTaskValidationMessage}
                </div>
              ) : (
                <div className="me-auto" />
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCreateOpen(false)}
              >
                ביטול
              </Button>
              <Button type="submit" disabled={creating || !canSubmit}>
                {creating ? "יוצר..." : "יצירה"}
              </Button>
            </DialogFooter>
          </form>
        </AdaptiveDialog>
      </Dialog>

      <TaskUpsertDialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditId(null);
        }}
        mode="edit"
        taskId={editId}
        users={assignableUsers
          .filter((u) => u.active !== false)
          .map((u) => ({ id: u.id, label: u.full_name ?? u.email }))}
        fixedTarget={{ type: "project", id: projectId }}
        defaultProjectType={projectType}
        onSaved={onChange}
      />
    </>
  );
}

function StatusDropdown({
  status,
  options,
  disabled,
  onSelect,
}: {
  status: TaskStatus;
  options: TaskStatus[];
  disabled: boolean;
  onSelect: (next: TaskStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" disabled={disabled}>
          <StatusBadge value={status} type="task" className="h-9 px-3 text-sm cursor-pointer select-none" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((opt) => (
          <DropdownMenuItem key={opt} onClick={() => onSelect(opt)}>
            <span className="me-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${getStatusDotClasses(getTaskStatusColor(opt))}`} />
            </span>
            {getTaskStatusLabel(opt)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-xs text-muted-foreground">
          שינוי סטטוס יעדכן את המשימה
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityDropdown({
  priority,
  options,
  disabled,
  onSelect,
}: {
  priority: TaskPriority;
  options: TaskPriority[];
  disabled: boolean;
  onSelect: (next: TaskPriority) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" disabled={disabled}>
          <StatusBadge
            value={priority}
            type="priority"
            className="h-9 px-3 text-sm cursor-pointer select-none"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((opt) => (
          <DropdownMenuItem key={opt} onClick={() => onSelect(opt)}>
            <span className="me-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${getStatusDotClasses(getTaskPriorityColor(opt))}`} />
            </span>
            {getTaskPriorityLabel(opt)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-xs text-muted-foreground">
          שינוי עדיפות יעדכן את המשימה
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function projectTypeLabel(value: string) {
  switch (value) {
    case "logistics":
      return "\u05dc\u05d5\u05d2\u05d9\u05e1\u05d8\u05d9\u05e7\u05d4";
    case "construction":
      return "\u05e9\u05d9\u05e4\u05d5\u05e6\u05d9\u05dd";
    case "moving":
      return "\u05d4\u05d5\u05d1\u05dc\u05d4";
    default:
      return value;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

const PROJECT_EXPENSE_CATEGORY_OPTIONS = [
  "\u05e9\u05db\u05e8 \u05e2\u05d5\u05d1\u05d3",
  "\u05e8\u05db\u05e9",
  "\u05ea\u05d7\u05d1\u05d5\u05e8\u05d4",
  "\u05d0\u05d5\u05db\u05dc",
  "\u05d0\u05d7\u05e8",
] as const;
const OTHER_PROJECT_EXPENSE_CATEGORY = "\u05d0\u05d7\u05e8";
const EMPLOYEE_WAGE_CATEGORY = "\u05e9\u05db\u05e8 \u05e2\u05d5\u05d1\u05d3";

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

function AddExpenseDialog({
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
  const [expensePaymentStatus, setExpensePaymentStatus] = useState<"paid" | "partial" | "not_paid">("not_paid");
  const [expensePaidAmount, setExpensePaidAmount] = useState("");
  const [expensePaymentMethod, setExpensePaymentMethod] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<FinancialAttachment[]>([]);
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
        Boolean(expenseDate));

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
          description: json?.error ?? "",
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
            description: json?.error ?? "",
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
          payment_status: expensePaymentStatus,
          paid_amount: expensePaymentStatus === "partial" ? (Number(expensePaidAmount) || null) : null,
          payment_method: (expensePaymentStatus === "paid" || expensePaymentStatus === "partial") ? (expensePaymentMethod || null) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(isEditing ? "שגיאה בעדכון ההוצאה" : "שגיאה בהוספת הוצאה", {
          description: json?.error ?? "",
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
              <Input
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
                      <option value="bank_transfer">העברה בנקאית</option>
                      <option value="cash">מזומן</option>
                      <option value="check">צ&apos;ק</option>
                      <option value="credit_card">כרטיס אשראי</option>
                      <option value="other">אחר</option>
                    </select>
                  </div>
                  {expensePaymentStatus === "partial" && (
                    <div className="space-y-1">
                      <div className="text-sm font-medium">סכום ששולם</div>
                      <Input
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
                    <Input
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
                    <Input
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
              <div className="flex flex-col gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                  type="checkbox"
                  checked={billedToCustomer}
                  onChange={(e) => setBilledToCustomer(e.target.checked)}
                />
                <span>{"\u05dc\u05d7\u05d9\u05d5\u05d1 \u05dc\u05e7\u05d5\u05d7"}</span>
              </label>
              <div className="text-xs text-muted-foreground">
                {billedToCustomer ? "ההוצאה תסומן כחויבה ללקוח." : "אם לא מסומן, ההוצאה נכללת בבסיס כברירת מחדל."}
              </div>
            </div>
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
            {attachmentFiles.length > 0 ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                {attachmentFiles.map((file) => (
                  <div key={`${file.name}-${file.size}`}>{file.name}</div>
                ))}
              </div>
            ) : null}
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
function AddIncomeDialog({
  open,
  onOpenChange,
  projectId,
  projectType,
  projectStartDate,
  editingPayment,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectType: string | null;
  projectStartDate: string | null;
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
          due_date: paymentMethod === "check" ? dueDate : null,
          requires_split: requiresSplit,
          payment_method: paymentMethod.trim() ? paymentMethod : undefined,
          reference_number: referenceNumber.trim() ? referenceNumber : undefined,
          notes: notes.trim() ? notes : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(isEditing ? "שגיאה בעדכון ההכנסה" : "שגיאה בהוספת ההכנסה", {
          description: json?.error ?? "",
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
              <Input
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
                  const nextMethod = e.target.value;
                  setPaymentMethod(nextMethod);
                  if (nextMethod !== "check") setDueDate("");
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
              {requiresDueDate ? (
                <>
                  <div className="text-sm font-medium">תאריך פירעון *</div>
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
                  ) : null}
                </>
              ) : (
                <>
                  <div className="text-sm font-medium">{"\u05d0\u05e1\u05de\u05db\u05ea\u05d0 (\u05d0\u05d5\u05e4\u05e6\u05d9\u05d5\u05e0\u05dc\u05d9)"}</div>
                  <Input
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder={"\u05de\u05e1\u05e4\u05e8 \u05e7\u05d1\u05dc\u05d4/\u05d4\u05e2\u05d1\u05e8\u05d4"}
                  />
                </>
              )}
            </div>
          </AdaptiveGrid>

          {requiresDueDate ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05d0\u05e1\u05de\u05db\u05ea\u05d0 (\u05d0\u05d5\u05e4\u05e6\u05d9\u05d5\u05e0\u05dc\u05d9)"}</div>
              <Input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder={"\u05de\u05e1\u05e4\u05e8 \u05e7\u05d1\u05dc\u05d4/\u05d4\u05e2\u05d1\u05e8\u05d4"}
              />
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requiresSplit}
              onChange={(e) => setRequiresSplit(e.target.checked)}
            />
            <span>כולל מע״מ 18%</span>
          </label>

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
            {attachmentFiles.length > 0 ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                {attachmentFiles.map((file) => (
                  <div key={`${file.name}-${file.size}`}>{file.name}</div>
                ))}
              </div>
            ) : null}
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

