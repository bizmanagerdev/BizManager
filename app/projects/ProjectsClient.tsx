"use client";
import { toHebrewError } from "@/lib/error-messages";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { loadMoreProjects } from "@/app/projects/actions";
import type { ProjectsFilters } from "@/app/projects/loadProjects";
import { CheckCircle2, FileText, FolderKanban, MessageCircle, Pencil, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { paymentStatusClasses, collectionStatusClasses, collectionStatusLabel } from "@/lib/orders/paymentStatus";
import { shouldIgnoreRowNavigation } from "@/lib/ui/row-navigation";
import {
  AdaptiveDialog,
  AdaptiveGrid,
  AdaptiveStack,
  PageStack,
} from "@/components/layout/page-layout";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import DeleteProjectButton from "@/app/projects/DeleteProjectButton";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";
import NewProjectClient, { type ProjectCustomerOption, type InitialProject } from "@/app/projects/NewProjectClient";

type ProjectRow = Record<string, unknown>;
type Option = { id: string; label: string; phone?: string | null; whatsapp?: string | null; email?: string | null; name_for_invoice?: string | null; contacts?: Array<{ full_name: string; phone: string | null; email: string | null }> };
type SortMode = "recent" | "start_date" | "start_date_desc" | "profit_desc";
type ProjectsView = "projects" | "quotes" | "closed";
type ProjectMonthlySummary = {
  month: string;
  startDate: string;
  endDate: string;
  totalProjects: number;
  byType: Array<{ type: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  totals: {
    charged: number;
    paid: number;
    expenses: number;
    profit: number;
    basePrice: number;
    billedExtras: number;
    workerOwed: number;
  };
  quotes: {
    count: number;
    charged: number;
  };
};
const defaultStatusOptions = ["quote", "planned", "active", "on_hold", "completed", "cancelled"];
const defaultProjectTypeOptions = ["logistics", "moving", "construction"];

function getString(row: ProjectRow, key: string) {
  const value = row[key];
  if (typeof value === "string") return value;
  return null;
}

function getNumber(row: ProjectRow, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getStringArray(row: ProjectRow, key: string) {
  const value = row[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Map a project list row into the wizard's edit prefill shape. */
function toInitialProject(row: ProjectRow): InitialProject {
  return {
    id: getString(row, "id") ?? "",
    customer_id: getString(row, "customer_id") ?? "",
    name: getString(row, "name") ?? "",
    project_type: getString(row, "project_type") ?? defaultProjectTypeOptions[0],
    status: getString(row, "status") ?? defaultStatusOptions[0],
    agreed_base_price: getNumber(row, "agreed_base_price") ?? 0,
    price_includes_vat: row["price_includes_vat"] === true,
    expenses_billed_separately: row["expenses_billed_separately"] === true,
    project_manager_id: getString(row, "project_manager_id"),
    start_date: getString(row, "start_date"),
    end_date: getString(row, "end_date"),
    payment_terms: getString(row, "payment_terms"),
    due_date: getString(row, "due_date"),
    notes: getString(row, "notes"),
    items_to_move: getStringArray(row, "items_to_move"),
  };
}

function formatIls(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function projectDisplayName(row: ProjectRow) {
  return getString(row, "name") ?? "פרויקט";
}

function clientDisplayName(row: ProjectRow) {
  return getString(row, "customer_name") ?? "-";
}

function statusValue(row: ProjectRow) {
  return getString(row, "status") ?? "unknown";
}

function statusLabel(status: string) {
  return status === "unknown" ? "לא ידוע" : getProjectStatusLabel(status);
}

function projectTypeLabel(value: string) {
  switch (value) {
    case "logistics":
      return "לוגיסטיקה";
    case "moving":
      return "הובלה";
    case "construction":
      return "שיפוצים";
    default:
      return value;
  }
}

function profitValue(row: ProjectRow) {
  const direct = getNumber(row, "gross_profit");
  if (direct !== null) return direct;

  const actualPrice = getNumber(row, "actual_price");
  const expenses = getNumber(row, "total_expenses");
  if (actualPrice !== null && expenses !== null) return actualPrice - expenses;
  return null;
}

function actualPriceValue(row: ProjectRow) {
  // Show the actual price (מחיר בפועל) — the project_financials_view effective
  // price, same as the project details page. Fall back to the raw actual/agreed
  // price (and the derived total) only when the view value is missing.
  return (
    getNumber(row, "effective_customer_price") ??
    getNumber(row, "actual_price") ??
    getNumber(row, "agreed_base_price") ??
    getNumber(row, "customer_total_price")
  );
}

function normalizeProjectsView(value: string | null): ProjectsView {
  return value === "quotes" || value === "closed" ? value : "projects";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function paymentStatusValue(row: ProjectRow) {
  const value = getString(row, "payment_status_list");
  if (value === "paid" || value === "partial" || value === "unpaid" || value === "unpriced") {
    return value;
  }

  const paidTotal = getNumber(row, "paid_total") ?? 0;
  const amountDue = getNumber(row, "amount_due");
  const customerTotalPrice = getNumber(row, "customer_total_price");
  const actualPrice = getNumber(row, "actual_price");
  const agreedBasePrice = getNumber(row, "agreed_base_price");
  const expensesBilled = getNumber(row, "expenses_billed") ?? 0;
  const baseProjectPrice = agreedBasePrice ?? actualPrice ?? 0;
  const derivedCustomerTotalPrice = baseProjectPrice + expensesBilled;
  const dueBase =
    derivedCustomerTotalPrice > 0 ? derivedCustomerTotalPrice : customerTotalPrice ?? 0;
  const effectiveAmountDue = amountDue ?? dueBase;

  if (baseProjectPrice <= 0) return "unpriced";
  if (effectiveAmountDue <= 0 || paidTotal >= effectiveAmountDue) return "paid";
  if (paidTotal > 0) return "partial";
  return "unpaid";
}

function paymentStatusLabel(status: "paid" | "partial" | "unpaid" | "unpriced") {
  switch (status) {
    case "paid":
      return "שולם";
    case "partial":
      return "שולם חלקית";
    case "unpaid":
      return "לא שולם";
    case "unpriced":
      return "לא סוכם תשלום";
  }
}

function paymentStatusBadgeClasses(status: "paid" | "partial" | "unpaid" | "unpriced") {
  switch (status) {
    case "paid":
      return paymentStatusClasses("paid");
    case "partial":
      return paymentStatusClasses("partial");
    case "unpaid":
      return paymentStatusClasses("unpaid");
    case "unpriced":
      return "border-border bg-background text-muted-foreground";
  }
}

function currentMonthIso() {
  return new Date().toISOString().slice(0, 7);
}

function defaultSortForTab(tab: ProjectsView): SortMode {
  return tab === "closed" ? "start_date_desc" : "start_date";
}


export default function ProjectsClient({
  initialProjects,
  initialHasMore = false,
  totalCount,
  customerOptions,
  managerOptions,
  currentUserId,
  viewerRole,
  defaultProjectManagerId,
  tabCounts,
  initialFilters,
}: {
  initialProjects: ProjectRow[];
  initialHasMore?: boolean;
  totalCount?: number;
  customerOptions: Option[];
  managerOptions: Option[];
  currentUserId?: string;
  viewerRole?: string;
  defaultProjectManagerId?: string;
  tabCounts?: { projects: number; quotes: number; closed: number };
  initialFilters?: { view: ProjectsView; status: string; customerId: string | null; sort: SortMode; q: string };
}) {
  const router = useRouter();
  // In projects, office sees status only — all money (price, profit, monthly totals) is admin-only.
  const canSeeMoney = viewerRole === "admin";
  const searchParams = useSearchParams();
  const prefillHandled = useRef(false);

  // Fetch-from-DB-as-you-scroll: accumulate project pages and pull the next one
  // from the server when the bottom comes into view (no "next page" button).
  const fetchFilters = useMemo<ProjectsFilters>(
    () => ({
      view: initialFilters?.view ?? "projects",
      status: initialFilters?.status ?? "all",
      customerId: initialFilters?.customerId ?? null,
      sort: initialFilters?.sort ?? "start_date",
      q: initialFilters?.q ?? "",
    }),
    [initialFilters]
  );
  const fetchPage = useCallback(
    (page: number) => loadMoreProjects(page, fetchFilters),
    [fetchFilters]
  );
  const getRowId = useCallback((row: ProjectRow) => String(row.id ?? ""), []);
  const {
    rows: projects,
    setRows: setProjects,
    hasMore,
    loading: loadingMore,
    sentinelRef,
    mobileSentinelRef,
    scrollRef,
  } = useInfiniteScroll<ProjectRow>({
    initialRows: initialProjects,
    initialHasMore,
    fetchPage,
    getId: getRowId,
  });

  const activeTab: ProjectsView = normalizeProjectsView(searchParams.get("view"));
  const [query, setQuery] = useState(initialFilters?.q ?? "");
  const status = searchParams.get("status") ?? "all";
  const rawSort: SortMode = (["recent", "start_date", "start_date_desc", "profit_desc"].includes(searchParams.get("sort") ?? "") ? searchParams.get("sort") : defaultSortForTab(activeTab)) as SortMode;
  // Non-admins can't sort by (or see) profit, even via a hand-crafted URL.
  const sort: SortMode = !canSeeMoney && rawSort === "profit_desc" ? defaultSortForTab(activeTab) : rawSort;

  // Push filter changes to URL — server re-fetches with the new filters applied
  // across the full dataset, then we get a fresh paginated slice back.
  const pushFilters = useCallback(
    (next: Partial<{ view: ProjectsView; status: string; sort: SortMode; q: string }>) => {
      const merged = {
        view: next.view ?? activeTab,
        status: next.status ?? status,
        sort: next.sort ?? sort,
        q: next.q ?? query,
      };
      const params = new URLSearchParams();
      const currentCustomerId = searchParams.get("customer_id");
      const currentCustomerName = searchParams.get("customer_name");
      const currentCustomerPage = searchParams.get("customer_page");
      if (currentCustomerId) params.set("customer_id", currentCustomerId);
      if (currentCustomerName) params.set("customer_name", currentCustomerName);
      if (currentCustomerPage) params.set("customer_page", currentCustomerPage);
      if (merged.view !== "projects") params.set("view", merged.view);
      if (merged.status && merged.status !== "all") params.set("status", merged.status);
      const defaultSort = merged.view === "closed" ? "start_date_desc" : "start_date";
      if (merged.sort !== defaultSort) params.set("sort", merged.sort);
      if (merged.q.trim()) params.set("q", merged.q.trim());
      const qs = params.toString();
      router.push(qs ? `/projects?${qs}` : "/projects", { scroll: false });
    },
    [activeTab, status, sort, query, router, searchParams]
  );

  // Debounced search submission to URL
  const initialQueryRef = useRef(initialFilters?.q ?? "");
  useEffect(() => {
    if (query === initialQueryRef.current) return;
    const timer = setTimeout(() => {
      pushFilters({ q: query });
      initialQueryRef.current = query;
    }, 400);
    return () => clearTimeout(timer);
    // pushFilters intentionally omitted to avoid resending on its own changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const setStatus = (next: string) => pushFilters({ status: next });
  const setSort = (next: SortMode) => pushFilters({ sort: next });
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [monthlySummaryOpen, setMonthlySummaryOpen] = useState(false);
  const [monthlySummaryMonth, setMonthlySummaryMonth] = useState(currentMonthIso());
  const [monthlySummaryLoading, setMonthlySummaryLoading] = useState(false);
  const [monthlySummaryError, setMonthlySummaryError] = useState<string | null>(null);
  const [monthlySummary, setMonthlySummary] = useState<ProjectMonthlySummary | null>(null);

  // Project create/edit now run through the shared <NewProjectClient/> wizard, so
  // this component only tracks dialog open/submit state — the wizard owns the form.
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createStatus, setCreateStatus] = useState(defaultStatusOptions[0]);
  const [createPrefillCustomerId, setCreatePrefillCustomerId] = useState<string | undefined>(undefined);

  const [editOpen, setEditOpen] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editProject, setEditProject] = useState<ProjectRow | null>(null);

  // Customers mapped into the shape the project wizard renders.
  const wizardCustomers = useMemo<ProjectCustomerOption[]>(
    () =>
      customerOptions.map((c) => ({
        id: c.id,
        name: c.label,
        nameForInvoice: c.name_for_invoice ?? null,
        phone: c.phone ?? null,
        whatsapp: c.whatsapp ?? null,
        email: c.email ?? null,
        city: null,
        address: null,
        contacts: c.contacts,
      })),
    [customerOptions]
  );

  const [approveQuoteOpen, setApproveQuoteOpen] = useState(false);
  const [approveQuoteSubmitting, setApproveQuoteSubmitting] = useState(false);
  const [approveQuoteError, setApproveQuoteError] = useState<string | null>(null);
  const [approveQuoteId, setApproveQuoteId] = useState("");
  const [approveQuoteName, setApproveQuoteName] = useState("");
  const [approveQuotePrice, setApproveQuotePrice] = useState("");

  function removeProject(id: string) {
    setProjects((prev) =>
      prev.filter((row) => {
        const rowId = getString(row, "id") ?? "";
        return rowId !== id;
      })
    );
  }

  // Server already applied tab/status/sort/search filters across the full dataset.
  const rows = projects;

  const projectCount = tabCounts?.projects ?? 0;
  const quoteCount = tabCounts?.quotes ?? 0;
  const closedCount = tabCounts?.closed ?? 0;

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    projects
      .filter((row) =>
        activeTab === "quotes"
          ? statusValue(row) === "quote"
          : activeTab === "closed"
            ? statusValue(row) === "completed"
            : !["quote", "completed"].includes(statusValue(row))
      )
      .forEach((row) => set.add(statusValue(row)));
    defaultStatusOptions.forEach((value) => set.add(value));
    const filtered = Array.from(set).filter((value) =>
      activeTab === "quotes"
        ? value === "quote"
        : activeTab === "closed"
          ? value === "completed"
          : !["quote", "completed"].includes(value)
    );
    return filtered.sort();
  }, [activeTab, projects]);
  const hasImplicitTabStatus =
    (activeTab === "quotes" && status === "quote") ||
    (activeTab === "closed" && status === "completed");
  const hasActiveToolbarFilters =
    query.trim().length > 0 || (!hasImplicitTabStatus && status !== "all") || sort !== defaultSortForTab(activeTab);
  const activeFilterSummary = [
    query.trim() ? `חיפוש: ${query.trim()}` : null,
    !hasImplicitTabStatus && status !== "all" ? `סטטוס: ${statusLabel(status)}` : null,
    sort !== defaultSortForTab(activeTab)
      ? `מיון: ${
          sort === "recent"
            ? "אחרונים"
            : sort === "start_date"
              ? "תאריך התחלה - ישן לחדש"
              : sort === "start_date_desc"
                ? "תאריך התחלה - חדש לישן"
                : "רווח (גבוה לנמוך)"
        }`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" • ");
  const projectTypeOptions = useMemo(() => {
    return defaultProjectTypeOptions;
  }, []);

  const handleTabChange = useCallback(
    (value: string) => {
      const nextTab = normalizeProjectsView(value);
      pushFilters({ view: nextTab, status: "all", sort: defaultSortForTab(nextTab), q: "" });
      setQuery("");
    },
    [pushFilters]
  );

  function defaultCreateStatusForTab(tab: ProjectsView) {
    return tab === "quotes" ? "quote" : "planned";
  }

  function resetFilters() {
    setQuery("");
    pushFilters({ q: "", status: "all", sort: defaultSortForTab(activeTab) });
  }

  const openCreateDialog = useCallback((nextTab: ProjectsView = activeTab) => {
    setCreateStatus(defaultCreateStatusForTab(nextTab));
    setCreateOpen(true);
  }, [activeTab]);

  useEffect(() => {
    if (prefillHandled.current) return;

    const prefillCustomerId = (searchParams.get("customer_id") ?? "").trim();
    const shouldOpenCreate = (searchParams.get("create") ?? "").trim() === "1";

    if (shouldOpenCreate) {
      setCreatePrefillCustomerId(prefillCustomerId || undefined);
      openCreateDialog(activeTab);
    }

    prefillHandled.current = true;
  }, [activeTab, openCreateDialog, searchParams]);

  function openEditProject(row: ProjectRow) {
    setEditProject(row);
    setEditOpen(true);
  }

  function openApproveQuote(row: ProjectRow) {
    setApproveQuoteError(null);
    setApproveQuoteId(getString(row, "id") ?? "");
    setApproveQuoteName(projectDisplayName(row));
    const currentPrice = getNumber(row, "agreed_base_price");
    setApproveQuotePrice(currentPrice !== null && currentPrice > 0 ? String(currentPrice) : "");
    setApproveQuoteOpen(true);
  }

  async function loadMonthlySummary() {
    if (monthlySummaryLoading) return;
    setMonthlySummaryError(null);
    setMonthlySummaryLoading(true);
    try {
      const res = await fetch("/api/projects/monthly-summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month: monthlySummaryMonth }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      } & Partial<ProjectMonthlySummary>;
      if (!res.ok) {
        setMonthlySummaryError(toHebrewError(json.error, "טעינת הסיכום נכשלה."));
        return;
      }
      setMonthlySummary(json as ProjectMonthlySummary);
    } catch (e: unknown) {
      setMonthlySummaryError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setMonthlySummaryLoading(false);
    }
  }


  async function approveQuote() {
    if (approveQuoteSubmitting) return;
    setApproveQuoteError(null);

    const agreed = approveQuotePrice.trim() ? Number(approveQuotePrice) : NaN;
    if (!approveQuoteId) {
      setApproveQuoteError("לא נבחרה הצעת מחיר.");
      return;
    }
    if (!Number.isFinite(agreed) || agreed <= 0) {
      setApproveQuoteError("יש להזין מחיר מוסכם גדול מ-0.");
      return;
    }

    setApproveQuoteSubmitting(true);
    try {
      const res = await fetch("/api/projects/approve-quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: approveQuoteId,
          agreed_base_price: agreed,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as Partial<{
        error: string;
        project: ProjectRow;
      }>;

      if (!res.ok || !json.project) {
        setApproveQuoteError(toHebrewError(json.error, "אישור הצעת המחיר נכשל."));
        return;
      }

      setProjects((prev) =>
        prev.map((row) => {
          const id = getString(row, "id") ?? "";
          return id === approveQuoteId ? (json.project as ProjectRow) : row;
        })
      );
      setApproveQuoteOpen(false);
      setApproveQuoteId("");
      setApproveQuoteName("");
      setApproveQuotePrice("");
      router.refresh();
    } catch (e: unknown) {
      setApproveQuoteError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setApproveQuoteSubmitting(false);
    }
  }

  return (
    <PageStack>
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="hidden md:block">
          <TabsList variant="underline" className="justify-center">
            <TabsTrigger value="quotes"><FileText className="h-4 w-4" />הצעות ({quoteCount})</TabsTrigger>
            <TabsTrigger value="projects"><FolderKanban className="h-4 w-4" />פרויקטים ({projectCount})</TabsTrigger>
            <TabsTrigger value="closed"><CheckCircle2 className="h-4 w-4" />סגורים ({closedCount})</TabsTrigger>
          </TabsList>
        </div>

        <TabsList variant="underline" className="justify-center md:hidden">
          <TabsTrigger value="quotes"><FileText className="h-4 w-4" />הצעות ({quoteCount})</TabsTrigger>
          <TabsTrigger value="projects"><FolderKanban className="h-4 w-4" />פרויקטים ({projectCount})</TabsTrigger>
          <TabsTrigger value="closed"><CheckCircle2 className="h-4 w-4" />סגורים ({closedCount})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-3 md:hidden">
        <Button type="button" className="h-11 w-full" onClick={() => openCreateDialog(activeTab)}>
          {activeTab === "quotes" ? "הצעת מחיר חדשה" : "הוספת פרויקט"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 justify-center gap-2"
            onClick={() => setMobileFiltersOpen((current) => !current)}
            aria-expanded={mobileFiltersOpen}
            aria-controls="projects-mobile-filters"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {mobileFiltersOpen ? "הסתרת חיפוש וסינון" : "חיפוש וסינון"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              setMonthlySummaryOpen(true);
              void loadMonthlySummary();
            }}
          >
            סיכום חודשי
          </Button>
        </div>

        {hasActiveToolbarFilters && !mobileFiltersOpen ? (
          <div className="rounded-xl border border-border/60 bg-card px-3 py-2 text-xs text-muted-foreground">
            {activeFilterSummary || "קיים חיפוש או סינון פעיל."}
          </div>
        ) : null}

        <div
          id="projects-mobile-filters"
          className={(
            `${mobileFiltersOpen ? "grid" : "hidden"} gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm`
          ).trim()}
        >
          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">חיפוש</label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש לפי לקוח או פרויקט..."
                className="h-11 pr-9"
              />
            </div>
          </div>

          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">סטטוס</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">הכל</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">מיון לפי</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="recent">אחרונים</option>
              <option value="start_date">תאריך התחלה - ישן לחדש</option>
              <option value="start_date_desc">תאריך התחלה - חדש לישן</option>
              {canSeeMoney ? <option value="profit_desc">רווח (גבוה לנמוך)</option> : null}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" className="h-11" onClick={resetFilters}>
              איפוס סינון
            </Button>
            <Button
              type="button"
              className="h-11"
              onClick={() => setMobileFiltersOpen(false)}
            >
              הצגת התוצאות
            </Button>
          </div>
        </div>
      </div>

      <AdaptiveStack
        variant="toolbar"
        className="hidden min-w-0 md:flex md:flex-col md:gap-4 xl:flex-row xl:items-end xl:justify-between xl:gap-6"
      >
        <AdaptiveGrid variant="projectsToolbarControls" className="min-w-0 lg:grid-cols-4">
          <div className="min-w-0 lg:col-span-2">
            <label className="text-sm text-muted-foreground">חיפוש</label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש לפי לקוח או פרויקט..."
                className="h-11 pr-9"
              />
            </div>
          </div>

          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">סטטוס</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">הכל</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">מיון לפי</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="recent">אחרונים</option>
              <option value="start_date">תאריך התחלה - ישן לחדש</option>
              <option value="start_date_desc">תאריך התחלה - חדש לישן</option>
              {canSeeMoney ? <option value="profit_desc">רווח (גבוה לנמוך)</option> : null}
            </select>
          </div>

        </AdaptiveGrid>

        <div className="w-full xl:w-auto">
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:w-auto">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full xl:w-auto"
              onClick={() => {
                setMonthlySummaryOpen(true);
                void loadMonthlySummary();
              }}
            >
              סיכום חודשי
            </Button>
            <Button type="button" className="h-11 w-full xl:w-auto" onClick={() => openCreateDialog(activeTab)}>
              {activeTab === "quotes" ? "הצעת מחיר חדשה" : "הוספת פרויקט"}
            </Button>
          </div>
        </div>
      </AdaptiveStack>

      <div className="text-sm text-muted-foreground">
        {activeTab === "quotes"
          ? `נמצאו ${tabCounts?.quotes ?? rows.length} הצעות מחיר`
          : activeTab === "closed"
            ? `נמצאו ${tabCounts?.closed ?? rows.length} פרויקטים סגורים`
            : `נמצאו ${tabCounts?.projects ?? rows.length} פרויקטים`}
      </div>

      <Card className="hidden overflow-hidden border-border/70 shadow-sm xl:block">
        <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
              <tr className="border-b border-border/70 text-right">
                <th className="px-4 py-3 font-medium">פרויקט</th>
                <th className="px-4 py-3 font-medium">סטטוס</th>
                <th className="px-4 py-3 font-medium">תאריך התחלה</th>
                <th className="px-4 py-3 font-medium">תשלום</th>
                <th className="px-4 py-3 font-medium">לקוח</th>
                {canSeeMoney ? (
                  <th className="px-4 py-3 font-medium">{activeTab === "quotes" ? "מחיר" : "מחיר / רווח"}</th>
                ) : null}
                <th className="px-4 py-3 font-medium">משימות פתוחות</th>
                <th className="px-4 py-3 font-medium">{activeTab === "quotes" ? "אישור הצעה" : "מסמכים"}</th>
                <th className="px-4 py-3 font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {rows.map((row) => {
                const id = getString(row, "id") ?? "";
                const profit = profitValue(row);
                const actualPrice = actualPriceValue(row);
                const currentStatus = statusValue(row);
                const openTasks = getNumber(row, "open_tasks");
                const paymentStatus = paymentStatusValue(row);
                const collectionStatus = getString(row, "collection_status") ?? paymentStatus;
                const startDate = formatDate(getString(row, "start_date"));
                const detailHref = `/projects/${id}${activeTab === "projects" ? "" : `?view=${activeTab}`}`;

                return (
                  <tr
                    key={`${id}-table`}
                    className="cursor-pointer align-top hover:bg-muted/20 focus-visible:bg-muted/20"
                    tabIndex={0}
                    role="link"
                    onClick={(event) => {
                      if (shouldIgnoreRowNavigation(event.target)) return;
                      emitNavigationStart();
                      router.push(detailHref);
                    }}
                    onKeyDown={(event) => {
                      if (shouldIgnoreRowNavigation(event.target)) return;
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      emitNavigationStart();
                      router.push(detailHref);
                    }}
                  >
                    <td className="px-4 py-4">
                      <div className="block">
                        <div className="font-medium">{projectDisplayName(row)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">#{id.slice(0, 8)}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={currentStatus} type="project" />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">{startDate}</td>
                    <td className="px-4 py-4">
                      {paymentStatus === "unpriced" ? (
                        <Badge className={paymentStatusBadgeClasses("unpriced")}>
                          {paymentStatusLabel("unpriced")}
                        </Badge>
                      ) : (
                        <Badge className={collectionStatusClasses(collectionStatus)}>
                          {collectionStatusLabel(collectionStatus)}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-4">{clientDisplayName(row)}</td>
                    {canSeeMoney ? (
                      <td className="px-4 py-4">
                        {currentStatus === "quote" ? (
                          actualPrice === null ? "-" : formatIls(actualPrice)
                        ) : (
                          <div className="space-y-0.5">
                            <div className="text-xs text-muted-foreground">
                              מחיר: {actualPrice === null ? "-" : formatIls(actualPrice)}
                            </div>
                            <div className={profit !== null && profit < 0 ? "text-destructive" : ""}>
                              רווח: {profit === null ? "-" : formatIls(profit)}
                            </div>
                          </div>
                        )}
                      </td>
                    ) : null}
                    <td className="px-4 py-4">{openTasks === null ? "-" : openTasks}</td>
                    <td className="px-4 py-4">
                      {currentStatus === "quote" ? (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="w-full xl:w-auto"
                          onClick={() => openApproveQuote(row)}
                        >
                          אישור הצעה
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            asChild
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 rounded-xl"
                            aria-label="שליחת דף עבודה ב-WhatsApp"
                            title="שליחת דף עבודה ב-WhatsApp"
                          >
                            <Link
                              href={`/projects/${id}/export?mode=worker`}
                              prefetch
                              onClick={() => emitNavigationStart()}
                            >
                              <MessageCircle className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button
                            asChild
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 rounded-xl"
                            aria-label="דף עבודה / שיתוף / הדפסה / הורדה"
                            title="דף עבודה / שיתוף / הדפסה / הורדה"
                          >
                            <Link
                              href={`/projects/${id}/export?mode=worker`}
                              prefetch
                              onClick={() => emitNavigationStart()}
                            >
                              <FileText className="h-4 w-4" />
                            </Link>
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 rounded-xl"
                          onClick={() => openEditProject(row)}
                          aria-label={currentStatus === "quote" ? "עריכת הצעת מחיר" : "עריכת פרויקט"}
                          title={currentStatus === "quote" ? "עריכת הצעת מחיר" : "עריכת פרויקט"}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <DeleteProjectButton
                          projectId={id}
                          projectName={projectDisplayName(row)}
                          size="icon"
                          className="h-9 w-9 rounded-xl"
                          ariaLabel={currentStatus === "quote" ? "מחיקת הצעת מחיר" : "מחיקת פרויקט"}
                          onDeleted={() => removeProject(id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </DeleteProjectButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasMore ? <div ref={sentinelRef} className="h-1" /> : null}
        </div>
      </Card>

      <div className="grid gap-2.5 xl:hidden">
        {rows.map((row) => {
          const id = getString(row, "id") ?? "";
          const profit = profitValue(row);
          const actualPrice = actualPriceValue(row);
          const currentStatus = statusValue(row);
          const openTasks = getNumber(row, "open_tasks");
          const paymentStatus = paymentStatusValue(row);
          const collectionStatus = getString(row, "collection_status") ?? paymentStatus;
          const startDate = formatDate(getString(row, "start_date"));
          const detailHref = `/projects/${id}${activeTab === "projects" ? "" : `?view=${activeTab}`}`;

          return (
            <Card key={id} className="overflow-hidden border-border/70 shadow-sm transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold">{projectDisplayName(row)}</div>
                        <div className="mt-1 truncate text-sm text-muted-foreground">{clientDisplayName(row)}</div>
                      </div>
                      <div className="shrink-0 text-xs text-muted-foreground">#{id.slice(0, 8)}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-xl border border-border/60 bg-background/70 p-2.5">
                        <div className="text-xs text-muted-foreground">תאריך התחלה</div>
                        <div className="mt-1 font-medium">{startDate}</div>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/70 p-2.5">
                        <div className="text-xs text-muted-foreground">משימות פתוחות</div>
                        <div className="mt-1 font-medium">{openTasks === null ? "-" : openTasks}</div>
                      </div>
                      {canSeeMoney ? (
                        <div className="rounded-xl border border-border/60 bg-background/70 p-2.5">
                          <div className="text-xs text-muted-foreground">מחיר</div>
                          <div className="mt-1 font-medium">
                            {actualPrice === null ? "-" : formatIls(actualPrice)}
                          </div>
                        </div>
                      ) : null}
                      {currentStatus === "quote" || canSeeMoney ? (
                        <div className="rounded-xl border border-border/60 bg-background/70 p-2.5">
                          <div className="text-xs text-muted-foreground">
                            {currentStatus === "quote" ? "סטטוס הצעה" : "רווח"}
                          </div>
                          <div className={`mt-1 font-medium ${profit !== null && profit < 0 ? "text-destructive" : ""}`}>
                            {currentStatus === "quote"
                              ? statusLabel(currentStatus)
                              : profit === null
                                ? "-"
                                : formatIls(profit)}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-border/60 bg-background/70 p-2.5">
                          <div className="text-xs text-muted-foreground">תשלום</div>
                          <div className="mt-1">
                            {paymentStatus === "unpriced" ? (
                              <Badge className={paymentStatusBadgeClasses("unpriced")}>
                                {paymentStatusLabel("unpriced")}
                              </Badge>
                            ) : (
                              <Badge className={collectionStatusClasses(collectionStatus)}>
                                {collectionStatusLabel(collectionStatus)}
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button asChild type="button" className="col-span-2 h-11 rounded-xl">
                      <Link href={detailHref} prefetch onClick={() => emitNavigationStart()}>
                        פתיחת פרויקט
                      </Link>
                    </Button>

                    {currentStatus === "quote" ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-11 rounded-xl"
                          onClick={() => openApproveQuote(row)}
                        >
                          אישור הצעה
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 rounded-xl"
                          onClick={() => openEditProject(row)}
                        >
                          <Pencil className="h-4 w-4" />
                          עריכה
                        </Button>
                        <DeleteProjectButton
                          projectId={id}
                          projectName={projectDisplayName(row)}
                          className="col-span-2 h-11 w-full rounded-xl"
                          ariaLabel="מחיקת הצעת מחיר"
                          onDeleted={() => removeProject(id)}
                        >
                          מחיקת הצעה
                        </DeleteProjectButton>
                      </>
                    ) : (
                      <>
                        <Button asChild type="button" variant="outline" className="h-11 rounded-xl">
                          <Link
                            href={`/projects/${id}/export?mode=worker`}
                            prefetch
                            onClick={() => emitNavigationStart()}
                          >
                            <MessageCircle className="h-4 w-4" />
                            WhatsApp
                          </Link>
                        </Button>
                        <Button asChild type="button" variant="outline" className="h-11 rounded-xl">
                          <Link
                            href={`/projects/${id}/export?mode=worker`}
                            prefetch
                            onClick={() => emitNavigationStart()}
                          >
                            <FileText className="h-4 w-4" />
                            דף עבודה
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 rounded-xl"
                          onClick={() => openEditProject(row)}
                        >
                          <Pencil className="h-4 w-4" />
                          עריכה
                        </Button>
                        <DeleteProjectButton
                          projectId={id}
                          projectName={projectDisplayName(row)}
                          className="h-11 w-full rounded-xl"
                          ariaLabel="מחיקת פרויקט"
                          onDeleted={() => removeProject(id)}
                        >
                          מחיקה
                        </DeleteProjectButton>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {hasMore ? <div ref={mobileSentinelRef} className="h-1 xl:hidden" /> : null}

      {rows.length > 0 ? (
        <div className="pt-1 text-center text-xs text-muted-foreground">
          {loadingMore
            ? "טוען…"
            : `מציג ${rows.length}${totalCount != null ? ` מתוך ${totalCount}` : ""} פרויקטים`}
        </div>
      ) : null}

      <Dialog
        open={approveQuoteOpen}
        onOpenChange={(open) => {
          setApproveQuoteOpen(open);
          if (!open && !approveQuoteSubmitting) {
            setApproveQuoteError(null);
            setApproveQuoteId("");
            setApproveQuoteName("");
            setApproveQuotePrice("");
          }
        }}
      >
        <AdaptiveDialog size="formSm">
          <DialogHeader>
            <DialogTitle>אישור הצעת מחיר</DialogTitle>
            <DialogDescription>
              {approveQuoteName
                ? `הזינו את המחיר המוסכם עבור ${approveQuoteName} לפני ההעברה למתוכנן.`
                : "הזינו את המחיר המוסכם לפני ההעברה למתוכנן."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium">מחיר מוסכם *</label>
            <CurrencyInput
              value={approveQuotePrice}
              onChange={(e) => setApproveQuotePrice(e.target.value)}
              placeholder="לדוגמה: 2300"
            />
            {approveQuoteError ? <p className="text-sm text-destructive">{approveQuoteError}</p> : null}
          </div>

          <DialogFooter className="mt-4 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              className="border-border bg-background text-muted-foreground hover:border-border hover:bg-muted/80 hover:text-foreground"
              onClick={() => setApproveQuoteOpen(false)}
              disabled={approveQuoteSubmitting}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={() => void approveQuote()}
              disabled={approveQuoteSubmitting}
            >
              {approveQuoteSubmitting ? "שומר..." : "אישור הצעה"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open && createSubmitting) return;
          setCreateOpen(open);
        }}
      >
        <AdaptiveDialog size="newOrder" hideClose className="flex flex-col gap-0 overflow-y-hidden p-0 sm:p-0">
          {/* Title/description kept for screen readers only — the wizard renders its
              own visible per-step heading, so showing them here would duplicate it. */}
          <DialogHeader className="sr-only">
            <DialogTitle>{createStatus === "quote" ? "הצעת מחיר חדשה" : "הוספת פרויקט חדש"}</DialogTitle>
            <DialogDescription>
              {createStatus === "quote"
                ? "בוחרים לקוח וממלאים את פרטי הצעת המחיר."
                : "בוחרים לקוח וממלאים את פרטי הפרויקט."}
            </DialogDescription>
          </DialogHeader>

          {createOpen ? (
            <NewProjectClient
              customers={wizardCustomers}
              managers={managerOptions}
              currentUserId={currentUserId}
              defaultProjectManagerId={defaultProjectManagerId}
              initialStatus={createStatus}
              initialCustomerId={createPrefillCustomerId}
              draftKey="project-create"
              projectTypeOptions={projectTypeOptions}
              onActionLockedChange={setCreateSubmitting}
              onCancel={() => setCreateOpen(false)}
              onSubmitted={(project) => {
                const id = getString(project, "id");
                if (id) {
                  setProjects((prev) => [
                    project as ProjectRow,
                    ...prev.filter((row) => (getString(row, "id") ?? "") !== id),
                  ]);
                }
                setCreateOpen(false);
                setCreatePrefillCustomerId(undefined);
                router.refresh();
                toast.success(createStatus === "quote" ? "הצעת המחיר נוצרה." : "הפרויקט נוצר.");
              }}
            />
          ) : null}
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open && editSubmitting) return;
          setEditOpen(open);
        }}
      >
        <AdaptiveDialog size="newOrder" hideClose className="flex flex-col gap-0 overflow-y-hidden p-0 sm:p-0">
          {/* Header for screen readers only — the wizard shows its own visible heading. */}
          <DialogHeader className="sr-only">
            <DialogTitle>עריכת פרויקט</DialogTitle>
            <DialogDescription>עדכון פרטי פרויקט קיים.</DialogDescription>
          </DialogHeader>

          {editOpen && editProject ? (
            <NewProjectClient
              key={getString(editProject, "id") ?? "edit"}
              mode="edit"
              customers={wizardCustomers}
              managers={managerOptions}
              currentUserId={currentUserId}
              defaultProjectManagerId={defaultProjectManagerId}
              initialProject={toInitialProject(editProject)}
              projectTypeOptions={projectTypeOptions}
              onActionLockedChange={setEditSubmitting}
              onCancel={() => setEditOpen(false)}
              onSubmitted={(project) => {
                const id = getString(project, "id");
                if (id) {
                  setProjects((prev) =>
                    prev.map((row) => ((getString(row, "id") ?? "") === id ? (project as ProjectRow) : row))
                  );
                }
                setEditOpen(false);
                router.refresh();
                toast.success("הפרויקט עודכן.");
              }}
            />
          ) : null}
        </AdaptiveDialog>
      </Dialog>

      <Dialog open={monthlySummaryOpen} onOpenChange={setMonthlySummaryOpen}>
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>סיכום פרויקטים לפי חודש</DialogTitle>
            <DialogDescription>
              בחר חודש כדי לראות סיכום של פרויקטים בפועל.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">חודש</label>
                <Input
                  type="month"
                  value={monthlySummaryMonth}
                  onChange={(e) => setMonthlySummaryMonth(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void loadMonthlySummary()}
                  disabled={monthlySummaryLoading}
                >
                  {monthlySummaryLoading ? "טוען..." : "הצג סיכום"}
                </Button>
              </div>
            </AdaptiveGrid>

            {monthlySummaryError ? (
              <div className="text-sm text-destructive">{monthlySummaryError}</div>
            ) : null}

            {monthlySummary ? (
              <div className="space-y-4">
                <AdaptiveGrid variant="customerStats">
                  <Stat label="פרויקטים בפועל" value={`${monthlySummary.totalProjects}`} />
                  {canSeeMoney ? (
                    <>
                      <Stat label='סה"כ לחיוב' value={formatIls(monthlySummary.totals.charged)} />
                      <Stat label='סה"כ הוצאות' value={formatIls(monthlySummary.totals.expenses)} />
                      <Stat label="רווח גולמי" value={formatIls(monthlySummary.totals.profit)} />
                      <Stat label='סה"כ שולם' value={formatIls(monthlySummary.totals.paid)} />
                      <Stat label='סה"כ חייב לעובדים' value={formatIls(monthlySummary.totals.workerOwed)} />
                      <Stat
                        label="יתרה פתוחה"
                        value={formatIls(monthlySummary.totals.charged - monthlySummary.totals.paid)}
                      />
                    </>
                  ) : null}
                </AdaptiveGrid>

                <AdaptiveGrid variant="formTwo">
                  <div className="space-y-2 rounded-md border bg-background p-3">
                    <div className="text-sm font-semibold">סוג פרויקט</div>
                    {monthlySummary.byType.length === 0 ? (
                      <div className="text-sm text-muted-foreground">אין נתונים לחודש הזה.</div>
                    ) : (
                      monthlySummary.byType.map((item) => (
                        <div key={item.type} className="flex items-center justify-between gap-3 text-sm">
                          <span>{projectTypeLabel(item.type)}</span>
                          <span className="font-medium">{item.count}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-2 rounded-md border bg-background p-3">
                    <div className="text-sm font-semibold">סטטוס</div>
                    {monthlySummary.byStatus.length === 0 ? (
                      <div className="text-sm text-muted-foreground">אין נתונים לחודש הזה.</div>
                    ) : (
                      monthlySummary.byStatus.map((item) => (
                        <div key={item.status} className="flex items-center justify-between gap-3 text-sm">
                          <span>{statusLabel(item.status)}</span>
                          <span className="font-medium">{item.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </AdaptiveGrid>
              </div>
            ) : null}
          </div>
        </AdaptiveDialog>
      </Dialog>
    </PageStack>
  );
}



