"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BadgeProps } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { AdaptiveCell, AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
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
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";
import type { PaymentRow } from "@/lib/payments";
import {
  EXPENSE_BUSINESS_DOMAINS,
  mapProjectTypeToExpenseDomain,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";

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
  created_at: string;
  updated_at: string;
};

export type ProjectFinancials = {
  id: string;
  agreed_base_price: string | number | null;
  actual_price: string | number | null;
  total_expenses: string | number | null;
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
  project_expense: Record<string, unknown>;
  expense: Record<string, unknown> | null;
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
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL").format(date);
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

function taskStatusLabel(status: TaskStatus | string) {
  switch (status) {
    case "todo":
      return "לביצוע";
    case "in_progress":
      return "בתהליך";
    case "blocked":
      return "חסום";
    case "done":
      return "בוצע";
    case "cancelled":
      return "בוטל";
    default:
      return status;
  }
}

function taskPriorityLabel(priority: TaskPriority | string) {
  switch (priority) {
    case "low":
      return "נמוכה";
    case "medium":
      return "בינונית";
    case "high":
      return "גבוהה";
    case "urgent":
      return "דחופה";
    default:
      return priority;
  }
}

function priorityToBadgeVariant(
  priority: TaskPriority | string
): BadgeProps["variant"] {
  switch (priority) {
    case "low":
      return "secondary";
    case "medium":
      return "warning";
    case "high":
      return "destructive";
    case "urgent":
      return "destructive";
    default:
      return "outline";
  }
}

function statusToBadgeVariant(status: TaskStatus | string): BadgeProps["variant"] {
  switch (status) {
    case "done":
      return "success";
    case "in_progress":
      return "warning";
    case "blocked":
      return "destructive";
    case "cancelled":
      return "outline";
    case "todo":
      return "secondary";
    default:
      return "outline";
  }
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
  const [isPending, startTransition] = useTransition();
  const [docsUploading, setDocsUploading] = useState(false);
  const docsFileInputRef = useRef<HTMLInputElement | null>(null);
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

  const allowedTabs = new Set(["overview", "financial", "tasks", "documents"]);
  const tabFromUrl = searchParams.get("tab");
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
      if (docsFileInputRef.current) docsFileInputRef.current.value = "";
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
  const [updateActualPriceOpen, setUpdateActualPriceOpen] = useState(false);
  const [updateActualPriceSaving, setUpdateActualPriceSaving] = useState(false);
  const [updateActualPriceValue, setUpdateActualPriceValue] = useState<string>("");
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
  const [actualPriceUi, setActualPriceUi] = useState<number | null>(
    toNumber(financials?.actual_price ?? overview.actual_price) ?? null
  );

  useEffect(() => {
    setActualPriceUi(toNumber(financials?.actual_price ?? overview.actual_price) ?? null);
  }, [financials?.actual_price, overview.actual_price]);

  const effectiveActualPrice = actualPriceUi ?? agreedBasePrice;

  useEffect(() => {
    if (!updateActualPriceOpen) return;
    const v = actualPriceUi ?? agreedBasePrice;
    setUpdateActualPriceValue(v === null ? "" : String(v));
  }, [updateActualPriceOpen, actualPriceUi, agreedBasePrice]);

  const updateActualPriceNumber = Number(updateActualPriceValue);
  const updateActualPriceError =
    updateActualPriceValue.trim() === ""
      ? "שדה חובה"
      : !Number.isFinite(updateActualPriceNumber)
        ? "חייב להיות מספר"
        : updateActualPriceNumber <= 0
          ? "חייב להיות גדול מ-0"
          : null;
  const canSaveActualPrice = !updateActualPriceError;
  const totalExpenses = toNumber(financials?.total_expenses) ?? null;
  const grossProfit = toNumber(financials?.gross_profit) ?? null;

  const paymentsTotal = paymentsUi.reduce(
    (sum, p) => sum + (toNumber(p.amount_total) ?? 0),
    0
  );
  const expensesTotal = expensesUi.reduce((sum, item) => sum + (toNumber(item.expense?.amount) ?? 0), 0);
  const interimProfit = paymentsTotal - expensesTotal;
  const hasRecordedFinancialActivity = paymentsUi.length > 0 || expensesUi.length > 0;
  const effectiveDisplayedExpenses = hasRecordedFinancialActivity ? expensesTotal : totalExpenses;
  const effectiveDisplayedGrossProfit = hasRecordedFinancialActivity ? interimProfit : grossProfit;
  const summaryItems = [
    {
      label: "מחיר בפועל",
      value: formatIls(effectiveActualPrice),
      tone: "text-foreground",
      meta: agreedBasePrice !== null ? `מחיר בסיס: ${formatIls(agreedBasePrice)}` : undefined,
    },
    {
      label: "רווח גולמי",
      value: formatIls(effectiveDisplayedGrossProfit),
      tone:
        effectiveDisplayedGrossProfit !== null && effectiveDisplayedGrossProfit < 0
          ? "text-destructive"
          : "text-foreground",
      meta: hasRecordedFinancialActivity ? "מבוסס על פעילות שנרשמה" : "מבוסס על נתוני הפרויקט",
    },
    {
      label: "התקדמות משימות",
      value: `${completion}%`,
      tone: "text-foreground",
      meta: `${completedTasks}/${totalTasks} הושלמו`,
    },
    {
      label: "מסמכים",
      value: String(projectDocuments.length),
      tone: "text-foreground",
      meta: docsFilterCategory ? "מוצג לפי סינון פעיל" : "כל הקבצים המשויכים",
    },
  ] as const;

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

    const expenseEvents: CashFlowEvent[] = expensesUi.map((item, idx) => {
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

      const includedInBase = Boolean(item.project_expense["included_in_base_price"]);
      const billedToCustomer = Boolean(item.project_expense["billed_to_customer"]);

      const meta: string[] = [];
      if (includedInBase) meta.push("נכלל בבסיס");
      if (billedToCustomer) meta.push("חויב ללקוח");

      return {
        type: "expense",
        id: expenseId,
        date,
        amount,
        title,
        meta,
        includedInBase,
        billedToCustomer,
      };
    });

    const all = [...incomeEvents, ...expenseEvents];

    all.sort((a, b) => {
      const at = a.date ? new Date(a.date).getTime() : 0;
      const bt = b.date ? new Date(b.date).getTime() : 0;
      return bt - at;
    });

    return all;
  })();

  async function updateActualPrice(next: number | null) {
    setUpdateActualPriceSaving(true);
    const toastId = "update-actual-price";
    toast.loading("מעדכן מחיר בפועל...", { id: toastId });
    try {
      const res = await fetch("/api/projects/update-actual-price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: overview.id,
          actual_price: next,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה בעדכון מחיר בפועל", { id: toastId, description: json?.error ?? "" });
        return;
      }

      const updatedActual =
        json?.project && typeof json.project.actual_price !== "undefined"
          ? toNumber(json.project.actual_price)
          : null;

      setActualPriceUi(updatedActual);
      toast.success("מחיר בפועל עודכן", { id: toastId });
      setUpdateActualPriceOpen(false);
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      toast.error("שגיאה בעדכון מחיר בפועל", { id: toastId, description: getErrorMessage(e) });
    } finally {
      setUpdateActualPriceSaving(false);
    }
  }

  return (
    <ClientOnly
      fallback={<div className="text-muted-foreground text-base">טוען…</div>}
    >
      {isPending ? (
        <div className="mb-2 text-xs text-muted-foreground">מעדכן נתונים…</div>
      ) : null}
      <Tabs value={tabValue} onValueChange={setTab} dir="rtl">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryItems.map((item) => (
            <Card key={item.label} className="border-border/70 bg-background/80 shadow-sm">
              <CardContent className="p-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {item.label}
                </div>
                <div className={`mt-2 text-2xl font-semibold ${item.tone}`}>{item.value}</div>
                {item.meta ? (
                  <div className="mt-1 text-xs text-muted-foreground">{item.meta}</div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      <TabsList className="h-auto flex-wrap gap-2 overflow-visible border-none bg-transparent p-0 shadow-none [&>*]:min-w-[7.5rem] [&>*]:flex-1 sm:[&>*]:flex-none">
        <TabsTrigger value="overview">סקירה</TabsTrigger>
        <TabsTrigger value="financial">פיננסי</TabsTrigger>
        <TabsTrigger value="tasks">משימות</TabsTrigger>
        <TabsTrigger value="documents">מסמכים</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <AdaptiveGrid variant="projectOverview">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">מחירים</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">מחיר בסיס</span>
                <span>{formatIls(agreedBasePrice)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">מחיר בפועל</span>
                <span>{formatIls(effectiveActualPrice)}</span>
              </div>
              {actualPriceUi === null && agreedBasePrice !== null ? (
                <div className="text-xs text-muted-foreground">
                  ברירת מחדל: מחיר בפועל = מחיר בסיס
                </div>
              ) : null}
              <div className="pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setUpdateActualPriceOpen(true)}
                  disabled={agreedBasePrice === null && actualPriceUi === null}
                >
                  עדכון מחיר בפועל
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">פיננסים</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">הכנסות (בינתיים)</span>
                <span>{formatIls(paymentsTotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">הוצאות (בינתיים)</span>
                <span>{formatIls(expensesTotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">רווח לבינתיים</span>
                <span className={interimProfit < 0 ? "text-destructive" : ""}>
                  {formatIls(interimProfit)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">רווח גולמי (מחושב)</span>
                <span
                  className={
                    effectiveDisplayedGrossProfit !== null && effectiveDisplayedGrossProfit < 0
                      ? "text-destructive"
                      : ""
                  }
                >
                  {formatIls(effectiveDisplayedGrossProfit)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                מבוסס על הכנסות/הוצאות שנרשמו (לא בהכרח חופף לרווח הגולמי המחושב).
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">התקדמות</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">משימות פתוחות</span>
                <span>{openTasks}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">השלמה</span>
                <span>{completion}%</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">מנהל פרויקט</span>
                <span className="truncate">
                  {overview.project_manager_name ?? "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          <AdaptiveCell variant="projectOverviewWide">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">תאריכים</CardTitle>
            </CardHeader>
            <CardContent>
              <AdaptiveGrid variant="projectSummary" className="text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">תאריך התחלה</span>
                <span>{formatDate(overview.start_date)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">תאריך סיום</span>
                <span>{formatDate(overview.end_date)}</span>
              </div>
              </AdaptiveGrid>
            </CardContent>
          </Card>
          </AdaptiveCell>
        </AdaptiveGrid>
      </TabsContent>

      <TabsContent value="financial">
        <AdaptiveGrid variant="projectOverview">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">סיכום</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">מחיר בסיס שסוכם</span>
                <span>{formatIls(agreedBasePrice)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">מחיר בפועל</span>
                <span>{formatIls(effectiveActualPrice)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">הוצאות</span>
                <span>{formatIls(effectiveDisplayedExpenses)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">רווח גולמי</span>
                <span
                  className={
                    effectiveDisplayedGrossProfit !== null && effectiveDisplayedGrossProfit < 0
                      ? "text-destructive"
                      : ""
                  }
                >
                  {formatIls(effectiveDisplayedGrossProfit)}
                </span>
              </div>
              <div className="text-muted-foreground text-sm pt-2">
                שים לב: הוצאות “נכלל בבסיס” לא אמורות לייצר חיוב נוסף ללקוח.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">תזרים</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {cashFlow.length === 0 ? (
                <div className="text-muted-foreground">אין תנועות להצגה.</div>
              ) : (
                <div className="divide-y">
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
                              <span key={m}>{m}</span>
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

          <AdaptiveCell variant="projectOverviewWide">
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-base">הוצאות</CardTitle>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setAddExpenseOpen(true)}
              >
                הוספת הוצאה
              </Button>
            </CardHeader>
            <CardContent className="text-sm">
              {expensesError ? (
                <div className="text-destructive text-sm">
                  שגיאה בטעינת הוצאות: {expensesError}
                </div>
              ) : expensesUi.length === 0 ? (
                <div className="text-muted-foreground">אין הוצאות להצגה.</div>
              ) : (
                <div className="divide-y">
                  {expensesUi.map((item, idx) => {
                    const expenseId = getString(item.project_expense, "expense_id");
                    const amount = toNumber(item.expense?.amount);
                    const createdAt =
                      getString(item.expense, "expense_date") ??
                      getString(item.expense, "created_at") ??
                      null;

                    const title =
                      getString(item.expense, "description") ??
                      getString(item.expense, "vendor_name") ??
                      getString(item.expense, "vendor") ??
                      (expenseId ? `הוצאה ${expenseId.slice(0, 8)}` : "הוצאה");

                    const included = Boolean(item.project_expense["included_in_base_price"]);
                    const billed = Boolean(item.project_expense["billed_to_customer"]);

                    return (
                      <div key={expenseId ?? String(idx)} className="py-3 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{title}</div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            <span>{formatDate(createdAt)}</span>
                            {included ? <span>נכלל בבסיס</span> : <span>לא נכלל בבסיס</span>}
                            {billed ? <span>חויב ללקוח</span> : <span>לא חויב ללקוח</span>}
                          </div>
                        </div>
                        <div className="shrink-0 font-medium">
                          {amount === null ? "—" : formatIls(amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 pt-3 border-t flex items-center justify-between">
                <span className="text-muted-foreground">סה״כ הוצאות</span>
                <span className="font-medium">{formatIls(expensesTotal)}</span>
              </div>
            </CardContent>
          </Card>
          </AdaptiveCell>

          <AdaptiveCell variant="projectOverviewWide">
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-base">הכנסות</CardTitle>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setAddIncomeOpen(true)}
              >
                הוספת הכנסה
              </Button>
            </CardHeader>
            <CardContent className="text-sm">
              {paymentsError ? (
                <div className="text-destructive text-sm">
                  שגיאה בטעינת הכנסות: {paymentsError}
                </div>
              ) : paymentsUi.length === 0 ? (
                <div className="text-muted-foreground">אין הכנסות להצגה.</div>
              ) : (
                <div className="divide-y">
                  {paymentsUi.map((p) => {
                    const amount = toNumber(p.amount_total);
                    const date = p.payment_date ?? p.created_at ?? null;
                    const method = paymentMethodLabel(p.payment_method);
                    const reference = p.reference_number ?? "";

                    return (
                      <div key={p.id} className="py-3 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {reference ? `אסמכתא: ${reference}` : "הכנסה"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            <span>{formatDate(date)}</span>
                            <span>{method}</span>
                          </div>
                          {p.notes ? (
                            <div className="text-xs text-muted-foreground mt-1 truncate">
                              {p.notes}
                            </div>
                          ) : null}
                        </div>
                        <div className="shrink-0 font-medium">
                          {amount === null ? "—" : formatIls(amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 pt-3 border-t flex items-center justify-between">
                <span className="text-muted-foreground">סה״כ הכנסות</span>
                <span className="font-medium">{formatIls(paymentsTotal)}</span>
              </div>
            </CardContent>
          </Card>
          </AdaptiveCell>
        </AdaptiveGrid>
      </TabsContent>

      <TabsContent value="tasks">
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

      <TabsContent value="documents">
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
              <input
                ref={docsFileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"
                className="hidden"
                onChange={(e) => setUploadDocsFiles(Array.from(e.target.files ?? []))}
              />
              <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="secondary" onClick={() => docsFileInputRef.current?.click()}>
                  בחר קבצים
                </Button>
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
        open={updateActualPriceOpen}
        onOpenChange={(open) => {
          setUpdateActualPriceOpen(open);
          if (!open) setUpdateActualPriceValue("");
        }}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>עדכון מחיר בפועל</DialogTitle>
            <DialogDescription>
              אם לא עודכן מחיר בפועל, המערכת תציג את מחיר הבסיס כברירת מחדל.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="text-sm font-medium">מחיר בפועל *</div>
            <Input
              inputMode="numeric"
              value={updateActualPriceValue}
              onChange={(e) => setUpdateActualPriceValue(e.target.value)}
              placeholder="לדוגמה: 12000"
              aria-invalid={Boolean(updateActualPriceError)}
              className={
                updateActualPriceError
                  ? "border-destructive focus-visible:ring-destructive"
                  : ""
              }
            />
            {updateActualPriceError ? (
              <div className="text-xs text-destructive">{updateActualPriceError}</div>
            ) : null}
            {agreedBasePrice !== null ? (
              <div className="text-xs text-muted-foreground">
                מחיר בסיס: {formatIls(agreedBasePrice)}
              </div>
            ) : null}
          </div>

          <DialogFooter className="mt-4">
            {!canSaveActualPrice && !updateActualPriceSaving ? (
              <div className="me-auto text-xs text-destructive">
                לא ניתן לשמור: מחיר בפועל
              </div>
            ) : (
              <div className="me-auto" />
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setUpdateActualPriceOpen(false)}
              disabled={updateActualPriceSaving}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void updateActualPrice(null)}
              disabled={updateActualPriceSaving || agreedBasePrice === null}
            >
              איפוס למחיר בסיס
            </Button>
            <Button
              type="button"
              onClick={() => void updateActualPrice(updateActualPriceNumber)}
              disabled={updateActualPriceSaving || !canSaveActualPrice}
            >
              {updateActualPriceSaving ? "שומר..." : "שמירה"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <AddExpenseDialog
        open={addExpenseOpen}
        onOpenChange={setAddExpenseOpen}
        projectId={overview.id}
        projectType={overview.project_type}
        onCreated={(created) => {
          setExpensesUi((prev) => [created, ...prev]);
          setAddExpenseOpen(false);
          startTransition(() => router.refresh());
        }}
      />
      <AddIncomeDialog
        open={addIncomeOpen}
        onOpenChange={setAddIncomeOpen}
        projectId={overview.id}
        projectType={overview.project_type}
        onCreated={(created) => {
          setPaymentsUi((prev) => [created, ...prev]);
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
  const createFilesInputRef = useRef<HTMLInputElement | null>(null);

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
              <input
                ref={createFilesInputRef}
                type="file"
                multiple
                accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"
                className="hidden"
                onChange={(e) => setCreateFiles(Array.from(e.target.files ?? []))}
              />
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => createFilesInputRef.current?.click()}
                >
                  {createFiles.length > 0
                    ? "\u05E9\u05D9\u05E0\u05D5\u05D9 \u05E7\u05D1\u05E6\u05D9\u05DD"
                    : "\u05D1\u05D7\u05D9\u05E8\u05EA \u05E7\u05D1\u05E6\u05D9\u05DD"}
                </Button>
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
  const variant = statusToBadgeVariant(status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" disabled={disabled}>
          <Badge
            variant={variant}
            className="h-9 px-3 text-sm cursor-pointer select-none"
          >
            {taskStatusLabel(status)}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((opt) => (
          <DropdownMenuItem key={opt} onClick={() => onSelect(opt)}>
            <span className="me-2">
              <span
                className={
                  "inline-block h-2.5 w-2.5 rounded-full " +
                  (statusToBadgeVariant(opt) === "success"
                    ? "bg-success"
                    : statusToBadgeVariant(opt) === "warning"
                    ? "bg-warning"
                    : statusToBadgeVariant(opt) === "destructive"
                    ? "bg-destructive"
                    : statusToBadgeVariant(opt) === "secondary"
                    ? "bg-muted-foreground/40"
                    : "bg-border")
                }
              />
            </span>
            {taskStatusLabel(opt)}
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
  const variant = priorityToBadgeVariant(priority);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" disabled={disabled}>
          <Badge
            variant={variant}
            className="h-9 px-3 text-sm cursor-pointer select-none"
          >
            {taskPriorityLabel(priority)}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((opt) => (
          <DropdownMenuItem key={opt} onClick={() => onSelect(opt)}>
            <span className="me-2">
              <span
                className={
                  "inline-block h-2.5 w-2.5 rounded-full " +
                  (priorityToBadgeVariant(opt) === "destructive"
                    ? "bg-destructive"
                    : priorityToBadgeVariant(opt) === "warning"
                    ? "bg-warning"
                    : priorityToBadgeVariant(opt) === "secondary"
                    ? "bg-muted-foreground/40"
                    : "bg-border")
                }
              />
            </span>
            {taskPriorityLabel(opt)}
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

function projectTypeLabel(value: string) {
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

const expenseBusinessDomainLabels: Record<ExpenseBusinessDomain, string> = {
  home: "Home",
  charity: "Charity",
  general_business: "General",
  logistics_projects: "Logistics",
  sales: "Sales",
  property_management: "Property management",
};

function AddExpenseDialog({
  open,
  onOpenChange,
  projectId,
  projectType,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectType: string;
  onCreated: (created: ExpenseListItem) => void;
}) {
  const getTodayDate = () => new Date().toISOString().slice(0, 10);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [expenseDateTouched, setExpenseDateTouched] = useState(false);
  const [businessDomain, setBusinessDomain] = useState<ExpenseBusinessDomain>(
    mapProjectTypeToExpenseDomain(projectType)
  );
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(getTodayDate());
  const [notes, setNotes] = useState("");
  const [includedInBase, setIncludedInBase] = useState(false);
  const [billedToCustomer, setBilledToCustomer] = useState(false);
  const canSubmit =
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    Boolean(businessDomain) &&
    Boolean(category.trim()) &&
    Boolean(expenseDate);

  const amountNumber = Number(amount);
  const amountError =
    !amount.trim()
      ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4"
      : !Number.isFinite(amountNumber)
      ? "\u05d7\u05d9\u05d9\u05d1 \u05dc\u05d4\u05d9\u05d5\u05ea \u05de\u05e1\u05e4\u05e8"
      : amountNumber <= 0
      ? "\u05d7\u05d9\u05d9\u05d1 \u05dc\u05d4\u05d9\u05d5\u05ea \u05d2\u05d3\u05d5\u05dc \u05de-0"
      : null;
  const categoryError = !category.trim() ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4" : null;
  const expenseDateError = !expenseDate ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4" : null;
  const businessDomainError = !businessDomain ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4" : null;
  const showAmountError = (submitAttempted || amountTouched) && Boolean(amountError);
  const showCategoryError = (submitAttempted || categoryTouched) && Boolean(categoryError);
  const showExpenseDateError = (submitAttempted || expenseDateTouched) && Boolean(expenseDateError);
  const addExpenseValidationMessage = (() => {
    if (!submitAttempted || submitting || canSubmit) return "";
    const missing: string[] = [];
    if (amountError) missing.push("\u05e1\u05db\u05d5\u05dd");
    if (businessDomainError) missing.push("\u05ea\u05d7\u05d5\u05dd");
    if (categoryError) missing.push("\u05e4\u05d9\u05e8\u05d5\u05d8");
    if (expenseDateError) missing.push("\u05ea\u05d0\u05e8\u05d9\u05da");
    return missing.length > 0
      ? `\u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05de\u05d5\u05e8: ${missing.join(", ")}`
      : "";
  })();

  useEffect(() => {
    if (open) {
      setSubmitAttempted(false);
      setAmountTouched(false);
      setCategoryTouched(false);
      setExpenseDateTouched(false);
      setBusinessDomain(mapProjectTypeToExpenseDomain(projectType));
      setExpenseDate((prev) => prev || getTodayDate());
    }
  }, [open, projectType]);

  async function submit() {
    setSubmitAttempted(true);

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return;
    if (!businessDomain) return;
    if (!category.trim()) return;
    if (!expenseDate) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/expenses/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          business_domain: businessDomain,
          amount: amountNumber,
          category,
          description: description.trim() ? description : undefined,
          notes: notes.trim() ? notes : undefined,
          expense_date: expenseDate ? expenseDate : null,
          included_in_base_price: includedInBase,
          billed_to_customer: billedToCustomer,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error("\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05d5\u05e6\u05d0\u05d4", {
          description: json?.error ?? "",
        });
        return;
      }
      toast.success("\u05d4\u05d4\u05d5\u05e6\u05d0\u05d4 \u05e0\u05d5\u05e1\u05e4\u05d4");
      setAmount("");
      setCategory("");
      setDescription("");
      setBusinessDomain(mapProjectTypeToExpenseDomain(projectType));
      setExpenseDate(getTodayDate());
      setNotes("");
      setIncludedInBase(false);
      setBilledToCustomer(false);

      const createdExpense = json?.expense as Record<string, unknown> | undefined;
      const createdExpenseId =
        createdExpense && typeof createdExpense["id"] === "string"
          ? (createdExpense["id"] as string)
          : null;

      if (!createdExpenseId) {
        toast.error("\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05d5\u05e6\u05d0\u05d4", {
          description: "Missing expense id",
        });
        return;
      }

      onCreated({
        project_expense: {
          expense_id: createdExpenseId,
          included_in_base_price: includedInBase,
          billed_to_customer: billedToCustomer,
        },
        expense: createdExpense ?? null,
      });
    } catch (e: unknown) {
      toast.error("\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05d5\u05e6\u05d0\u05d4", {
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
          <DialogTitle>{"\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05d5\u05e6\u05d0\u05d4"}</DialogTitle>
          <DialogDescription>
            {"\u05d4\u05d4\u05d5\u05e6\u05d0\u05d4 \u05ea\u05e7\u05d5\u05e9\u05e8 \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05d5\u05ea\u05d5\u05e4\u05d9\u05e2 \u05d1\u05e4\u05d9\u05e0\u05e0\u05e1\u05d9."}
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
            {"\u05d4\u05d4\u05d5\u05e6\u05d0\u05d4 \u05ea\u05d9\u05e9\u05de\u05e8 \u05e2\u05dd \u05e9\u05d9\u05d5\u05da \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05d4\u05e0\u05d5\u05db\u05d7\u05d9. \u05e0\u05d9\u05ea\u05df \u05dc\u05d1\u05d7\u05d5\u05e8 \u05d0\u05ea \u05d4\u05ea\u05d7\u05d5\u05dd \u05d4\u05e2\u05e1\u05e7\u05d9 \u05d1\u05d0\u05d5\u05e4\u05df \u05d9\u05d3\u05e0\u05d9."}
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">{"\u05ea\u05d7\u05d5\u05dd \u05e2\u05e1\u05e7\u05d9 *"}</div>
            <select
              value={businessDomain}
              onChange={(e) => setBusinessDomain(e.target.value as ExpenseBusinessDomain)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                <option key={domain} value={domain}>
                  {expenseBusinessDomainLabels[domain]}
                </option>
              ))}
            </select>
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
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05e4\u05d9\u05e8\u05d5\u05d8 *"}</div>
              <Input
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setCategoryTouched(true);
                }}
                onBlur={() => setCategoryTouched(true)}
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
          </AdaptiveGrid>

          <div className="space-y-1">
            <div className="text-sm font-medium">{"\u05ea\u05d9\u05d0\u05d5\u05e8 (\u05d0\u05d5\u05e4\u05e6\u05d9\u05d5\u05e0\u05dc\u05d9)"}</div>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={"\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: \u05e0\u05e1\u05d9\u05e2\u05d4 \u05dc\u05d0\u05ea\u05e8"}
            />
          </div>

          <AdaptiveGrid variant="formTwo">
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
          </AdaptiveGrid>

          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includedInBase}
                onChange={(e) => setIncludedInBase(e.target.checked)}
              />
              <span>{"\u05e0\u05db\u05dc\u05dc \u05d1\u05d1\u05e1\u05d9\u05e1"}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={billedToCustomer}
                onChange={(e) => setBilledToCustomer(e.target.checked)}
              />
              <span>{"\u05dc\u05d7\u05d9\u05d5\u05d1 \u05dc\u05e7\u05d5\u05d7"}</span>
            </label>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">{"\u05d4\u05e2\u05e8\u05d5\u05ea (\u05d0\u05d5\u05e4\u05e6\u05d9\u05d5\u05e0\u05dc\u05d9)"}</div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={"\u05d4\u05e2\u05e8\u05d5\u05ea \u05e4\u05e0\u05d9\u05de\u05d9\u05d5\u05ea..."}
            />
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
              {submitting ? "\u05e9\u05d5\u05de\u05e8..." : "\u05e9\u05de\u05d9\u05e8\u05d4"}
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
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectType: string | null;
  onCreated: (created: PaymentRow) => void;
}) {
  const getTodayDate = () => new Date().toISOString().slice(0, 10);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [paymentDateTouched, setPaymentDateTouched] = useState(false);
  const [paymentMethodTouched, setPaymentMethodTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(getTodayDate());
  const [paymentMethod, setPaymentMethod] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const canSubmit =
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    Boolean(paymentDate) &&
    Boolean(paymentMethod.trim());

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
    return missing.length > 0
      ? `\u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05de\u05d5\u05e8: ${missing.join(", ")}`
      : "";
  })();

  useEffect(() => {
    if (open) {
      setSubmitAttempted(false);
      setAmountTouched(false);
      setPaymentDateTouched(false);
      setPaymentMethodTouched(false);
      setPaymentDate((prev) => prev || getTodayDate());
    }
  }, [open]);

  async function submit() {
    setSubmitAttempted(true);

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return;
    if (!paymentDate) return;
    if (!paymentMethod.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_domain: mapProjectTypeToExpenseDomain(projectType),
          project_id: projectId,
          amount_total: amountNumber,
          payment_date: paymentDate ? paymentDate : null,
          payment_method: paymentMethod.trim() ? paymentMethod : undefined,
          reference_number: referenceNumber.trim() ? referenceNumber : undefined,
          notes: notes.trim() ? notes : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error("\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05db\u05e0\u05e1\u05d4", {
          description: json?.error ?? "",
        });
        return;
      }
      const createdPayment = json?.payment as PaymentRow | undefined;
      const createdPaymentId =
        createdPayment && typeof createdPayment.id === "string" ? createdPayment.id : null;

      if (!createdPayment || !createdPaymentId) {
        toast.error("\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05db\u05e0\u05e1\u05d4", {
          description: "Missing payment id",
        });
        return;
      }

      toast.success("\u05d4\u05d4\u05db\u05e0\u05e1\u05d4 \u05e0\u05d5\u05e1\u05e4\u05d4");
      setAmount("");
      setPaymentDate(getTodayDate());
      setPaymentMethod("");
      setReferenceNumber("");
      setNotes("");
      onCreated(createdPayment);
    } catch (e: unknown) {
      toast.error("\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05db\u05e0\u05e1\u05d4", {
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
          <DialogTitle>{"\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05db\u05e0\u05e1\u05d4"}</DialogTitle>
          <DialogDescription>
            {"\u05d4\u05d4\u05db\u05e0\u05e1\u05d4 \u05ea\u05d9\u05e8\u05e9\u05dd \u05db\u05ea\u05e7\u05d1\u05d5\u05dc \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8."}
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
              <Input
                value={paymentMethod}
                onChange={(e) => {
                  setPaymentMethod(e.target.value);
                  setPaymentMethodTouched(true);
                }}
                onBlur={() => setPaymentMethodTouched(true)}
                placeholder={"\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: \u05d4\u05e2\u05d1\u05e8\u05d4 \u05d1\u05e0\u05e7\u05d0\u05d9\u05ea"}
                aria-invalid={showPaymentMethodError}
                className={
                  showPaymentMethodError
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
              {showPaymentMethodError ? (
                <div className="text-xs text-destructive">{paymentMethodError}</div>
              ) : null}
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05d0\u05e1\u05de\u05db\u05ea\u05d0 (\u05d0\u05d5\u05e4\u05e6\u05d9\u05d5\u05e0\u05dc\u05d9)"}</div>
              <Input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder={"\u05de\u05e1\u05e4\u05e8 \u05e7\u05d1\u05dc\u05d4/\u05d4\u05e2\u05d1\u05e8\u05d4"}
              />
            </div>
          </AdaptiveGrid>

          <div className="space-y-1">
            <div className="text-sm font-medium">{"\u05d4\u05e2\u05e8\u05d5\u05ea (\u05d0\u05d5\u05e4\u05e6\u05d9\u05d5\u05e0\u05dc\u05d9)"}</div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={"\u05d4\u05e2\u05e8\u05d5\u05ea..."}
            />
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
              {submitting ? "\u05e9\u05d5\u05de\u05e8..." : "\u05e9\u05de\u05d9\u05e8\u05d4"}
            </Button>
          </DialogFooter>
        </form>
      </AdaptiveDialog>
    </Dialog>
  );
}
