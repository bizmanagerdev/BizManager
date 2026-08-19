"use client";
import { toHebrewError } from "@/lib/error-messages";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useOfflineRows } from "@/hooks/useOfflineRows";
import StaleDataBadge from "@/components/layout/StaleDataBadge";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import PageAlertBar from "@/components/reminders/PageAlertBar";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { NativeSelect } from "@/components/ui/native-select";
import { loadMoreProjects } from "@/app/(app)/projects/actions";
import type { ProjectsFilters } from "@/app/(app)/projects/loadProjects";
import { ChatIcon, DocumentIcon, EditIcon, FilterIcon, ProjectIcon, SearchIcon, SuccessIcon } from "@/components/ui/icons";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { paymentStatusClasses, collectionStatusClasses, collectionStatusLabel } from "@/lib/orders/paymentStatus";
import { shouldIgnoreRowNavigation } from "@/lib/ui/row-navigation";
import { cn } from "@/lib/utils";
import {
  AdaptiveDialog,
  AdaptiveGrid,
  AdaptiveStack,
  PageStack,
} from "@/components/layout/page-layout";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import DeleteProjectButton from "@/app/(app)/projects/DeleteProjectButton";
import AddReminderButton from "@/components/reminders/AddReminderButton";
import LogCommunicationButton from "@/components/communications/LogCommunicationButton";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";
import NewProjectClient, { type ProjectCustomerOption, type InitialProject } from "@/app/(app)/projects/NewProjectClient";
import { EditButton } from "@/components/ui/icon-button";

type ProjectRow = Record<string, unknown>;
type Option = { id: string; label: string; phone?: string | null; whatsapp?: string | null; email?: string | null; name_for_invoice?: string | null; contacts?: Array<{ full_name: string; phone: string | null; email: string | null }> };
type SortMode = "recent" | "start_date" | "start_date_desc" | "profit_desc";
type ProjectsView = "projects" | "quotes" | "closed";
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
    no_charge: row["no_charge"] === true,
    expenses_billed_separately: row["expenses_billed_separately"] === true,
    project_manager_id: getString(row, "project_manager_id"),
    start_date: getString(row, "start_date"),
    end_date: getString(row, "end_date"),
    payment_terms: getString(row, "payment_terms"),
    due_date: getString(row, "due_date"),
    notes: getString(row, "notes"),
    items_to_move: getStringArray(row, "items_to_move"),
    origin_address: getString(row, "origin_address"),
    origin_floor: getString(row, "origin_floor"),
    origin_has_elevator:
      row["origin_has_elevator"] === true ? true : row["origin_has_elevator"] === false ? false : null,
    destination_address: getString(row, "destination_address"),
    destination_floor: getString(row, "destination_floor"),
    destination_has_elevator:
      row["destination_has_elevator"] === true ? true : row["destination_has_elevator"] === false ? false : null,
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

