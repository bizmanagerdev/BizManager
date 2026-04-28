"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
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
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { ORDER_PAYMENT_METHOD_OPTIONS, paymentMethodLabel } from "@/lib/orders/paymentStatus";
import {
  type PaymentRow,
  type FinancialAttachment,
} from "@/lib/payments";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import {
  mapProjectTypeToExpenseDomain,
} from "@/lib/expenses";
import { addMinutes, formatMinutes, sessionWorkedMinutes, type WorkSessionRow } from "@/lib/payroll";
import { getStatusDotClasses } from "@/lib/ui/status-color-classes";
import {
  getTaskPriorityColor,
  getTaskPriorityLabel,
  getTaskStatusColor,
  getTaskStatusLabel,
} from "@/lib/ui/status-colors";

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
};

type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
type TaskPriority = "low" | "medium" | "high" | "urgent";

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

async function uploadFinancialAttachment(entityType: "expense" | "payment", entityId: string, file: File) {
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
  payments,
  paymentsError,
}: {
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
    url: string | null;
  }>;
  projectDocumentsError: string | null;
  assignableUsers: AssignableUser[];
  assignableUsersError: string | null;
  expenses: ExpenseListItem[];
  expensesError: string | null;
  payments: PaymentRow[];
  paymentsError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [docsUploading, setDocsUploading] = useState(false);
  const [docsFilterCategory, setDocsFilterCategory] = useState<string>("");
  const [expensesUi, setExpensesUi] = useState<ExpenseListItem[]>(expenses);
  const [paymentsUi, setPaymentsUi] = useState<PaymentRow[]>(payments);
  const [projectTasksUi, setProjectTasksUi] =
    useState<Record<string, unknown>[]>(projectTasks);

  useEffect(() => {
    setExpensesUi(expenses);
  }, [expenses]);

  useEffect(() => {
    setPaymentsUi(payments);
  }, [payments]);

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
        return [
          {
            type: "expense" as const,
            id: item.session.id,
            date: item.session.clock_in ?? null,
            amount: sessionLaborCost(item.session),
            title: `שכר עובד — ${workerName}`,
            meta: [
              `כניסה: ${formatDateTime(item.session.clock_in)}`,
              `יציאה: ${formatDateTime(item.session.clock_out)}`,
              `משך: ${formatMinutes(sessionWorkedMinutes(item.session))}`,
            ],
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

      const meta: string[] = [];
      return [
        {
          type: "expense" as const,
          id: expenseId,
          date,
          amount,
          title,
          meta,
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
      const res = await fetch("/api/profile/session/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          project_id: overview.id,
        }),
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
    const isSession = Boolean(session);
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
        (expenseId ? `הוצאה ${expenseId.slice(0, 8)}` : "הוצאה");
    const attachments =
      !isSession && Array.isArray(item.expense?.attachments)
        ? (item.expense.attachments as FinancialAttachment[])
        : [];

    const billed = session
      ? isSessionBillable(session)
      : Boolean(item.project_expense?.["billed_to_customer"]);

    return (
      <div
        key={session ? session.id : expenseId ?? String(idx)}
        className="py-3 flex items-start justify-between gap-4"
      >
        <div className="min-w-0">
          <div className="font-medium truncate">{title}</div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <span>{formatDate(createdAt)}</span>
            {session ? (
              <>
                <span>כניסה: {formatDateTime(session.clock_in)}</span>
                <span>יציאה: {formatDateTime(session.clock_out)}</span>
                <span>משך: {formatMinutes(sessionWorkedMinutes(session))}</span>
                {options?.billedList ? (
                  <span>עלות עבודה: {formatIls(amount)}</span>
                ) : null}
              </>
            ) : null}
            {billed && options?.showBillableBadge !== false ? (
              <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                חויב ללקוח
              </span>
            ) : null}
          </div>
          {session?.notes ? (
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {session.notes}
            </div>
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
        <div className="shrink-0 text-left">
          <div className="font-medium">
            {options?.billedList
              ? billedAmount === null
                ? "—"
                : formatIls(billedAmount)
              : amount === null
                ? "—"
                : formatIls(amount)}
          </div>
          <div className="mt-2 flex gap-2">
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
              onClick={() => void (session ? deleteSession(item) : deleteExpense(item))}
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
      <TabsList className="mx-auto flex h-auto w-fit max-w-full flex-wrap justify-center gap-2 overflow-visible border-b-0 bg-transparent p-0 shadow-none [&>*]:min-w-[8.5rem] [&>*]:flex-none [&>*]:rounded-t-xl [&>*]:border [&>*]:border-foreground/25 [&>*]:bg-gradient-to-b [&>*]:from-foreground/10 [&>*]:to-foreground/22 [&>*]:px-5 [&>*]:py-3 [&>*]:text-base [&>*]:font-semibold [&>*]:text-foreground [&>*]:shadow-sm [&>*]:transition-colors [&>*]:hover:border-foreground/40 [&>*]:hover:from-foreground/16 [&>*]:hover:to-foreground/28 [&>*]:hover:text-foreground [&>*]:data-[state=active]:border-foreground [&>*]:data-[state=active]:bg-none [&>*]:data-[state=active]:bg-foreground [&>*]:data-[state=active]:text-background">
        <TabsTrigger value="overview">כספים</TabsTrigger>
        <TabsTrigger value="tasks" className="gap-2">
          <span>משימות</span>
          <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px]">
            {completion}%
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="documents" className="gap-2">
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
            <div className="grid gap-3 text-sm md:grid-cols-4">
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">מחיר בסיס שסוכם</div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-lg font-semibold">{formatIls(displayedBasePrice)}</div>
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
                <div className="mt-2 text-lg font-semibold">{formatIls(displayedCustomerPrice)}</div>
              </div>
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">הוצאות</div>
                <div className="mt-2 text-lg font-semibold">{formatIls(totalExpenses)}</div>
              </div>
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">רווח גולמי</div>
                <div className={("mt-2 text-lg font-semibold " + (grossProfit !== null && grossProfit < 0 ? "text-destructive" : "")).trim()}>
                  {formatIls(grossProfit)}
                </div>
              </div>
            </div>
            {billedExpensesTotal > 0 ? (
              <div className="text-xs text-muted-foreground">
                מחיר בפועל מחושב כמחיר הבסיס ועוד {formatIls(billedExpensesTotal)} עבור חיובים ללקוח.
              </div>
            ) : displayedBasePrice !== null ? (
              <div className="text-xs text-muted-foreground">מחיר בפועל זהה למחיר הבסיס כרגע.</div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-3 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-base">הכנסות</CardTitle>
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

                    return (
                      <div key={p.id} className="py-3 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {reference ? `אסמכתא: ${reference}` : "הכנסה"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            <span>{formatDate(date)}</span>
                            <span>{method}</span>
                            {dueDate ? <span>פירעון: {formatDate(dueDate)}</span> : null}
                          </div>
                          {paymentStatus ? (
                            <div className="mt-2">
                              <StatusBadge value={paymentStatus} type="payment" />
                            </div>
                          ) : null}
                          {p.notes ? (
                            <div className="text-xs text-muted-foreground mt-1 truncate">
                              {p.notes}
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
                        <div className="shrink-0 text-left">
                          <div className="font-medium">
                            {amount === null ? "—" : formatIls(amount)}
                          </div>
                          <div className="mt-2 flex gap-2">
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
                              onClick={() => void deletePayment(p)}
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

              <div className="mt-3 mt-auto flex items-center justify-between border-t pt-3">
                <span className="text-muted-foreground">סה״כ הכנסות</span>
                <span className="font-medium">{formatIls(paymentsTotal)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between">
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
                  {expensesUi.map((item, idx) => renderExpenseRow(item, idx))}
                </div>
              )}

              {billedExpensesTotal > 0 ? (
                <div className="pt-2 text-xs text-muted-foreground">
                  מתוכן {formatIls(billedExpensesTotal)} יתווספו לחיוב הלקוח.
                </div>
              ) : null}
              <div className="mt-3 mt-auto flex items-center justify-between border-t pt-3">
                <span className="text-muted-foreground">סה״כ הוצאות</span>
                <span className="font-medium">{formatIls(totalExpenses)}</span>
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

                    return (
                      <div
                        key={`${ev.type}:${ev.id}`}
                        className="py-3 flex items-start justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">{ev.title}</div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            <span>{formatDate(ev.date)}</span>
                            {ev.meta.map((m) => (
                              <span
                                key={m}
                                className={
                                  m === "חויב ללקוח"
                                    ? "inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-800"
                                    : undefined
                                }
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div
                          className={
                            "shrink-0 font-medium " +
                            (signedAmount === null
                              ? ""
                              : isIncome
                              ? "text-success"
                              : "text-destructive")
                          }
                        >
                          {signedAmount === null ? "" : isIncome ? "+" : "-"} {amountText}
                        </div>
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
                <span className="font-medium">{formatIls(billedExpensesTotal)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="tasks" className="mx-auto mt-4 w-full max-w-6xl">
        <ProjectTasksTab
          projectId={overview.id}
          customerId={overview.customer_id}
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
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-[240px] space-y-1">
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

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={docsUploading}
                  onClick={() => setUploadDocsOpen(true)}
                >
                  {docsUploading ? "מעלה..." : "העלאה"}
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
                      className="p-3 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
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
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
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
                  chooseLabel="בחר קבצים"
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
        users={assignableUsers.filter((user) => user.active !== false)}
        editingItem={editingExpense}
        onSaved={(saved) => {
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
            setAddExpenseOpen(false);
            startTransition(() => router.refresh());
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
          setAddExpenseOpen(false);
          startTransition(() => router.refresh());
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
  customerId,
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
  customerId: string;
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

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string>("");
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [createFiles, setCreateFiles] = useState<File[]>([]);

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
  const canSubmit =
    Boolean(subject.trim()) &&
    Boolean(dueDate) &&
    Boolean(assignedUserId) &&
    Boolean(effectivePriority) &&
    Boolean(effectiveStatus);

  const subjectError = !subject.trim();
  const dueDateError = !dueDate;
  const assignedUserError = !assignedUserId;
  const createTaskValidationMessage = (() => {
    if (creating || canSubmit) return "";
    const missing: string[] = [];
    if (subjectError) missing.push("כותרת");
    if (dueDateError) missing.push("תאריך יעד");
    if (assignedUserError) missing.push("שיוך למשתמש");
    return missing.length > 0 ? `חסרים שדות חובה: ${missing.join(", ")}` : "";
  })();

  async function createTask() {
    if (!canSubmit) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          customer_id: customerId,
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
      setPriority("");
      setStatus("");
      setCreateFiles([]);
      onChange();
    } catch (e: unknown) {
      toast.error("שגיאה ביצירת משימה", { description: getErrorMessage(e) });
    } finally {
      setCreating(false);
    }
  }

  async function updateStatus(id: string, status: TaskStatus) {
    setUpdatingId(id);
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
      setUpdatingId(null);
    }
  }

  async function updatePriority(id: string, priority: TaskPriority) {
    setUpdatingId(id);
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

  return (
    <>
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
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
          <div className="flex flex-wrap gap-2 mb-3">
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

          {error ? (
            <div className="text-destructive text-sm">
              שגיאה בטעינת משימות: {error}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-muted-foreground">אין משימות להצגה.</div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="min-w-[760px] w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-right font-medium px-3 py-2">משימה</th>
                    <th className="text-right font-medium px-3 py-2">תאריך יעד</th>
                    <th className="text-right font-medium px-3 py-2">משויך</th>
                    <th className="text-right font-medium px-3 py-2">עדיפות</th>
                    <th className="text-right font-medium px-3 py-2">סטטוס</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {localTasks.map((t) => {
                    const taskId =
                      getFirstString(t, ["task_id", "id"]) ?? "";
                    const title =
                      getFirstString(t, [
                        "subject",
                        "title",
                        "name",
                        "task_title",
                        "summary",
                      ]) ?? "משימה";
                    const status =
                      (getFirstString(t, ["status", "task_status"]) ??
                        "todo") as TaskStatus;
                    const due =
                      getFirstDate(t, ["due_date", "deadline", "end_date"]) ??
                      null;
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

                    const disabled = !taskId || updatingId === taskId;

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
                        <td className="px-3 py-2">
                          {assignee ? assignee : "—"}
                        </td>
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
          if (!open) setCreateFiles([]);
        }}
      >
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>הוספת משימה</DialogTitle>
            <DialogDescription>משימה תתווסף לפרויקט ותופיע ברשימה.</DialogDescription>
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
              <Input
                type="date"
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
      return "\u05d1\u05e0\u05d9\u05d9\u05d4";
    case "moving":
      return "\u05d4\u05d5\u05d1\u05dc\u05d4";
    case "other":
      return "\u05d0\u05d7\u05e8";
    case "home":
      return "\u05d1\u05d9\u05ea";
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

function nowLocalDateTime(offsetMinutes = 0) {
  const value = new Date();
  value.setSeconds(0, 0);
  value.setMinutes(value.getMinutes() + offsetMinutes);
  return toLocalDateTimeValue(value.toISOString());
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
  users,
  editingItem,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectType: string;
  users: AssignableUser[];
  editingItem: ExpenseListItem | null;
  onSaved: (saved: ExpenseListItem) => void;
}) {
  const getTodayDate = () => new Date().toISOString().slice(0, 10);
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
  const [newWorkerEmail, setNewWorkerEmail] = useState("");
  const [newWorkerPhone, setNewWorkerPhone] = useState("");
  const [newWorkerPassword, setNewWorkerPassword] = useState("");
  const [newWorkerRole, setNewWorkerRole] = useState<"worker" | "worker_no_access">("worker_no_access");
  const [newWorkerSystemAccess, setNewWorkerSystemAccess] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [categoryOther, setCategoryOther] = useState("");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(getTodayDate());
  const [clockIn, setClockIn] = useState(nowLocalDateTime(-60));
  const [clockOut, setClockOut] = useState(nowLocalDateTime());
  const [sessionUserId, setSessionUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [billedToCustomer, setBilledToCustomer] = useState(false);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<FinancialAttachment[]>([]);
  const [laborCost, setLaborCost] = useState("");
  const [laborCostTouched, setLaborCostTouched] = useState(false);
  const [sessionBillableToCustomer, setSessionBillableToCustomer] = useState(false);
  const [billToCustomerAmount, setBillToCustomerAmount] = useState("");
  const [billToCustomerAmountTouched, setBillToCustomerAmountTouched] = useState(false);
  const finalCategory =
    category === OTHER_PROJECT_EXPENSE_CATEGORY ? categoryOther.trim() : category.trim();
  const isSessionMode = isEditingSession || (!isEditing && finalCategory === EMPLOYEE_WAGE_CATEGORY);
  const movedAmountToNotesRef = useRef(false);
  const laborCostNumber = Number(laborCost);
  const billToCustomerAmountNumber = Number(billToCustomerAmount);
  const canSubmit =
    Boolean(finalCategory) &&
    (isSessionMode
      ? Boolean(clockIn) &&
        Boolean(clockOut) &&
        Boolean(sessionUserId) &&
        Number.isFinite(laborCostNumber) &&
        laborCostNumber > 0 &&
        (!sessionBillableToCustomer ||
          (Number.isFinite(billToCustomerAmountNumber) && billToCustomerAmountNumber > 0)) &&
        Boolean(toIsoDateTime(clockIn)) &&
        Boolean(toIsoDateTime(clockOut)) &&
        new Date(toIsoDateTime(clockOut)) > new Date(toIsoDateTime(clockIn))
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
    ? !laborCost.trim()
      ? "שדה חובה"
      : !Number.isFinite(laborCostNumber)
        ? "חייב להיות מספר"
        : laborCostNumber <= 0
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
    return missing.length > 0
      ? `\u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05de\u05d5\u05e8: ${missing.join(", ")}`
      : "";
  })();

  const durationHours = (() => {
    const clockInIso = toIsoDateTime(clockIn);
    const clockOutIso = toIsoDateTime(clockOut);
    if (!clockInIso || !clockOutIso) return "";
    const minutes = Math.round((new Date(clockOutIso).getTime() - new Date(clockInIso).getTime()) / 60000);
    return minutes > 0 ? String(Number((minutes / 60).toFixed(2))) : "";
  })();

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
    setExpenseDate(getString(editingExpense, "expense_date") ?? getTodayDate());
    setClockIn(isEditingSession ? toLocalDateTimeValue(editingSession?.clock_in) : nowLocalDateTime(-60));
    setClockOut(isEditingSession ? toLocalDateTimeValue(editingSession?.clock_out) : nowLocalDateTime());
    setSessionUsers(users);
    setSessionUserId(isEditingSession ? editingSession?.user_id ?? "" : users[0]?.id ?? "");
    setNewWorkerOpen(false);
    setNewWorkerSubmitting(false);
    setNewWorkerName("");
    setNewWorkerEmail("");
    setNewWorkerPhone("");
    setNewWorkerPassword("");
    setNewWorkerRole("worker_no_access");
    setNewWorkerSystemAccess(false);
    setNotes(isEditingSession ? editingSession?.notes ?? "" : getString(editingExpense, "notes") ?? "");
    setBilledToCustomer(Boolean(editingItem?.project_expense?.["billed_to_customer"]));
    setAttachmentFiles([]);
    setExistingAttachments(Array.isArray(editingExpense?.attachments) ? (editingExpense.attachments as FinancialAttachment[]) : []);
    setLaborCost(
      isEditingSession && toNumber(editingSession?.labor_cost) !== null
        ? String(toNumber(editingSession?.labor_cost))
        : ""
    );
    setSessionBillableToCustomer(Boolean(editingSession?.is_billable_to_customer));
    setBillToCustomerAmount(
      isEditingSession && toNumber(editingSession?.bill_to_customer_amount) !== null
        ? String(toNumber(editingSession?.bill_to_customer_amount))
        : ""
    );
    movedAmountToNotesRef.current = false;
  }, [open, editingExpense, editingItem, projectType, users, isEditingSession, editingSession]);

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

  async function createWorker() {
    const name = newWorkerName.trim();
    const email = newWorkerEmail.trim();
    const phone = newWorkerPhone.trim();
    const password = newWorkerPassword;
    const requiresCredentials = newWorkerRole !== "worker_no_access" && newWorkerSystemAccess;
    if (!name || !phone) {
      toast.error("יש למלא שם וטלפון לעובד החדש");
      return;
    }
    if (requiresCredentials && (!email || !password)) {
      toast.error("יש למלא אימייל וסיסמה למשתמש עם גישה");
      return;
    }

    setNewWorkerSubmitting(true);
    try {
      const res = await fetch("/api/users/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          full_name: name,
          email: requiresCredentials ? email : null,
          phone: phone || null,
          password: requiresCredentials ? password : "",
          role: newWorkerRole,
          system_access: newWorkerRole === "worker_no_access" ? false : newWorkerSystemAccess,
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
      setNewWorkerEmail("");
      setNewWorkerPhone("");
      setNewWorkerPassword("");
      setNewWorkerRole("worker_no_access");
      setNewWorkerSystemAccess(false);
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
      if (!Number.isFinite(laborCostNumber) || laborCostNumber <= 0) return;
      if (
        sessionBillableToCustomer &&
        (!Number.isFinite(billToCustomerAmountNumber) || billToCustomerAmountNumber <= 0)
      ) {
        return;
      }
      if (new Date(clockOutIso) <= new Date(clockInIso)) return;

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
            labor_cost: laborCostNumber,
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

        toast.success(isEditingSession ? "המשמרת עודכנה" : "המשמרת נוספה");
        setAmount("");
        setCategory("");
        setCategoryOther("");
        setDescription("");
        setExpenseDate(getTodayDate());
        setClockIn(nowLocalDateTime(-60));
        setClockOut(nowLocalDateTime());
        setSessionUserId(sessionUsers[0]?.id ?? users[0]?.id ?? "");
        setNotes("");
        setBilledToCustomer(false);
        setAttachmentFiles([]);
        setExistingAttachments([]);
        setLaborCost("");
        setSessionBillableToCustomer(false);
        setBillToCustomerAmount("");
        onSaved({
          source_type: "session",
          project_expense: null,
          expense: null,
          session: savedSession,
        });
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
      setExpenseDate(getTodayDate());
      setNotes("");
      setBilledToCustomer(false);

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

      onSaved({
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
                  <select
                    value={newWorkerRole}
                    onChange={(e) => {
                      const nextRole = e.target.value as "worker" | "worker_no_access";
                      setNewWorkerRole(nextRole);
                      if (nextRole === "worker_no_access") {
                        setNewWorkerSystemAccess(false);
                      }
                    }}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="worker_no_access">עובד ללא גישה</option>
                    <option value="worker">עובד עם גישה</option>
                  </select>
                  <select
                    value={newWorkerSystemAccess ? "yes" : "no"}
                    onChange={(e) => setNewWorkerSystemAccess(e.target.value === "yes")}
                    disabled={newWorkerRole === "worker_no_access"}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="no">ללא גישה</option>
                    <option value="yes">עם גישה</option>
                  </select>
                  {newWorkerRole !== "worker_no_access" && newWorkerSystemAccess ? (
                    <>
                      <Input
                        type="email"
                        value={newWorkerEmail}
                        onChange={(e) => setNewWorkerEmail(e.target.value)}
                        placeholder="אימייל עובד"
                      />
                      <Input
                        type="password"
                        value={newWorkerPassword}
                        onChange={(e) => setNewWorkerPassword(e.target.value)}
                        placeholder="סיסמה לעובד"
                      />
                    </>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    {newWorkerRole === "worker_no_access" || !newWorkerSystemAccess
                      ? "פועל בלי גישה ייווצר רק כרשומת עובד לשיוך שעות בפרויקט, בלי חשבון התחברות."
                      : "עובד עם גישה ייווצר גם כחשבון התחברות וגם כרשומת עובד לשיוך שעות בפרויקט."}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void createWorker()}
                      disabled={
                        newWorkerSubmitting ||
                        !newWorkerName.trim() ||
                        !newWorkerPhone.trim() ||
                        ((newWorkerRole !== "worker_no_access" && newWorkerSystemAccess) &&
                          (!newWorkerEmail.trim() || !newWorkerPassword))
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
                        setNewWorkerEmail("");
                        setNewWorkerPhone("");
                        setNewWorkerPassword("");
                        setNewWorkerRole("worker_no_access");
                        setNewWorkerSystemAccess(false);
                      }}
                    >
                      ביטול
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <AdaptiveGrid variant="formTwo">
            {isSessionMode ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">שעת התחלה *</div>
                <Input
                  type="datetime-local"
                  value={clockIn}
                  onChange={(e) => {
                    setClockIn(e.target.value);
                    setClockInTouched(true);
                  }}
                  onBlur={() => setClockInTouched(true)}
                  aria-invalid={showClockInError}
                  className={showClockInError ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {showClockInError ? (
                  <div className="text-xs text-destructive">{clockInError}</div>
                ) : null}
              </div>
            ) : (
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
                  placeholder={"\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: 250"}
                  aria-invalid={showAmountError}
                  className={
                    showAmountError
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }
                />
                {showAmountError ? (
                  <div className="text-xs text-destructive">{amountError}</div>
                ) : null}
              </div>
            )}
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

          <AdaptiveGrid variant="formTwo">
            {isSessionMode ? (
              <>
                <div className="space-y-1">
                  <div className="text-sm font-medium">שעת סיום *</div>
                  <Input
                    type="datetime-local"
                    value={clockOut}
                    onChange={(e) => {
                      setClockOut(e.target.value);
                      setClockOutTouched(true);
                    }}
                    onBlur={() => setClockOutTouched(true)}
                    aria-invalid={showClockOutError}
                    className={showClockOutError ? "border-destructive focus-visible:ring-destructive" : ""}
                  />
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
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="text-sm font-medium">{"\u05ea\u05d0\u05e8\u05d9\u05da *"}</div>
                  <Input
                    type="date"
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
                <div />
              </>
            )}
          </AdaptiveGrid>

          {isSessionMode ? (
            <div className="space-y-3 rounded-lg border p-3">
              <AdaptiveGrid variant="formTwo">
                <div className="space-y-1">
                  <div className="text-sm font-medium">עלות עבודה *</div>
                  <Input
                    inputMode="numeric"
                    value={laborCost}
                    onChange={(e) => {
                      setLaborCost(e.target.value);
                      setLaborCostTouched(true);
                    }}
                    onBlur={() => setLaborCostTouched(true)}
                    placeholder="למשל 500"
                    aria-invalid={showLaborCostError}
                    className={showLaborCostError ? "border-destructive focus-visible:ring-destructive" : ""}
                  />
                  {showLaborCostError ? (
                    <div className="text-xs text-destructive">{laborCostError}</div>
                  ) : null}
                </div>
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2 pt-7">
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
                </div>
              </AdaptiveGrid>

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
            </div>
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

          {!isSessionMode ? (
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
          ) : null}

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
  editingPayment,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectType: string | null;
  editingPayment: PaymentRow | null;
  onSaved: (saved: PaymentRow) => void;
}) {
  const getTodayDate = () => new Date().toISOString().slice(0, 10);
  const isEditing = Boolean(editingPayment);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [paymentDateTouched, setPaymentDateTouched] = useState(false);
  const [paymentMethodTouched, setPaymentMethodTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(getTodayDate());
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
    setPaymentDate(editingPayment?.payment_date ?? getTodayDate());
    setPaymentMethod(editingPayment?.payment_method ?? "");
    setDueDate(editingPayment?.due_date ?? "");
    setRequiresSplit(Boolean(editingPayment?.requires_split));
    setReferenceNumber(editingPayment?.reference_number ?? "");
    setNotes(editingPayment?.notes ?? "");
    setAttachmentFiles([]);
    setExistingAttachments(Array.isArray(editingPayment?.attachments) ? editingPayment.attachments : []);
  }, [editingPayment, open]);

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
      setPaymentDate(getTodayDate());
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
              <Input
                type="date"
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
                  <Input
                    type="date"
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

