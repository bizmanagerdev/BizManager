"use client";
import { toHebrewError } from "@/lib/error-messages";

import type { AuditRecordInfo } from "@/lib/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, ListChecks, Wallet } from "lucide-react";
import { ClientOnly } from "@/components/ClientOnly";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { resyncAlerts } from "@/lib/ui/alerts-refresh";
import { toast } from "sonner";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import {
  paymentMethodLabel,
  splitPaymentAmounts,
  collectionStatusClasses,
  collectionStatusLabel,
} from "@/lib/orders/paymentStatus";
import { computeSourceCollection } from "@/lib/collections";
import { paymentTermsLabel } from "@/lib/paymentTerms";
import { applyProjectVatToBase } from "@/lib/projects/vat";
import { offlineFetch } from "@/lib/offline-queue";
import {
  type PaymentRow,
  type FinancialAttachment,
} from "@/lib/payments";
import {
  formatMinutes,
  sessionWorkedMinutes,
  type SalaryAgreementRow,
  type WorkSessionRow,
} from "@/lib/payroll";
import {
  normalizePayrollWorkerType,
  shouldShowSessionHours,
  type PayrollWorkerType,
} from "@/lib/payroll-worker-type";
import type { ExpenseWorkerOption } from "@/components/expenses/ExpenseDialog";
import MorningDocumentsPanel from "@/components/morning/MorningDocumentsPanel";
import type { MorningLocalDocument } from "@/lib/morning/types";
import dynamic from "next/dynamic";
import {
  customerPaymentStatusBadgeClasses,
  customerPaymentStatusLabel,
  deriveCustomerPaymentStatus,
  expenseRecordedByLabel,
  formatDate,
  formatDateTime,
  formatIls,
  formatTimeOnly,
  getFirstDate,
  getFirstString,
  getString,
  isImageAttachment,
  isSameDay,
  isSessionBillable,
  LtrInline,
  paymentRecordedByLabel,
  sessionBillToCustomerAmount,
  sessionLaborCost,
  sessionPaymentStatus,
  toNumber,
} from "./ProjectTabsClient.helpers";

// Heavy financial-entry dialogs are lazy-loaded — their code only downloads when
// the user opens "add expense" / "add income", keeping the initial bundle smaller.
// The shared expense/session dialog — one dialog used across the app (financial,
// vehicles, dashboard, project). Replaces the old project-local AddExpenseDialog.
const ExpenseDialog = dynamic(
  () => import("@/components/expenses/ExpenseDialog").then((m) => m.ExpenseDialog),
  { ssr: false }
);
const AddIncomeDialog = dynamic(
  () => import("./ProjectExpenseDialogs").then((m) => m.AddIncomeDialog),
  { ssr: false }
);
// The tasks tab loads only when the user opens the משימות tab (Radix unmounts
// inactive tab content, so this chunk isn't fetched until then).
const ProjectTasksTab = dynamic(
  () => import("./ProjectTasksTab").then((m) => m.ProjectTasksTab),
  { ssr: false }
);

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
  price_includes_vat: boolean | null;
  no_charge: boolean | null;
  vat_rate: string | number | null;
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

// A monthly-salary (payslip) cost attributed to this project via the worker's
// salary agreement — shown as a read-only line in the project's expenses.
export type ProjectMonthlySalaryItem = {
  payslip_id: string;
  user_id: string | null;
  period_month: string | null;
  earned_amount: number | string | null;
  paid_amount: number | string | null;
  owed_amount: number | string | null;
  payment_status: string | null;
};

