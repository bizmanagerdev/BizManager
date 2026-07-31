"use client";
import { toHebrewError } from "@/lib/error-messages";

import type { AuditRecordInfo } from "@/lib/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { Button } from "@/components/ui/button";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { StatActionCard, collectionStatusTextClass } from "@/components/ui/stat-action-card";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HandCoins,
  Upload,
  BarChart3,
  FileText,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { ClientOnly } from "@/components/ClientOnly";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { resyncAlerts } from "@/lib/ui/alerts-refresh";
import { toast } from "sonner";
import {
  paymentMethodLabel,
  splitPaymentAmounts,
  collectionStatusLabel,
} from "@/lib/orders/paymentStatus";
import { computeSourceCollection } from "@/lib/collections";
import { paymentTermsLabel } from "@/lib/paymentTerms";
import { applyProjectVatToBase } from "@/lib/projects/vat";
import { offlineFetch } from "@/lib/offline-queue";
import { offlineUpload } from "@/lib/offline-upload";
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
import BilledCustomerPrintButton from "./BilledCustomerPrintButton";
import ProjectMovements, { type Movement } from "./ProjectMovements";
import type { MorningLocalDocument } from "@/lib/morning/types";
import dynamic from "next/dynamic";
import {
  customerPaymentStatusLabel,
  deriveCustomerPaymentStatus,
  expenseItemTitle,
  expenseRecordedByLabel,
  formatDate,
  formatDateTime,
  formatIls,
  getFirstDate,
  getFirstString,
  getString,
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
// The compact tasks panel — the side column shows what's left on this project;
// the full board lives on /tasks.
const ProjectTasksMini = dynamic(() => import("./ProjectTasksMini"), { ssr: false });

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
  origin_address: string | null;
  origin_floor: string | null;
  origin_has_elevator: boolean | null;
  destination_address: string | null;
  destination_floor: string | null;
  destination_has_elevator: boolean | null;
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

// Tab bar sizing. On phones each tab takes an equal slice of the width, drops
// its icon and stacks its counter under the label; from md up it goes back to
// the natural-width icon + label + inline badge row.
// justify-start (the vertical axis once the trigger is flex-col) + items-stretch
// on the list keeps every label on the same line whether or not the tab carries
// a counter under it — otherwise the counter-less tabs center themselves against

// ---------------------------------------------------------------------------
// Money-row building blocks — shared by the הכנסות and הוצאות lists so both read
// the same: title + amount + icon actions on one line, every remaining detail
// on a single "·"-separated meta strip below it.
// ---------------------------------------------------------------------------




type PendingProjectDeletion =
  | { kind: "expense"; item: ExpenseListItem }
  | { kind: "session"; item: ExpenseListItem }
  | { kind: "payment"; payment: PaymentRow };

export default function ProjectTabsClient({
  viewerRole,
  overview,
  currentVatRate,
  paymentTerms,
  dueDate,
  financials,
  tasks,
  projectTasks,
  projectDocuments,
  projectDocumentsError,
  assignableUsers,
  expenses,
  expenseRecordedByNameByValue,
  expenseAuditById,
  payments,
  morningDocuments,
  morningDocumentsError,
  paymentRecordedByNameByValue,
  paymentAuditById,
  workerBalance,
  salaryAgreements,
  monthlySalaryItems,
  customerCard,
  detailsCard,
  statusCard,
  remindersSection,
  activitySection,
  moneyError,
}: {
  viewerRole: string | null;
  overview: ProjectOverview;
  currentVatRate: number;
  paymentTerms: string | null;
  dueDate: string | null;
  financials: ProjectFinancials;
  tasks: ProjectTaskProgress;
  projectTasks: Record<string, unknown>[];
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
  expenses: ExpenseListItem[];
  expenseRecordedByNameByValue: Record<string, string>;
  expenseAuditById: Record<string, AuditRecordInfo>;
  payments: PaymentRow[];
  morningDocuments: MorningLocalDocument[];
  morningDocumentsError: string | null;
  paymentRecordedByNameByValue: Record<string, string>;
  paymentAuditById: Record<string, AuditRecordInfo>;
  workerBalance: ProjectWorkerBalance;
  salaryAgreements: ProjectSalaryAgreement[];
  monthlySalaryItems: ProjectMonthlySalaryItem[];
  /** The customer card — the fourth card in the desktop KPI row. */
  customerCard?: ReactNode;
  /** The פרטים card — beside the customer at the top of the desktop layout. */
  detailsCard?: ReactNode;
  /** Third head-row card for projects that have no route/load card. */
  statusCard?: ReactNode;
  /** Anything that went wrong loading the money rows. */
  moneyError?: string | null;
  /** תזכורות — rendered in the side column, under the financial summary. */
  remindersSection?: ReactNode;
  /** היסטוריית פעילות — under תזכורות in the same column. */
  activitySection?: ReactNode;
}) {
  const router = useRouter();
  // Top bar: "פרויקט" over the project's name. The name goes on the SUBTITLE
  // line, which has room for it — as the title it came out clipped ("תובל
  // אחזקה 6…") in the bar's single fixed-height row.
  useSetPageTitle("פרויקט", overview.name);
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
  const [docsFilterCategory] = useState<string>("");
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
  const [, setPendingDocsStuck] = useState(false);
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

  // Office/workers don't see the money sections at all — in projects they see
  // status, not numbers.
  const canSeeFinances = viewerRole === "admin";

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
      let uploaded = 0;
      for (let i = 0; i < total; i++) {
        const file = fileList[i]!;
        const fields: Record<string, string> = { project_id: overview.id };
        if (category.trim()) fields.category = category.trim();

        toast.loading(`מעלה קבצים... (${i + 1}/${total})`, { id: toastId });

        const result = await offlineUpload("/api/projects/documents/upload", {
          fields,
          file,
          label: file.name,
        });

        if (result.queued) {
          // Saved on the device — replays when the connection returns
          // (ConnectionToasts announces it). No document id to wait for yet.
          setPendingDocUploads((prev) =>
            prev.map((p) => (p.name === file.name ? { ...p, status: "done" } : p))
          );
          continue;
        }

        if (!result.ok) {
          toast.error("שגיאה בהעלאת קובץ", { id: toastId, description: result.error });
          setPendingDocsRefresh(false);
          setPendingDocsStuck(false);
          setPendingDocUploads((prev) =>
            prev.map((p) => (p.name === file.name ? { ...p, status: "error" } : p))
          );
          docsToastIdRef.current = null;
          return;
        }

        uploaded += 1;
        const data = result.data as { document?: { id?: unknown } } | null;
        setPendingDocUploads((prev) =>
          prev.map((p) =>
            p.name === file.name
              ? {
                  ...p,
                  status: "done",
                  documentId:
                    typeof data?.document?.id === "string" ? (data.document.id as string) : null,
                }
              : p
          )
        );
      }

      if (uploaded > 0) {
        // Wait for the newly-uploaded docs to appear in the refreshed list.
        toast.loading("העלאה הושלמה — מעדכן רשימה...", { id: toastId });
        setPendingDocsRefresh(true);
      } else {
        // Everything was queued for later — nothing to wait for in the list.
        toast.dismiss(toastId);
        docsToastIdRef.current = null;
        setPendingDocUploads([]);
      }
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
  const _openTasks =
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

  // Compact print rows for the "לחיוב לקוח" card — date, label and the amount
  // charged to the customer only.
  const billedPrintRows = useMemo(
    () =>
      billableCustomerItems.map((item) => {
        const session = item.source_type === "session" ? item.session : null;
        const date = session
          ? session.clock_in
          : getString(item.expense, "expense_date") ??
            getString(item.expense, "created_at") ??
            null;
        return {
          date: formatDate(date),
          title: expenseItemTitle(item, usersById),
          amount: session
            ? sessionBillToCustomerAmount(session)
            : toNumber(item.expense?.amount),
        };
      }),
    [billableCustomerItems, usersById]
  );

  // Monthly-salary (payslip) costs attributed to this project, newest month first.
  const monthlySalaryRows = useMemo(() => {
    // A monthly salary isn't spent on the 1st of the month it covers — it's paid
    // after it, on the day the worker's agreement says (`due_day_of_next_month`,
    // 9th by convention). Dating it by the period start dropped it to the bottom
    // of the ledger, weeks before the money left.
    const payDayByUser = new Map<string, number>();
    for (const agreement of salaryAgreements) {
      const day = toNumber(agreement.due_day_of_next_month);
      if (agreement.user_id && day && day >= 1 && day <= 31) {
        payDayByUser.set(agreement.user_id, day);
      }
    }

    return [...monthlySalaryItems]
      .map((item) => {
        const user = item.user_id ? usersById.get(item.user_id) : null;
        const earned = toNumber(item.earned_amount) ?? 0;
        const paid = toNumber(item.paid_amount) ?? 0;
        const payDay = (item.user_id ? payDayByUser.get(item.user_id) : null) ?? 9;
        let payDate: string | null = null;
        if (item.period_month) {
          const [year, month] = item.period_month.split("-").map(Number);
          if (year && month) {
            const next = new Date(Date.UTC(year, month, 1));
            const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
            next.setUTCDate(Math.min(payDay, lastDay));
            payDate = next.toISOString().slice(0, 10);
          }
        }
        return {
          payslipId: item.payslip_id,
          workerName: user?.full_name?.trim() || user?.email || "עובד",
          periodMonth: item.period_month,
          payDate,
          paymentStatus:
            item.payment_status ??
            (earned > 0 && paid + 0.009 >= earned ? "paid" : paid > 0 ? "partial" : "not_paid"),
          earned,
          paid,
          owed: toNumber(item.owed_amount) ?? 0,
        };
      })
      .filter((row) => row.earned > 0)
      .sort((a, b) => (b.periodMonth ?? "").localeCompare(a.periodMonth ?? ""));
  }, [monthlySalaryItems, usersById, salaryAgreements]);


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


  // ——— Desktop tables ———————————————————————————————————————————————
  // The card rows are right for a phone and wasteful on a 1500px screen: ~110px
  // a row means twelve expenses scroll forever. Same data, ~40px a line.






  // Share of the price that stays with the business — the headline the desktop
  // KPI row leads with.
  const grossProfitPct =
    grossProfit !== null && displayedCustomerPrice !== null && displayedCustomerPrice > 0
      ? Math.round((grossProfit / displayedCustomerPrice) * 100)
      : null;
  const outstandingBalance =
    displayedCustomerPrice === null ? null : Math.max(displayedCustomerPrice - paymentsTotal, 0);

  // Rendered twice on purpose: in the כספים tab on phones, and in the desktop
  // side column. Two cheap instances beat threading open/close state around.
  // The money at a glance: what the project earns, and the four numbers that
  // make it. Headline first, breakdown under it — the same shape an order's
  // payment card uses.
  const financialSummarySection = (
    <section className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BarChart3 className="h-4 w-4 text-primary" />
        סיכום כספי
      </div>

      {/* Line after line, the way the money actually builds up: base → what was
          re-charged → the resulting price → what it cost. */}
      <dl className="mt-3 divide-y text-sm">
        <div className="flex items-center justify-between gap-3 py-2">
          <dt className="text-muted-foreground">מחיר בסיס שסוכם</dt>
          <dd className="flex items-center gap-2 font-semibold">
            <LtrInline>{formatIls(displayedBasePrice)}</LtrInline>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setUpdateBasePriceOpen(true)}
            >
              עדכון
            </Button>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-2">
          <dt className="text-muted-foreground">חיובים ללקוח</dt>
          <dd className="font-semibold">
            <LtrInline>{formatIls(billedExpensesTotal)}</LtrInline>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-2">
          <dt className="text-muted-foreground">מחיר בפועל</dt>
          <dd className="font-semibold">
            <LtrInline>{formatIls(displayedCustomerPrice)}</LtrInline>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-2">
          <dt className="text-muted-foreground">הוצאות</dt>
          <dd className="font-semibold">
            <LtrInline>{formatIls(totalExpenses)}</LtrInline>
          </dd>
        </div>
        {viewerRole === "admin" ? (
          <div className="flex items-center justify-between gap-3 border-t-2 border-foreground/70 py-2.5">
            <dt className="font-semibold">
              רווח גולמי
              {grossProfitPct !== null ? (
                <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                  {grossProfitPct}% מהמחיר בפועל
                </span>
              ) : null}
            </dt>
            <dd
              className={
                "text-base font-semibold " +
                (grossProfit !== null && grossProfit < 0 ? "text-destructive" : "text-success")
              }
            >
              <LtrInline>{formatIls(grossProfit)}</LtrInline>
            </dd>
          </div>
        ) : null}
      </dl>

      {totalWorkerOwed > 0.009 ? (
        <div className="mt-3 rounded-2xl border border-warning/40 bg-warning-soft/60 px-3 py-2 text-xs text-warning-soft-foreground">
          <span>יתרה לעובדים </span>
          <LtrInline>{formatIls(totalWorkerOwed)}</LtrInline>
          <span> · שולם </span>
          <LtrInline>{formatIls(totalWorkerPaid)}</LtrInline>
        </div>
      ) : null}

      {vatCollectedTotal > 0.009 ? (
        <div className="mt-2 text-xs text-muted-foreground">
          <span>סה״כ התקבל בפועל </span>
          <LtrInline>{formatIls(grossReceivedTotal)}</LtrInline>
          <span> · מע״מ שנגבה </span>
          <LtrInline>{formatIls(vatCollectedTotal)}</LtrInline>
        </div>
      ) : null}
    </section>
  );

  // The collection band: beside the customer card when the project has no
  // details worth a card of its own, otherwise on its own row under them.
  // Rendered on phones too (above the details cards), so both breakpoints state
  // the collection the same way. Neutral border — the warning tint on the icon
  // is enough of a flag without ringing the whole card in orange.
  // Always present, paid or not — the project's money situation is one of the
  // things you come to this page for, so it gets a card that states it either
  // way (mirrors the order page's תשלום card, same component).
  const settled = overview.no_charge === true || outstandingBalance === null || outstandingBalance <= 0.009;
  const collectionStatusValue = collectionStatus ?? null;

  const collectionBand = (
    <StatActionCard
      icon={<HandCoins className="h-5 w-5" />}
      label="תשלום"
      value={
        overview.no_charge === true
          ? "ללא חיוב"
          : settled
            ? "שולם"
            : formatIls(outstandingBalance)
      }
      valueClassName={
        overview.no_charge === true
          ? "text-muted-foreground"
          : settled
            ? "text-success-soft-foreground"
            : "text-primary"
      }
      badges={
        overview.no_charge === true ? null : (
          <span
            className={
              "text-xs font-semibold " +
              (collectionStatusValue
                ? collectionStatusTextClass(collectionStatusValue)
                : "text-muted-foreground")
            }
          >
            {collectionStatusValue
              ? collectionStatusLabel(collectionStatusValue)
              : customerPaymentStatusLabel(customerPaymentStatus)}
          </span>
        )
      }
      details={
        overview.no_charge === true
          ? [{ label: "תנאי תשלום", value: paymentTermsLabel(paymentTerms) }]
          : [
              {
                label: "נגבה",
                value: (
                  <span className="whitespace-nowrap">
                    <LtrInline>{formatIls(paymentsTotal)}</LtrInline> מתוך{" "}
                    <LtrInline>{formatIls(displayedCustomerPrice)}</LtrInline>
                  </span>
                ),
              },
              { label: "תשלומים", value: String(paymentsUi.length) },
              ...(paymentSplit.pending > 0.009
                ? [
                    {
                      label: "צפוי לגבייה",
                      value: (
                        <span className="whitespace-nowrap">
                          <LtrInline>{formatIls(paymentSplit.pending)}</LtrInline>
                          {paymentSplit.overdue > 0.009 ? (
                            <span className="ms-1 text-destructive">
                              (<LtrInline>{formatIls(paymentSplit.overdue)}</LtrInline> באיחור)
                            </span>
                          ) : null}
                        </span>
                      ),
                    },
                  ]
                : []),
              {
                label: "תנאי תשלום",
                value: (
                  <span className="whitespace-nowrap">
                    {paymentTermsLabel(paymentTerms)}
                    {dueDate ? <> · פירעון <LtrInline>{formatDate(dueDate)}</LtrInline></> : null}
                  </span>
                ),
              },
            ]
      }
      action={
        overview.no_charge === true ? null : (
          <Button
            type="button"
            size="sm"
            className="w-full"
            onClick={() => {
              setEditingPayment(null);
              setAddIncomeOpen(true);
            }}
          >
            רישום תשלום
          </Button>
        )
      }
    />
  );

  // Every money movement on the project, newest first: payments in, expenses and
  // wages out. Each row keeps its own edit/delete, and everything that isn't one
  // of the six scannable columns goes into `extras`, behind the row's chevron.
  const movements = useMemo<Movement[]>(() => {
    const rows: Movement[] = [];

    for (const payment of paymentsUi) {
      const reference = payment.reference_number ?? "";
      const method = paymentMethodLabel(payment.payment_method);
      const extras: { label: string; value: string }[] = [];
      if (method && method !== "-") extras.push({ label: "אמצעי", value: method });
      if (reference) extras.push({ label: "אסמכתא", value: reference });
      if (payment.payment_method === "check" && payment.check_number) {
        extras.push({ label: "מס' צ'ק", value: String(payment.check_number) });
      }
      if (typeof payment.due_date === "string" && payment.due_date) {
        extras.push({ label: "פירעון", value: formatDate(payment.due_date) });
      }
      const paymentHint = method && method !== "-" ? method : payment.notes?.trim() || null;
      // The hint is already on the row — repeating it under the chevron is noise.
      if (payment.notes?.trim() && payment.notes.trim() !== paymentHint) {
        extras.push({ label: "הערות", value: payment.notes.trim() });
      }
      const recordedBy = paymentRecordedByLabel(payment, {
        paymentRecordedByNameByValue,
        paymentAuditById,
      });
      if (recordedBy) extras.push({ label: "נרשם", value: recordedBy });

      rows.push({
        key: `payment:${payment.id}`,
        direction: "in",
        date: payment.payment_date ?? payment.created_at ?? null,
        title: reference ? `הכנסה · אסמכתא ${reference}` : "הכנסה",
        status: typeof payment.payment_status === "string" ? payment.payment_status : null,
        billed: false,
        amount: toNumber(payment.amount_total),
        hint: paymentHint,
        extras,
        attachments: Array.isArray(payment.attachments) ? payment.attachments : [],
        busy: deletingPaymentId === payment.id,
        onEdit: () => {
          setEditingPayment(payment);
          setAddIncomeOpen(true);
        },
        onDelete: () => requestDeletePayment(payment),
      });
    }

    for (const item of expensesUi) {
      const session = item.source_type === "session" ? item.session : null;
      const expenseId = getString(item.project_expense, "expense_id");
      const billed = session
        ? isSessionBillable(session)
        : Boolean(item.project_expense?.["billed_to_customer"]);
      const extras: { label: string; value: string }[] = [];

      if (session) {
        const worker = usersById.get(session.user_id);
        if (
          shouldShowSessionHours(
            normalizePayrollWorkerType(worker?.payroll_worker_type, worker?.pay_tracking_mode)
          )
        ) {
          extras.push({ label: "כניסה", value: formatDateTime(session.clock_in) });
          extras.push({ label: "יציאה", value: formatDateTime(session.clock_out) });
          extras.push({ label: "משך", value: formatMinutes(sessionWorkedMinutes(session)) });
        }
        if (billed && sessionLaborCost(session) !== sessionBillToCustomerAmount(session)) {
          extras.push({ label: "עלות עבודה", value: formatIls(sessionLaborCost(session)) });
        }
      } else {
        const method = paymentMethodLabel(getString(item.expense, "payment_method"));
        if (method && method !== "-") extras.push({ label: "אמצעי", value: method });
        const category = getString(item.expense, "category");
        if (category) extras.push({ label: "קטגוריה", value: category });
        const paid = toNumber(item.expense?.paid_amount as string | number | null);
        if (item.expense?.payment_status === "partial" && paid) {
          extras.push({ label: "שולם", value: formatIls(paid) });
        }
        const recordedBy = expenseRecordedByLabel(item, {
          expenseRecordedByNameByValue,
          expenseAuditById,
        });
        if (recordedBy) extras.push({ label: "נרשם", value: recordedBy });
      }

      const amount = session
        ? billed
          ? sessionBillToCustomerAmount(session)
          : sessionLaborCost(session)
        : toNumber(item.expense?.amount);

      rows.push({
        key: session ? `session:${session.id}` : `expense:${expenseId ?? item.expense?.id}`,
        direction: "out",
        date: session
          ? session.clock_in
          : getString(item.expense, "expense_date") ?? getString(item.expense, "created_at") ?? null,
        title: expenseItemTitle(item, usersById),
        status: session
          ? sessionPaymentStatus(session)
          : String(item.expense?.payment_status ?? "not_paid"),
        billed,
        amount,
        hint: session
          ? session.notes?.trim() || null
          : getString(item.expense, "notes") ?? null,
        extras,
        attachments: session
          ? Array.isArray(session.attachments)
            ? session.attachments
            : []
          : Array.isArray(item.expense?.attachments)
            ? (item.expense.attachments as FinancialAttachment[])
            : [],
        busy: session ? deletingSessionId === session.id : deletingExpenseId === expenseId,
        onEdit: () => {
          setEditingExpense(item);
          setAddExpenseOpen(true);
        },
        onDelete: () => (session ? requestDeleteSession(item) : requestDeleteExpense(item)),
      });
    }

    // Payslip-attributed salary: money out, but not editable from here.
    for (const row of monthlySalaryRows) {
      rows.push({
        key: `payslip:${row.payslipId}`,
        direction: "out",
        date: row.payDate,
        title: `שכר — ${row.workerName}`,
        status: row.paymentStatus,
        billed: false,
        amount: row.earned,
        hint: "משכורת חודשית",
        extras: [
          { label: "חודש", value: row.periodMonth ?? "—" },
          ...(row.paid > 0.009 ? [{ label: "שולם", value: formatIls(row.paid) }] : []),
          ...(row.owed > 0.009 ? [{ label: "יתרה", value: formatIls(row.owed) }] : []),
        ],
        attachments: [],
      });
    }

    // Oldest first: you read a statement down the month, and anything still to
    // come (a salary due next month) lands at the end on its own.
    return rows.sort((a, b) => {
      const at = a.date ? new Date(a.date).getTime() : 0;
      const bt = b.date ? new Date(b.date).getTime() : 0;
      return at - bt;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    paymentsUi,
    expensesUi,
    monthlySalaryRows,
    usersById,
    deletingPaymentId,
    deletingExpenseId,
    deletingSessionId,
  ]);

  // The ledger's own actions. Declared once and placed twice: in the section
  // header where there's width, and as a row above the list on a phone.
  const movementActions = (
    <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => {
                    setEditingExpense(null);
                    setAddExpenseOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  הוצאה
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => {
                    setEditingPayment(null);
                    setAddIncomeOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  הכנסה
                </Button>
                {billableCustomerItems.length > 0 ? (
                  <BilledCustomerPrintButton
                    data={{
                      projectName: overview.name,
                      customerName: overview.customer_name ?? null,
                      rows: billedPrintRows,
                      total: billedExpensesTotal,
                    }}
                  />
                ) : null}
    </>
  );

  return (
    <ClientOnly
      fallback={<div className="text-muted-foreground text-base">טוען…</div>}
    >
      {/* Head row, like the order page's stat row: who the project is for, where
          its money stands, and what the job actually is. The third card only
          exists when there's a route / items / notes to show — without it the
          row is two cards, not two-thirds of three. On a phone the customer is
          dropped here; the header above already leads with it. */}
      {/* Order: the job, who it's for, then the money. No items-start — the
          three stretch to a shared height, and each card pins its action to the
          bottom. On xl הובלה takes the wider slot: it's the one card whose
          content (route + load + note) can use the room, and past ~26rem of its
          own width its container query puts the load beside the route. */}
      <div
        className={`mb-3 grid gap-3 ${
          detailsCard
            ? "lg:grid-cols-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]"
            : "lg:grid-cols-3"
        }`}
      >
        {/* DOM order is the desktop order (הובלה · לקוח · תשלום); on a phone the
            order flips to לקוח · הובלה · תשלום via CSS, so neither breakpoint
            needs a second copy of a card. */}
        {detailsCard ? <div className="order-2 lg:order-none">{detailsCard}</div> : null}
        {customerCard ? <div className="order-1 lg:order-none">{customerCard}</div> : null}
        {/* Without a route card this is the head row's third card at every
            width. With one, the head row is full on desktop — so the phone
            still gets the status card here, and desktop finds it in the side
            column under the money. */}
        {statusCard ? (
          <div className={detailsCard ? "order-4 lg:hidden" : "order-2 lg:order-none"}>
            {statusCard}
          </div>
        ) : null}
        {collectionBand ? <div className="order-3 lg:order-none">{collectionBand}</div> : null}
      </div>

      {/* The side column is sized to the LAST column of the head row above
          (same gap, same fractions), so the aside's edge lands exactly on the
          תשלום card's edge and the main column on the הובלה/לקוח pair. Fixed
          rem widths never lined up with the row's fr columns. */}
      <div
        className={`flex flex-col lg:grid lg:items-start lg:gap-3 lg:grid-cols-[minmax(0,1fr)_calc((100%_-_1.5rem)/3)] ${
          detailsCard ? "xl:grid-cols-[minmax(0,1fr)_calc((100%_-_1.5rem)/3.6)]" : ""
        }`}
      >
        {/* Side column on desktop; on phones it just falls under the tabs
            (order-2), so תזכורות keeps its place and stays a single instance. */}
        <div className="order-1 min-w-0 space-y-3 lg:order-none">

        {canSeeFinances ? (
          <>
        <div className="lg:hidden">{financialSummarySection}</div>

          <CollapsibleSection
            collapsible={false}
            title="תנועות"
            summary={
              <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-xs text-muted-foreground">
                {movements.length}
              </span>
            }
            contentClassName="flex max-h-[32rem] flex-col text-sm"
            action={<div className="hidden items-center gap-1.5 lg:flex">{movementActions}</div>}
          >
            {/* Phone: one row, three equal columns — these wrapped onto two
                lines as a flex row and read as a pile. */}
            <div className="mb-2 grid grid-flow-col auto-cols-fr items-center gap-1.5 lg:hidden [&>*]:w-full [&>*]:px-1">
              {movementActions}
            </div>
            {moneyError ? (
              <p className="mb-2 text-sm text-destructive">שגיאה בטעינת תנועות: {moneyError}</p>
            ) : null}
            <ProjectMovements movements={movements} />
          </CollapsibleSection>
          </>
        ) : null}

        <CollapsibleSection
          defaultOpen={totalTasks > 0}
          title="משימות"
          icon={<ListChecks className="h-4 w-4 text-primary" />}
          summary={
            totalTasks > 0 ? (
              <span className="text-muted-foreground">
                {completedTasks}/{totalTasks} · {completion}%
              </span>
            ) : (
              <span className="text-muted-foreground">אין משימות</span>
            )
          }
        >
          <ProjectTasksMini
            projectId={overview.id}
            projectType={overview.project_type}
            tasks={tasksSorted}
            users={assignableUsers}
            onChange={() => startTransition(() => router.refresh())}
          />
        </CollapsibleSection>
          {remindersSection}



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
        </div>

        <aside className="order-2 mt-3 space-y-3 lg:order-none lg:mt-0">
          {/* A הובלה already fills the head row, so its status card sits here,
              above the money. */}
          {statusCard && detailsCard ? <div className="hidden lg:block">{statusCard}</div> : null}
          {canSeeFinances ? (
            <div className="hidden lg:block">{financialSummarySection}</div>
          ) : null}
        <CollapsibleSection
          defaultOpen={projectDocuments.length > 0}
          title="מסמכים"
          icon={<FileText className="h-4 w-4 text-primary" />}
          summary={
            <span className="text-muted-foreground">{projectDocuments.length} קבצים</span>
          }
          contentClassName="text-sm space-y-3"
        >
          {projectDocumentsError ? (
            <div className="text-sm text-destructive">שגיאה בטעינת מסמכים: {projectDocumentsError}</div>
          ) : null}

          {filteredProjectDocuments.length === 0 ? (
            <p className="text-muted-foreground">אין מסמכים להצגה.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filteredProjectDocuments.map((d) => {
                const name = d.title ?? d.file_name ?? "קובץ";
                const isImage = /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(
                  d.file_name ?? ""
                );
                const extension = (d.file_name ?? "").split(".").pop();
                return (
                  <div
                    key={d.document_id}
                    className="overflow-hidden rounded-2xl border border-border/60 bg-card"
                  >
                    <a
                      href={d.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="relative flex h-20 items-center justify-center bg-muted/40"
                    >
                      {isImage && d.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.url} alt={name} className="h-20 w-full object-cover" />
                      ) : (
                        <FileText className="h-6 w-6 text-muted-foreground" />
                      )}
                      {extension ? (
                        <span className="absolute bottom-1 start-1 rounded bg-foreground/70 px-1 text-[0.625rem] uppercase text-white">
                          {extension}
                        </span>
                      ) : null}
                    </a>
                    <div className="space-y-1 p-2">
                      <div className="break-words text-xs font-medium">{name}</div>
                      <div className="text-[0.6875rem] text-muted-foreground">
                        <LtrInline>{d.uploaded_at ? formatDate(d.uploaded_at) : "—"}</LtrInline>
                      </div>
                      {d.document_type ? (
                        <span className="inline-block rounded-full border border-border/70 bg-background px-1.5 py-0 text-[0.625rem] text-muted-foreground">
                          {d.document_type}
                        </span>
                      ) : null}
                      <div className="flex gap-1 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="עריכת קטגוריה"
                          aria-label="עריכת קטגוריה"
                          onClick={() => openEditTag(d.document_id)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="מחיקת קובץ"
                          aria-label="מחיקת קובץ"
                          onClick={() => openDeleteDocument(d.document_id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full border-dashed"
            disabled={docsUploading}
            onClick={() => setUploadDocsOpen(true)}
          >
            <Upload className="h-4 w-4" />
            {docsUploading ? "מעלה..." : "העלאת קובץ או תמונה"}
          </Button>
        </CollapsibleSection>
          {activitySection}
        </aside>
      </div>
    </ClientOnly>
  );
}

function getErrorMessage(error: unknown) {
  return toHebrewError(error, "");
}