/** Compact 22.06.26 form — the mobile card's footer has no room for a 4-digit year. */
function formatDateShort(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

// Badges on the mobile card sit as a caption above the title, so they're dialled
// down from the standalone badge: tighter padding, smaller text, medium weight.
const CARD_BADGE = "px-2 py-0.5 text-[11px] font-medium";

function projectDisplayName(row: ProjectRow) {
  return getString(row, "name") ?? "פרויקט";
}

function clientDisplayName(row: ProjectRow) {
  return getString(row, "customer_name") ?? "-";
}

function clientPhone(row: ProjectRow) {
  return getString(row, "customer_phone");
}

function statusValue(row: ProjectRow) {
  return getString(row, "status") ?? "unknown";
}

function statusLabel(status: string) {
  return status === "unknown" ? "לא ידוע" : getProjectStatusLabel(status);
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

function paymentStatusValue(row: ProjectRow) {
  if (row["no_charge"] === true) return "no_charge";
  const value = getString(row, "payment_status_list");
  if (value === "paid" || value === "partial" || value === "unpaid" || value === "unpriced" || value === "no_charge") {
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

function paymentStatusLabel(status: "paid" | "partial" | "unpaid" | "unpriced" | "no_charge") {
  switch (status) {
    case "paid":
      return "שולם";
    case "partial":
      return "שולם חלקית";
    case "unpaid":
      return "לא שולם";
    case "unpriced":
      return "לא סוכם תשלום";
    case "no_charge":
      return "ללא חיוב";
  }
}

function paymentStatusBadgeClasses(status: "paid" | "partial" | "unpaid" | "unpriced" | "no_charge") {
  switch (status) {
    case "paid":
      return paymentStatusClasses("paid");
    case "partial":
      return paymentStatusClasses("partial");
    case "unpaid":
      return paymentStatusClasses("unpaid");
    case "unpriced":
      return "border-border bg-background text-muted-foreground";
    case "no_charge":
      return "border-info/30 bg-info-soft/40 text-info-soft-foreground";
  }
}

function defaultSortForTab(_tab: ProjectsView): SortMode {
  return "start_date_desc";
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

  // Offline readability: cache the canonical (main-tab, unscoped) projects list so
  // it can be opened and searched with no signal. Scoped/other-tab views aren't.
  const customerScoped = Boolean(searchParams.get("customer_id"));
  const offlineCacheKey = activeTab === "projects" && !customerScoped ? "projects-list-main" : null;
  const { rows: sourceProjects, offline, savedAt } = useOfflineRows<ProjectRow>(
    offlineCacheKey,
    projects
  );

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
      const defaultSort: SortMode = "start_date_desc";
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
    // Offline, searching is in-memory over the cached list — never push a URL
    // change (the server re-query would fail and clobber the cached view).
    if (offline) return;
    const timer = setTimeout(() => {
      pushFilters({ q: query });
      initialQueryRef.current = query;
    }, 400);
    return () => clearTimeout(timer);
    // pushFilters intentionally omitted to avoid resending on its own changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, offline]);

  const setStatus = (next: string) => pushFilters({ status: next });
  const setSort = (next: SortMode) => pushFilters({ sort: next });
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // One swiped-open row at a time, like a native list.
  const [swipedRow, setSwipedRow] = useState<string | null>(null);

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

  // Online, the server already applied tab/status/sort/search across the full
  // dataset. Offline, render the cached list and filter it in memory so search
  // (by customer or project name) still works with no signal.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!offline || !q) return sourceProjects;
    return sourceProjects.filter((row) =>
      [getString(row, "name"), getString(row, "customer_name")]
        .some((field) => (field ?? "").toLowerCase().includes(q))
    );
  }, [offline, query, sourceProjects]);

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

  // Names the page in the mobile top bar and carries the count as the subtitle,
  // so the tab you're on and how much is in it are both visible without the page
  // repeating them.
  useSetPageTitle(
    activeTab === "quotes" ? "הצעות מחיר" : activeTab === "closed" ? "פרויקטים סגורים" : "פרויקטים",
    `${(activeTab === "quotes" ? tabCounts?.quotes : activeTab === "closed" ? tabCounts?.closed : tabCounts?.projects) ?? rows.length} ${activeTab === "quotes" ? "הצעות" : "פרויקטים"}`
  );

  return (
    <PageStack>
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="hidden md:block">
          <TabsList variant="underline" className="justify-start">
            <TabsTrigger value="quotes"><DocumentIcon className="h-4 w-4" />הצעות ({quoteCount})</TabsTrigger>
            <TabsTrigger value="projects"><ProjectIcon className="h-4 w-4" />פרויקטים ({projectCount})</TabsTrigger>
            <TabsTrigger value="closed"><SuccessIcon className="h-4 w-4" />סגורים ({closedCount})</TabsTrigger>
          </TabsList>
        </div>

        {/* Create / search / filter live in the dark header, same as customers —
            the page no longer restates its own heading area below the bar. The
            mobile tabs ride along underneath them, so the header is one block:
            what you're looking at, then the controls for it. The portal keeps
            React context, so these triggers still talk to the <Tabs> above. */}
        <PageHeaderToolbar>
          <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2">
          {/* No create button here: "פרויקט" is a tile in the app's one
              quick-create + (its wizard's status list covers הצעת מחיר too). */}
          <div className="relative w-full min-w-0">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש..."
              className="h-10 w-full rounded-xl ps-9"
            />
          </div>
          <Button
            type="button"
            size="icon"
            aria-label={mobileFiltersOpen ? "הסתרת סינון" : "סינון"}
            aria-expanded={mobileFiltersOpen}
            aria-controls="projects-mobile-filters"
            className={
              mobileFiltersOpen
                ? "h-10 w-10 shrink-0 rounded-xl"
                : "h-10 w-10 shrink-0 rounded-xl "
            }
            onClick={() => setMobileFiltersOpen((current) => !current)}
          >
            <FilterIcon className="h-4 w-4" />
          </Button>
          </div>
        </PageHeaderToolbar>

        {/* On the LIGHT page surface, not inside the dark header. It portals away
            above, so these tabs are the first thing under it — the requested order
            — without adding a third navy row to an already heavy header. */}
        <TabsList variant="underline" className="justify-start md:hidden">
          <TabsTrigger value="quotes" className="!text-sm">
            <DocumentIcon className="h-4 w-4" />הצעות ({quoteCount})
          </TabsTrigger>
          <TabsTrigger value="projects" className="!text-sm">
            <ProjectIcon className="h-4 w-4" />פרויקטים ({projectCount})
          </TabsTrigger>
          <TabsTrigger value="closed" className="!text-sm">
            <SuccessIcon className="h-4 w-4" />סגורים ({closedCount})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <PageAlertBar keys={["project_closed_unbilled", "project_deadline", "project_starting", "stale_quote"]} />

      <div className="space-y-3 md:hidden">

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
          {offline ? (
            <div className="flex justify-end">
              <StaleDataBadge savedAt={savedAt} />
            </div>
          ) : null}

          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">סטטוס</label>
            <NativeSelect
              value={status}
              onChange={(e) => setStatus(e.target.value)} className="mt-1"
            >
              <option value="all">הכל</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">מיון לפי</label>
            <NativeSelect
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)} className="mt-1"
            >
              <option value="recent">אחרונים</option>
              <option value="start_date">תאריך התחלה - ישן לחדש</option>
              <option value="start_date_desc">תאריך התחלה - חדש לישן</option>
              {canSeeMoney ? <option value="profit_desc">רווח (גבוה לנמוך)</option> : null}
            </NativeSelect>
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
        {/* xl:flex-1 — with the create button gone this grid is the row's only
            child, so it takes the width the button used to sit beside. */}
        <AdaptiveGrid variant="projectsToolbarControls" className="min-w-0 lg:grid-cols-4 xl:flex-1">
          <div className="min-w-0 lg:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm text-muted-foreground">חיפוש</label>
              {offline ? <StaleDataBadge savedAt={savedAt} /> : null}
            </div>
            <div className="relative mt-1">
              <SearchIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
            <NativeSelect
              value={status}
              onChange={(e) => setStatus(e.target.value)} className="mt-1"
            >
              <option value="all">הכל</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">מיון לפי</label>
            <NativeSelect
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)} className="mt-1"
            >
              <option value="recent">אחרונים</option>
              <option value="start_date">תאריך התחלה - ישן לחדש</option>
              <option value="start_date_desc">תאריך התחלה - חדש לישן</option>
              {canSeeMoney ? <option value="profit_desc">רווח (גבוה לנמוך)</option> : null}
            </NativeSelect>
          </div>

        </AdaptiveGrid>

      </AdaptiveStack>

      <div className="hidden text-sm text-muted-foreground md:block">
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
                      {paymentStatus === "unpriced" || paymentStatus === "no_charge" ? (
                        <Badge className={paymentStatusBadgeClasses(paymentStatus)}>
                          {paymentStatusLabel(paymentStatus)}
                        </Badge>
                      ) : (
                        <Badge className={collectionStatusClasses(collectionStatus)}>
                          {collectionStatusLabel(collectionStatus)}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div>{clientDisplayName(row)}</div>
                      {clientPhone(row) ? (
                        <a
                          href={`tel:${clientPhone(row)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          {clientPhone(row)}
                        </a>
                      ) : null}
                    </td>
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
                              <ChatIcon className="h-4 w-4" />
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
                              <DocumentIcon className="h-4 w-4" />
                            </Link>
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <AddReminderButton
                          entityType="project"
                          entityId={id}
                          customerId={getString(row, "customer_id")}
                          label={projectDisplayName(row)}
                          className="h-9 w-9 rounded-xl p-0"
                          iconOnly
                        />
                        <LogCommunicationButton
                          entityType="project"
                          entityId={id}
                          customerId={getString(row, "customer_id")}
                          defaultTopic="general"
                          className="h-9 w-9 rounded-xl p-0"
                          iconOnly
                        />
                        <EditButton onClick={() => openEditProject(row)} label={currentStatus === "quote" ? "עריכת הצעת מחיר" : "עריכת פרויקט"} />
                        <DeleteProjectButton
                          projectId={id}
                          projectName={projectDisplayName(row)}
                          triggerLabel={currentStatus === "quote" ? "מחיקת הצעת מחיר" : "מחיקת פרויקט"}
                          onDeleted={() => removeProject(id)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasMore && !offline ? <div ref={sentinelRef} className="h-1" /> : null}
        </div>
      </Card>

      <div className="grid gap-2.5 xl:hidden">
        <p className="px-1 text-[11px] text-muted-foreground">
          החלק כרטיס ימינה לפעולות · הקש לפתיחה
        </p>
        {rows.map((row) => {
          const id = getString(row, "id") ?? "";
          const profit = profitValue(row);
          const actualPrice = actualPriceValue(row);
          const currentStatus = statusValue(row);
          // Only the genuinely-LATE slice, never amount_due (the full price) and
          // never the outstanding balance — with nothing paid yet those both equal
          // the price, which just repeats the מחיר column below.
          const overdueAmount = getNumber(row, "overdue_amount") ?? 0;
          const overdueLabel =
            canSeeMoney && overdueAmount > 0
              ? `באיחור ${formatIls(overdueAmount)}`
              : "תשלום באיחור";
          const totalTasks = getNumber(row, "total_tasks") ?? 0;
          const completedTasks = getNumber(row, "completed_tasks") ?? 0;
          const paymentStatus = paymentStatusValue(row);
          const collectionStatus = getString(row, "collection_status") ?? paymentStatus;
          const startDate = formatDateShort(getString(row, "start_date"));
          const detailHref = `/projects/${id}${activeTab === "projects" ? "" : `?view=${activeTab}`}`;

          // Deliberately short: the swipe carries only what you'd do FROM the
          // list. Reminder, log-call and delete live inside the project itself —
          // they're decisions you make with the project open, not in passing.
          const actions = [
            currentStatus === "quote"
              ? {
                  key: "approve",
                  label: "אישור",
                  icon: <SuccessIcon className="h-5 w-5" />,
                  className: "bg-secondary",
                  onSelect: () => openApproveQuote(row),
                }
              : {
                  key: "sheet",
                  label: "דף עבודה",
                  icon: <DocumentIcon className="h-5 w-5" />,
                  className: "bg-secondary",
                  onSelect: () => {
                    emitNavigationStart();
                    router.push(`/projects/${id}/export?mode=worker`);
                  },
                },
            {
              key: "edit",
              label: "עריכה",
              icon: <EditIcon className="h-5 w-5" />,
              className: "bg-secondary-2",
              onSelect: () => openEditProject(row),
            },
          ];

          return (
            <SwipeActions
              key={id}
              className="border border-border/70 shadow-sm"
              actions={actions}
              open={swipedRow === id}
              onOpenChange={(next) => setSwipedRow(next ? id : null)}
            >
              <div
                role="link"
                tabIndex={0}
                className="block cursor-pointer p-4"
                onClick={(event) => {
                  if (shouldIgnoreRowNavigation(event.target)) return;
                  emitNavigationStart();
                  router.push(detailHref);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  if (shouldIgnoreRowNavigation(event.target)) return;
                  event.preventDefault();
                  emitNavigationStart();
                  router.push(detailHref);
                }}
              >
                <div className="space-y-3">
                  {/* Glance line — the two statuses, nothing else. Tighter and
                      lighter than a standalone badge: on a card they're a caption,
                      not a headline. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <StatusBadge value={currentStatus} type="project" className={CARD_BADGE} />
                    {paymentStatus === "unpriced" || paymentStatus === "no_charge" ? (
                      <Badge className={cn(paymentStatusBadgeClasses(paymentStatus), CARD_BADGE)}>
                        {paymentStatusLabel(paymentStatus)}
                      </Badge>
                    ) : (
                      <Badge className={cn(collectionStatusClasses(collectionStatus), CARD_BADGE)}>
                        {/* ONE payment signal per card. When it's genuinely late the
                            pill carries the overdue figure itself, so there's no
                            second red block repeating the same story. Nothing else
                            here says WHAT is late (the desktop table has a תשלום
                            column for that), so the pill spells it out. */}
                        {collectionStatus === "overdue"
                          ? overdueLabel
                          : collectionStatusLabel(collectionStatus)}
                      </Badge>
                    )}
                  </div>

                  {/* Start-aligned, not centred: a list wants one vertical edge to
                      scan down. Centring every card turns the column into tiles. */}
                  <div>
                    <div className="text-base font-semibold leading-snug">{projectDisplayName(row)}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {clientDisplayName(row)}
                      {clientPhone(row) ? (
                        <>
                          {" · "}
                          <a
                            href={`tel:${clientPhone(row)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {clientPhone(row)}
                          </a>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Hidden entirely when the project has no tasks — an empty bar
                      says nothing and just adds a row to every card. */}
                  {totalTasks > 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-success transition-all"
                          style={{ width: `${Math.round((completedTasks / totalTasks) * 100)}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {completedTasks}/{totalTasks} משימות
                      </span>
                    </div>
                  ) : null}

                  {/* Nothing truncates here: the figures are short and fixed-shape,
                      so they get whitespace-nowrap and the row spreads them out.
                      Truncating money to "0,780…" is worse than no figure at all. */}
                  <div className="flex items-center gap-3 border-t border-border/60 pt-2.5">
                    <div className="flex flex-1 items-center justify-between gap-3">
                      {canSeeMoney ? (
                        <div className="whitespace-nowrap">
                          <div className="text-[10px] text-muted-foreground">רווח</div>
                          <div
                            className={`text-[13px] font-semibold ${profit !== null && profit < 0 ? "text-destructive" : ""}`}
                          >
                            {profit === null ? "-" : formatIls(profit)}
                          </div>
                        </div>
                      ) : null}
                      {canSeeMoney ? (
                        <div className="whitespace-nowrap">
                          <div className="text-[10px] text-muted-foreground">מחיר</div>
                          <div className="text-[13px] font-semibold">
                            {actualPrice === null ? "-" : formatIls(actualPrice)}
                          </div>
                        </div>
                      ) : null}
                      <div className="whitespace-nowrap">
                        <div className="text-[10px] text-muted-foreground">התחלה</div>
                        <div className="text-[13px] font-semibold">{startDate}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </SwipeActions>
          );
        })}
      </div>
      {hasMore && !offline ? <div ref={mobileSentinelRef} className="h-1 xl:hidden" /> : null}

      {rows.length > 0 ? (
        <div className="pt-1 text-center text-xs text-muted-foreground">
          {loadingMore
            ? "טוען…"
            : `מציג ${rows.length}${totalCount != null ? ` מתוך ${totalCount}` : ""} פרויקטים`}
        </div>
      ) : null}

      <FormDialog
        open={approveQuoteOpen}
        onOpenChange={(open) => {
          setApproveQuoteOpen(open);
          if (!open) {
            setApproveQuoteError(null);
            setApproveQuoteId("");
            setApproveQuoteName("");
            setApproveQuotePrice("");
          }
        }}
        title="אישור הצעת מחיר"
        description={
          approveQuoteName
            ? `הזינו את המחיר המוסכם עבור ${approveQuoteName} לפני ההעברה למתוכנן.`
            : "הזינו את המחיר המוסכם לפני ההעברה למתוכנן."
        }
        size="formSm"
        onSubmit={() => void approveQuote()}
        submitLabel="אישור הצעה"
        busyLabel="שומר..."
        busy={approveQuoteSubmitting}
        error={approveQuoteError || undefined}
      >

          <div className="space-y-2">
            <label className="text-sm font-medium">מחיר מוסכם *</label>
            <CurrencyInput
              value={approveQuotePrice}
              onChange={(e) => setApproveQuotePrice(e.target.value)}
              placeholder="לדוגמה: 2300"
            />
          </div>
      </FormDialog>

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

    </PageStack>
  );
}