type PendingProjectDeletion =
  | { kind: "expense"; item: ExpenseListItem }
  | { kind: "session"; item: ExpenseListItem }
  | { kind: "payment"; payment: PaymentRow };

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
  currentVatRate,
  paymentTerms,
  dueDate,
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
  monthlySalaryItems,
}: {
  viewerRole: string | null;
  overview: ProjectOverview;
  currentVatRate: number;
  paymentTerms: string | null;
  dueDate: string | null;
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
  monthlySalaryItems: ProjectMonthlySalaryItem[];
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

  // Office/workers don't see the financial (כספים) tab at all — in projects they see status, not numbers.
  const canSeeFinances = viewerRole === "admin";
  const allowedTabs = new Set(canSeeFinances ? ["overview", "tasks", "documents"] : ["tasks", "documents"]);
  const defaultTab = canSeeFinances ? "overview" : "tasks";
  const rawTabFromUrl = searchParams.get("tab");
  const tabFromUrl = rawTabFromUrl === "financial" ? "overview" : rawTabFromUrl;
  const [tabValue, setTabValue] = useState(
    tabFromUrl && allowedTabs.has(tabFromUrl) ? tabFromUrl : defaultTab
  );

  useEffect(() => {
    // Sync state when the URL changes via navigation/back/forward.
    setTabValue(tabFromUrl && allowedTabs.has(tabFromUrl) ? tabFromUrl : defaultTab);
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
          toast.error("שגיאה בהעלאת קובץ", { id: toastId, description: toHebrewError(json?.error, "") });
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
        toast.error("שגיאה בעדכון תג", { description: toHebrewError(json?.error, "") });
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
        toast.error("שגיאה במחיקה", { description: toHebrewError(json?.error, "") });
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
  // Phase 2: when the project price includes VAT, the agreed base is grossed up
  // to the with-VAT target the customer actually pays.
  const projectVatMode = {
    priceIncludesVat: overview.price_includes_vat === true,
    vatRate: overview.vat_rate ?? currentVatRate,
  };
  const displayedBaseNet = agreedBasePriceUi ?? agreedBasePrice;
  const displayedBasePrice =
    displayedBaseNet === null ? null : applyProjectVatToBase(displayedBaseNet, projectVatMode);
  // Collection split: "שולם" reflects COLLECTED money only; pending (future-dated)
  // payments are expected, not paid — so the status can read תשלום צפוי / באיחור.
  // Counts toward the price use net_amount (VAT stripped from official payments).
  const paymentSplit = splitPaymentAmounts(
    paymentsUi.map((p) => ({
      amount_total: toNumber(p.amount_total) ?? 0,
      net_amount: toNumber(p.net_amount),
      payment_status: typeof p.payment_status === "string" ? p.payment_status : null,
      due_date: typeof p.due_date === "string" ? p.due_date : null,
    }))
  );
  const paymentsTotal = paymentSplit.collected;
  // Real cash that arrived (gross, incl. VAT) and VAT stripped from official
  // payments — shown alongside, for reconciliation and the tax bucket.
  const grossReceivedTotal = paymentsUi.reduce((sum, p) => {
    const status = typeof p.payment_status === "string" ? p.payment_status.toLowerCase() : "";
    if (status === "pending" || status === "rejected") return sum;
    return sum + (toNumber(p.amount_total) ?? 0);
  }, 0);
  const vatCollectedTotal = paymentsUi.reduce((sum, p) => {
    const status = typeof p.payment_status === "string" ? p.payment_status.toLowerCase() : "";
    if (status === "pending" || status === "rejected") return sum;
    const gross = toNumber(p.amount_total) ?? 0;
    const net = toNumber(p.net_amount);
    const vat = toNumber(p.vat_amount);
    return sum + (Number.isFinite(vat) ? (vat as number) : Number.isFinite(net) ? gross - (net as number) : 0);
  }, 0);
  // Expected price = agreed base (grossed up if price includes VAT) + billed charges.
  const expectedCustomerPrice =
    displayedBasePrice === null
      ? customerTotalPrice
      : displayedBasePrice + (billedExpensesTotal ?? 0);
  // מחיר בפועל = the HIGHER of the expected price vs the amount actually received,
  // so an overpayment shows as the real price (gross profit follows from the view).
  const displayedCustomerPrice =
    expectedCustomerPrice === null
      ? paymentsTotal > 0
        ? paymentsTotal
        : null
      : Math.max(expectedCustomerPrice, paymentsTotal);
  const customerPaymentStatus = deriveCustomerPaymentStatus(displayedCustomerPrice, paymentsTotal);
  const collectionStatus =
    displayedCustomerPrice === null
      ? null
      : computeSourceCollection({
          total: displayedCustomerPrice,
          collected: paymentSplit.collected,
          pending: paymentSplit.pending,
          overdue: paymentSplit.overdue,
          outstanding: Math.max(displayedCustomerPrice - paymentSplit.collected, 0),
          nextDueDate: null,
          referenceDate: typeof overview.start_date === "string" ? overview.start_date : null,
          dueDate,
          today: new Date().toISOString().slice(0, 10),
        }).status;
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

  // Monthly-salary (payslip) costs attributed to this project, newest month first.
  const monthlySalaryRows = useMemo(() => {
    return [...monthlySalaryItems]
      .map((item) => {
        const user = item.user_id ? usersById.get(item.user_id) : null;
        return {
          payslipId: item.payslip_id,
          workerName: user?.full_name?.trim() || user?.email || "עובד",
          periodMonth: item.period_month,
          earned: toNumber(item.earned_amount) ?? 0,
          paid: toNumber(item.paid_amount) ?? 0,
          owed: toNumber(item.owed_amount) ?? 0,
        };
      })
      .filter((row) => row.earned > 0)
      .sort((a, b) => (b.periodMonth ?? "").localeCompare(a.periodMonth ?? ""));
  }, [monthlySalaryItems, usersById]);
  const monthlySalaryTotal = monthlySalaryRows.reduce((sum, row) => sum + row.earned, 0);

  const cashFlow = (() => {
    const incomeEvents: CashFlowEvent[] = paymentsUi.map((p) => {
      const date = p.payment_date ?? p.created_at ?? null;
      const amount = toNumber(p.amount_total);
      const reference = p.reference_number ?? "";
      const method = paymentMethodLabel(p.payment_method);

      const meta: string[] = [];
      if (method && method !== "-") meta.push(method);
      if (reference) meta.push(`אסמכתא: ${reference}`);
      if (p.payment_method === "check" && p.check_number) {
        meta.push(`מס' צ'ק: ${p.check_number}`);
      }

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
      const result = await offlineFetch(
        "/api/expenses/delete",
        { id: expenseId, project_id: overview.id },
        "מחיקת חיוב"
      );
      if (!result.queued && !result.ok) {
        toast.error("שגיאה במחיקת ההוצאה", { description: toHebrewError(result.error, "") });
        return;
      }
      setExpensesUi((prev) =>
        prev.filter((row) => {
          const rowId = getString(row.project_expense, "expense_id") ?? getString(row.expense, "id");
          return rowId !== expenseId;
        })
      );
      if (!result.queued) toast.success("ההוצאה נמחקה");
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
      const result = await offlineFetch(
        isAdminViewer ? "/api/payroll/sessions/delete" : "/api/profile/session/delete",
        isAdminViewer ? { session_id: sessionId } : { session_id: sessionId, project_id: overview.id },
        "מחיקת משמרת"
      );
      if (!result.queued && !result.ok) {
        toast.error("שגיאה במחיקת המשמרת", { description: toHebrewError(result.error, "") });
        return;
      }

      setExpensesUi((prev) =>
        prev.filter((row) => !(row.source_type === "session" && row.session?.id === sessionId))
      );
      if (!result.queued) toast.success("המשמרת נמחקה");
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
      const result = await offlineFetch(
        "/api/payments/delete",
        { id: payment.id, project_id: overview.id },
        "מחיקת הכנסה"
      );
      if (!result.queued && !result.ok) {
        toast.error("שגיאה במחיקת ההכנסה", { description: toHebrewError(result.error, "") });
        return;
      }
      setPaymentsUi((prev) => prev.filter((row) => row.id !== payment.id));
      if (!result.queued) toast.success("ההכנסה נמחקה");
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
      const result = await offlineFetch(
        "/api/projects/update-agreed-base-price",
        { project_id: overview.id, agreed_base_price: next },
        "עדכון מחיר בסיס"
      );
      if (!result.queued && !result.ok) {
        toast.error("שגיאה בעדכון מחיר בסיס", { id: toastId, description: toHebrewError(result.error, "") });
        return;
      }
      const json = result.queued ? null : (result.data as { project?: { agreed_base_price?: unknown } } | null);
      const updatedBasePrice =
        json?.project && typeof json.project.agreed_base_price !== "undefined"
          ? toNumber(json.project.agreed_base_price)
          : result.queued
            ? next
            : null;

      setAgreedBasePriceUi(updatedBasePrice);
      if (!result.queued) toast.success("מחיר בסיס עודכן", { id: toastId });
      setUpdateBasePriceOpen(false);
      // Setting a price resolves the "closed unbilled" alert — resync now.
      void resyncAlerts();
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
        <TabsList variant="underline" className="sticky top-2 z-10 justify-center bg-background sm:top-4">
          {canSeeFinances ? (
            <TabsTrigger value="overview">
              <Wallet className="h-4 w-4" />
              כספים
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="tasks">
            <ListChecks className="h-4 w-4" />
            משימות
            <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px]">
              {completion}%
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="documents">
            <FileText className="h-4 w-4" />
            מסמכים
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
              {viewerRole === "admin" ? (
                <div className="rounded-xl border bg-background/60 p-3">
                  <div className="text-xs text-muted-foreground">רווח גולמי</div>
                  <div className={("mt-2 text-lg font-semibold " + (grossProfit !== null && grossProfit < 0 ? "text-destructive" : "")).trim()}>
                    <LtrInline>{formatIls(grossProfit)}</LtrInline>
                  </div>
                </div>
              ) : null}
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">יתרה לעובדים</div>
                <div className="mt-2 text-lg font-semibold">
                  <LtrInline>{formatIls(totalWorkerOwed)}</LtrInline>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  <span>שולם לעובדים </span>
                  <LtrInline>{formatIls(totalWorkerPaid)}</LtrInline>
                </div>
              </div>
              <div className="rounded-xl border bg-background/60 p-3">
                <div className="text-xs text-muted-foreground">סטטוס תשלום לקוח</div>
                <div className="mt-2">
                  {overview.no_charge === true ? (
                    <Badge className="border-info/30 bg-info-soft/40 text-info-soft-foreground">ללא חיוב</Badge>
                  ) : collectionStatus ? (
                    <Badge className={collectionStatusClasses(collectionStatus)}>
                      {collectionStatusLabel(collectionStatus)}
                    </Badge>
                  ) : (
                    <Badge className={customerPaymentStatusBadgeClasses(customerPaymentStatus)}>
                      {customerPaymentStatusLabel(customerPaymentStatus)}
                    </Badge>
                  )}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  <span>נגבה </span>
                  <LtrInline>{formatIls(paymentsTotal)}</LtrInline>
                  {remainingCustomerBalance !== null ? (
                    <>
                      <span> • נותר </span>
                      <LtrInline>{formatIls(remainingCustomerBalance)}</LtrInline>
                    </>
                  ) : null}
                </div>
                {vatCollectedTotal > 0.009 ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    <span>סה״כ התקבל בפועל </span>
                    <LtrInline>{formatIls(grossReceivedTotal)}</LtrInline>
                    <span> • מע״מ שנגבה </span>
                    <LtrInline>{formatIls(vatCollectedTotal)}</LtrInline>
                  </div>
                ) : null}
                <div className="mt-1 text-xs text-muted-foreground">
                  <span>צורת תשלום: {paymentTermsLabel(paymentTerms)}</span>
                  {dueDate ? <span> • פירעון: <LtrInline>{formatDate(dueDate)}</LtrInline></span> : null}
                </div>
              </div>
            </div>
            {expectedCustomerPrice !== null &&
            displayedCustomerPrice !== null &&
            displayedCustomerPrice > expectedCustomerPrice ? (
              <div className="text-xs text-muted-foreground">
                <span>מחיר בפועל עודכן לסכום שהתקבל מהלקוח: </span>
                <LtrInline>{formatIls(displayedCustomerPrice)}</LtrInline>
                <span>.</span>
              </div>
            ) : billedExpensesTotal > 0 ? (
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
                            {p.payment_method === "check" && p.check_number ? (
                              <span>מס&apos; צ&apos;ק: <LtrInline>{p.check_number}</LtrInline></span>
                            ) : null}
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
              ) : expensesUi.length === 0 && monthlySalaryRows.length === 0 ? (
                <div className="flex-1 text-muted-foreground">אין הוצאות להצגה.</div>
              ) : (
                <div className="flex-1 divide-y overflow-y-auto pl-1">
                  {sortedExpensesUi.map((item, idx) => renderExpenseRow(item, idx))}
                </div>
              )}

              {monthlySalaryRows.length > 0 ? (
                <div className="mt-3 space-y-1 border-t pt-3">
                  <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                    <span>משכורות חודשיות (שכר גלובלי)</span>
                    <LtrInline>{formatIls(monthlySalaryTotal)}</LtrInline>
                  </div>
                  {monthlySalaryRows.map((row) => (
                    <div key={row.payslipId} className="flex items-center gap-3 py-1 text-sm">
                      <span className="w-16 shrink-0 text-xs text-muted-foreground">
                        <LtrInline>{row.periodMonth ? `${row.periodMonth.slice(5)}/${row.periodMonth.slice(2, 4)}` : "—"}</LtrInline>
                      </span>
                      <span className="min-w-0 flex-1 truncate">שכר — {row.workerName}</span>
                      <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-destructive">
                        <LtrInline>{formatIls(row.earned)}</LtrInline>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

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
            <CurrencyInput
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
                {formatIls(Math.max(updateBasePriceNumber + (billedExpensesTotal ?? 0), paymentsTotal))}
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

      <ExpenseDialog
        open={addExpenseOpen}
        onOpenChange={(open) => {
          setAddExpenseOpen(open);
          if (!open) setEditingExpense(null);
        }}
        lockedProjectId={overview.id}
        projectStartDate={overview.start_date}
        defaultSessionClockIn={firstWorkerSessionDefaults.clockIn}
        defaultSessionClockOut={firstWorkerSessionDefaults.clockOut}
        showAttachments
        currentUserRole={(viewerRole ?? undefined) as ExpenseWorkerOption["role"]}
        users={assignableUsers
          .filter((user) => user.active !== false)
          .map((u): ExpenseWorkerOption => ({
            id: u.id,
            label: u.full_name?.trim() || u.email,
            role: (u.role ?? undefined) as ExpenseWorkerOption["role"],
            payroll_worker_type: u.payroll_worker_type,
            pay_tracking_mode: u.pay_tracking_mode,
          }))}
        salaryAgreements={salaryAgreements}
        editingSession={editingExpense?.source_type === "session" ? editingExpense.session : null}
        editingExpense={
          editingExpense?.source_type === "expense" && editingExpense.expense
            ? {
                id: getString(editingExpense.expense, "id") ?? "",
                amount: (editingExpense.expense["amount"] as number | string | null) ?? "",
                category: getString(editingExpense.expense, "category"),
                description: getString(editingExpense.expense, "description"),
                notes: getString(editingExpense.expense, "notes"),
                expense_date: getString(editingExpense.expense, "expense_date"),
                business_domain: getString(editingExpense.expense, "business_domain"),
                payment_status: getString(editingExpense.expense, "payment_status"),
                paid_amount: (editingExpense.expense["paid_amount"] as number | string | null) ?? null,
                payment_method: getString(editingExpense.expense, "payment_method"),
                account_id: getString(editingExpense.expense, "account_id"),
                project_id: overview.id,
                billed_to_customer: Boolean(editingExpense.project_expense?.["billed_to_customer"]),
                included_in_base_price: Boolean(editingExpense.project_expense?.["included_in_base_price"]),
                bill_to_customer_amount:
                  (editingExpense.project_expense?.["bill_to_customer_amount"] as number | string | null) ?? null,
                attachments: Array.isArray(editingExpense.expense["attachments"])
                  ? (editingExpense.expense["attachments"] as FinancialAttachment[])
                  : [],
              }
            : null
        }
        onSaved={async (data) => {
          const saved: ExpenseListItem =
            data.sourceType === "session"
              ? { source_type: "session", session: data.session ?? null, expense: null, project_expense: null }
              : {
                  source_type: "expense",
                  expense: (data.expense as Record<string, unknown>) ?? null,
                  project_expense: data.projectExpense ?? null,
                  session: null,
                };
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
        vatRate={projectVatMode.priceIncludesVat ? Number(overview.vat_rate ?? currentVatRate) : currentVatRate}
        priceIncludesVat={projectVatMode.priceIncludesVat}
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

function getErrorMessage(error: unknown) {
  return toHebrewError(error, "");
}
